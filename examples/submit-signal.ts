/**
 * Submit a signal as Scampi
 * Full flow: Generate hash → Commit on-chain → (optional) Reveal
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AgentAlphaClient, PROGRAM_ID } from '../src/onchain.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import crypto from 'crypto';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const API_URL = 'https://web-production-75d60.up.railway.app';

interface SignalInput {
  token: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  takeProfit: number;
  stopLoss: number;
  timeframeHours: number;
  confidence: number;
}

// Generate hash locally (same as API)
function generateHash(signal: SignalInput): { hash: Uint8Array; input: string } {
  const dirNum = signal.direction === 'BUY' ? 0 : 1;
  const entryInt = Math.round(signal.entry * 100);
  const tpInt = Math.round(signal.takeProfit * 100);
  const slInt = Math.round(signal.stopLoss * 100);
  
  const input = `${signal.token}:${dirNum}:${entryInt}:${tpInt}:${slInt}:${signal.timeframeHours}:${signal.confidence}`;
  const hashBuffer = crypto.createHash('sha256').update(input).digest();
  
  return {
    hash: new Uint8Array(hashBuffer),
    input
  };
}

async function main() {
  console.log('🦐 Scampi Signal Submission\n');

  // Load system keypair
  const keypairPath = path.join(os.homedir(), '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log(`Wallet: ${payer.publicKey.toBase58()}`);

  // Connect to devnet
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Create client
  const client = new AgentAlphaClient(connection, payer);

  // Check we're registered
  const provider = await client.getProvider(payer.publicKey);
  if (!provider) {
    console.log('❌ Not registered as provider! Run register-scampi.ts first.');
    return;
  }
  console.log(`Provider: ${provider.name}`);
  console.log(`Total signals: ${provider.totalSignals}\n`);

  // Define our signal
  const signal: SignalInput = {
    token: 'SOL',
    direction: 'BUY',
    entry: 105.00,      // Current price ~$105
    takeProfit: 115.00, // TP at $115 (~9.5% up)
    stopLoss: 100.00,   // SL at $100 (~4.8% down)
    timeframeHours: 24,
    confidence: 75
  };

  console.log('📊 Signal:');
  console.log(`   ${signal.direction} ${signal.token} @ $${signal.entry}`);
  console.log(`   TP: $${signal.takeProfit} | SL: $${signal.stopLoss}`);
  console.log(`   Timeframe: ${signal.timeframeHours}h | Confidence: ${signal.confidence}%`);
  
  const rr = ((signal.takeProfit - signal.entry) / (signal.entry - signal.stopLoss)).toFixed(2);
  console.log(`   Risk/Reward: ${rr}\n`);

  // Generate hash
  const { hash, input } = generateHash(signal);
  console.log('🔐 Hash generated:');
  console.log(`   Input: ${input}`);
  console.log(`   Hash: 0x${Buffer.from(hash).toString('hex').slice(0, 32)}...`);

  // Commit on-chain
  console.log('\n⛓️  Committing to Solana...');
  
  try {
    const commitTx = await client.commitSignal(hash);
    console.log(`\n✅ Signal committed!`);
    console.log(`   TX: ${commitTx}`);
    console.log(`   https://explorer.solana.com/tx/${commitTx}?cluster=devnet`);
  } catch (err: any) {
    if (err.message?.includes('already in use') || err.logs?.some((l: string) => l.includes('already in use'))) {
      console.log('\n⚠️  This exact signal was already committed (same hash)');
    } else {
      console.log(`\n❌ Commit failed: ${err}`);
      if (err.logs) {
        console.log('Logs:', err.logs.slice(-5));
      }
    }
  }

  // Check updated stats
  console.log('\n📊 Updated Provider Stats:');
  const updatedProvider = await client.getProvider(payer.publicKey);
  if (updatedProvider) {
    console.log(`   Total signals: ${updatedProvider.totalSignals}`);
    console.log(`   Correct signals: ${updatedProvider.correctSignals}`);
  }

  console.log('\n✨ Done! Signal is now committed on-chain.');
  console.log('   Reveal will happen after the evaluation window.');
}

main().catch(console.error);
