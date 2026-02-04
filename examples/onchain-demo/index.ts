/**
 * AgentAlpha On-Chain Demo
 * 
 * Demonstrates the full on-chain flow:
 * 1. Register as a provider
 * 2. Generate and commit a signal
 * 3. Reveal the signal
 * 4. Check reputation on-chain
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { 
  AgentAlphaClient,
  PROGRAM_ID 
} from '../../src/onchain.js';
import { SignalDirection } from '../../src/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
  console.log('🦐 AgentAlpha On-Chain Demo\n');
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}\n`);

  // Load or generate keypair
  const keypairPath = path.join(__dirname, 'demo-keypair.json');
  let payer: Keypair;
  
  if (fs.existsSync(keypairPath)) {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log(`Loaded existing keypair: ${payer.publicKey.toBase58()}`);
  } else {
    payer = Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(payer.secretKey)));
    console.log(`Generated new keypair: ${payer.publicKey.toBase58()}`);
    console.log('⚠️  Fund this wallet with devnet SOL before running!');
    console.log(`   solana airdrop 1 ${payer.publicKey.toBase58()} --url devnet`);
    return;
  }

  // Connect to devnet
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('❌ Insufficient balance! Need at least 0.1 SOL');
    console.log(`   solana airdrop 1 ${payer.publicKey.toBase58()} --url devnet`);
    return;
  }

  // Create client
  const client = new AgentAlphaClient(connection, payer);

  // Step 1: Register as provider
  console.log('📝 Step 1: Register as Provider');
  console.log('─'.repeat(40));
  
  const existingProvider = await client.getProvider(payer.publicKey);
  
  if (existingProvider) {
    console.log(`Already registered as: ${existingProvider.name}`);
    console.log(`Endpoint: ${existingProvider.endpoint}`);
    console.log(`Total signals: ${existingProvider.totalSignals}`);
    console.log(`Correct signals: ${existingProvider.correctSignals}`);
    const accuracy = existingProvider.totalSignals > 0n 
      ? Number(existingProvider.correctSignals * 100n / existingProvider.totalSignals)
      : 0;
    console.log(`Accuracy: ${accuracy}%`);
  } else {
    try {
      const txSig = await client.registerProvider(
        'DemoAlphaBot',                    // name
        'http://localhost:4021',           // endpoint
        [1, 2],                            // categories: [DEFI, MEME]
        10_000_000n                        // price: 0.01 SOL
      );
      console.log(`✅ Registered! TX: ${txSig}`);
    } catch (err) {
      console.log(`❌ Registration failed: ${err}`);
      return;
    }
  }

  // Step 2: Generate and commit a signal
  console.log('\n🔒 Step 2: Commit Signal Hash');
  console.log('─'.repeat(40));

  const signal = {
    token: 'SOL',
    direction: 'BUY' as SignalDirection,
    confidence: 85,
  };

  const signalHash = AgentAlphaClient.computeSignalHash(
    signal.token,
    signal.direction,
    signal.confidence
  );

  console.log(`Signal: ${signal.direction} ${signal.token} @ ${signal.confidence}% confidence`);
  console.log(`Hash: ${Buffer.from(signalHash).toString('hex').slice(0, 16)}...`);

  try {
    const commitTx = await client.commitSignal(signalHash);
    console.log(`✅ Committed! TX: ${commitTx}`);
  } catch (err: any) {
    if (err.message?.includes('already in use')) {
      console.log('⚠️  Signal already committed (duplicate hash)');
    } else {
      console.log(`❌ Commit failed: ${err}`);
      return;
    }
  }

  // Step 3: Reveal the signal
  console.log('\n🔓 Step 3: Reveal Signal');
  console.log('─'.repeat(40));

  // Get current price (mock)
  const priceAtSignal = BigInt(Math.floor(150.5 * 1e9)); // $150.50 in lamport-like units

  try {
    const revealTx = await client.revealSignal(
      signalHash,
      signal.token,
      signal.direction,
      signal.confidence,
      priceAtSignal
    );
    console.log(`✅ Revealed! TX: ${revealTx}`);
    console.log(`Price at signal: $${Number(priceAtSignal) / 1e9}`);
  } catch (err: any) {
    if (err.message?.includes('AlreadyRevealed')) {
      console.log('⚠️  Signal already revealed');
    } else {
      console.log(`❌ Reveal failed: ${err}`);
    }
  }

  // Step 4: Check provider stats
  console.log('\n📊 Step 4: Provider Stats');
  console.log('─'.repeat(40));

  const provider = await client.getProvider(payer.publicKey);
  if (provider) {
    console.log(`Name: ${provider.name}`);
    console.log(`Total signals: ${provider.totalSignals}`);
    console.log(`Correct signals: ${provider.correctSignals}`);
    const accuracy = provider.totalSignals > 0n 
      ? Number(provider.correctSignals * 100n / provider.totalSignals)
      : 0;
    console.log(`Accuracy: ${accuracy}%`);
    const avgReturn = provider.totalSignals > 0n
      ? Number(provider.totalReturnBps / provider.totalSignals) / 100
      : 0;
    console.log(`Avg return: ${avgReturn.toFixed(2)}%`);
  }

  console.log('\n✨ Demo complete!');
  console.log('\nNext steps:');
  console.log('1. Oracle records outcome (after signal timeframe)');
  console.log('2. Provider reputation updates on-chain');
  console.log('3. Consumers can verify before paying for signals');
}

main().catch(console.error);
