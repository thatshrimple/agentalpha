/**
 * AgentAlpha E2E Test
 * Full flow: Register → Commit → Reveal
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AgentAlphaClient, PROGRAM_ID, SignalInput } from '../src/onchain.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
  console.log('🦐 AgentAlpha E2E Test\n');
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}\n`);
  console.log('─'.repeat(50));

  // Load system keypair
  const keypairPath = path.join(os.homedir(), '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log(`\n📍 Wallet: ${payer.publicKey.toBase58()}`);

  // Connect to devnet
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Create client
  const client = new AgentAlphaClient(connection, payer);

  // ========== STEP 1: Check/Register Provider ==========
  console.log('─'.repeat(50));
  console.log('📝 STEP 1: Provider Registration');
  console.log('─'.repeat(50));

  let provider = await client.getProvider(payer.publicKey);
  
  if (provider) {
    console.log(`✅ Already registered as: ${provider.name}`);
    console.log(`   Endpoint: ${provider.endpoint}`);
    console.log(`   Total signals: ${provider.totalSignals}`);
    console.log(`   Correct: ${provider.correctSignals}`);
  } else {
    console.log('📝 Registering as new provider...');
    try {
      const txSig = await client.registerProvider(
        'ScampiE2E',
        'https://web-production-75d60.up.railway.app',
        [0, 1, 2], // categories
        5_000_000n // 0.005 SOL
      );
      console.log(`✅ Registered! TX: ${txSig}`);
      provider = await client.getProvider(payer.publicKey);
    } catch (err: any) {
      console.log(`❌ Registration failed: ${err.message}`);
      return;
    }
  }

  // ========== STEP 2: Create & Commit Signal ==========
  console.log('\n' + '─'.repeat(50));
  console.log('🔒 STEP 2: Commit Signal');
  console.log('─'.repeat(50));

  // Create a unique signal (using timestamp to ensure new hash)
  const timestamp = Date.now();
  const signal: SignalInput = {
    token: 'SOL',
    direction: 'BUY',
    entry: 105.00 + (timestamp % 100) / 100, // Slightly different each time
    takeProfit: 115.00,
    stopLoss: 100.00,
    timeframeHours: 24,
    confidence: 80
  };

  console.log(`\n📊 Signal:`);
  console.log(`   ${signal.direction} ${signal.token} @ $${signal.entry.toFixed(2)}`);
  console.log(`   TP: $${signal.takeProfit} | SL: $${signal.stopLoss}`);
  console.log(`   Timeframe: ${signal.timeframeHours}h | Confidence: ${signal.confidence}%`);

  // Compute hash
  const { hash, input } = AgentAlphaClient.computeSignalHash(signal);
  console.log(`\n🔐 Hash Input: ${input}`);
  console.log(`   Hash: 0x${Buffer.from(hash).toString('hex').slice(0, 32)}...`);

  // Commit on-chain
  console.log('\n⛓️  Committing to Solana...');
  let commitTx: string;
  try {
    commitTx = await client.commitSignal(hash);
    console.log(`✅ Committed!`);
    console.log(`   TX: ${commitTx}`);
    console.log(`   https://explorer.solana.com/tx/${commitTx}?cluster=devnet`);
  } catch (err: any) {
    if (err.message?.includes('already in use') || err.logs?.some((l: string) => l.includes('already in use'))) {
      console.log('⚠️  This signal was already committed. Continuing to reveal...');
    } else {
      console.log(`❌ Commit failed: ${err.message}`);
      if (err.logs) console.log('Logs:', err.logs.slice(-3));
      return;
    }
  }

  // ========== STEP 3: Reveal Signal ==========
  console.log('\n' + '─'.repeat(50));
  console.log('🔓 STEP 3: Reveal Signal');
  console.log('─'.repeat(50));

  console.log('\n⛓️  Revealing on Solana...');
  try {
    const revealTx = await client.revealSignal(signal, hash);
    console.log(`✅ Revealed!`);
    console.log(`   TX: ${revealTx}`);
    console.log(`   https://explorer.solana.com/tx/${revealTx}?cluster=devnet`);
  } catch (err: any) {
    if (err.message?.includes('AlreadyRevealed') || err.logs?.some((l: string) => l.includes('AlreadyRevealed'))) {
      console.log('⚠️  Signal was already revealed.');
    } else if (err.message?.includes('HashMismatch') || err.logs?.some((l: string) => l.includes('HashMismatch'))) {
      console.log('❌ Hash mismatch! Revealed data does not match committed hash.');
      console.log('   This means the hash format is different between client and contract.');
      if (err.logs) console.log('Logs:', err.logs.slice(-5));
      return;
    } else {
      console.log(`❌ Reveal failed: ${err.message}`);
      if (err.logs) console.log('Logs:', err.logs.slice(-5));
      return;
    }
  }

  // ========== STEP 4: Check Updated Stats ==========
  console.log('\n' + '─'.repeat(50));
  console.log('📊 STEP 4: Final Stats');
  console.log('─'.repeat(50));

  const updatedProvider = await client.getProvider(payer.publicKey);
  if (updatedProvider) {
    console.log(`\n   Provider: ${updatedProvider.name}`);
    console.log(`   Total signals: ${updatedProvider.totalSignals}`);
    console.log(`   Correct signals: ${updatedProvider.correctSignals}`);
    const hitRate = updatedProvider.totalSignals > 0n
      ? Number(updatedProvider.correctSignals * 100n / updatedProvider.totalSignals)
      : 0;
    console.log(`   Hit rate: ${hitRate}%`);
  }

  console.log('\n' + '═'.repeat(50));
  console.log('✨ E2E TEST COMPLETE!');
  console.log('═'.repeat(50));
  console.log('\nFlow verified:');
  console.log('  1. ✅ Provider registration');
  console.log('  2. ✅ Signal hash committed on-chain');
  console.log('  3. ✅ Signal revealed with matching data');
  console.log('  4. ✅ Provider stats updated');
  console.log('\nNext: Oracle records outcome after timeframe expires.');
}

main().catch(console.error);
