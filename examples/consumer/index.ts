/**
 * AgentAlpha - Example Signal Consumer (Solana x402)
 * 
 * A demo consumer that subscribes to signal providers
 * and pays for signals via Solana x402.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4020';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || path.join(__dirname, 'consumer-keypair.json');

// Solana connection
const connection = new Connection(RPC_URL, 'confirmed');

// Load or generate keypair
function loadKeypair(): Keypair {
  if (fs.existsSync(KEYPAIR_PATH)) {
    const data = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  
  const keypair = Keypair.generate();
  fs.writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`Generated new keypair: ${keypair.publicKey.toBase58()}`);
  console.log(`Fund it with: solana airdrop 1 ${keypair.publicKey.toBase58()} --url devnet`);
  return keypair;
}

/**
 * Send SOL payment for x402
 */
async function sendPayment(
  payer: Keypair,
  recipient: string,
  amountLamports: number
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(recipient),
      lamports: amountLamports,
    })
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [payer]);
  return signature;
}

/**
 * Request a signal with x402 payment flow
 */
async function requestSignal(
  providerEndpoint: string,
  payer: Keypair
): Promise<any> {
  // Step 1: Request without payment
  console.log('\n📡 Requesting signal...');
  const response = await fetch(`${providerEndpoint}/signal/latest`);
  
  // Step 2: Check if payment required
  if (response.status === 402) {
    const paymentRequired = await response.json();
    console.log('💰 Payment required!');
    
    const accept = paymentRequired.accepts?.[0];
    if (!accept) {
      throw new Error('No payment options in 402 response');
    }

    const amount = parseInt(accept.maxAmountRequired);
    const recipient = accept.payTo;
    
    console.log(`   Amount: ${amount / LAMPORTS_PER_SOL} SOL`);
    console.log(`   Pay to: ${recipient}`);

    // Step 3: Send payment
    console.log('\n💸 Sending payment...');
    const signature = await sendPayment(payer, recipient, amount);
    console.log(`   TX: ${signature}`);

    // Wait a moment for confirmation
    await new Promise(r => setTimeout(r, 2000));

    // Step 4: Retry with payment proof
    console.log('\n🔄 Retrying with payment proof...');
    const paidResponse = await fetch(`${providerEndpoint}/signal/latest`, {
      headers: {
        'X-Payment': signature
      }
    });

    if (!paidResponse.ok) {
      const error = await paidResponse.json();
      throw new Error(`Payment failed: ${error.error || paidResponse.statusText}`);
    }

    return paidResponse.json();
  }

  // No payment required (shouldn't happen for paid endpoints)
  return response.json();
}

/**
 * Discover providers from registry
 */
async function discoverProviders(): Promise<any[]> {
  try {
    const response = await fetch(`${REGISTRY_URL}/providers`);
    const data = await response.json();
    return data.providers || [];
  } catch (error) {
    console.error('Failed to fetch providers from registry:', error);
    return [];
  }
}

/**
 * Main consumer loop
 */
async function main() {
  console.log('🦐 AgentAlpha Signal Consumer\n');
  console.log('═'.repeat(50));

  // Load keypair
  const payer = loadKeypair();
  console.log(`\nWallet: ${payer.publicKey.toBase58()}`);
  
  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log('\n⚠️  Low balance! Fund with:');
    console.log(`   solana airdrop 1 ${payer.publicKey.toBase58()} --url devnet`);
    return;
  }

  // Discover providers
  console.log('\n📋 Discovering providers...');
  const providers = await discoverProviders();
  
  if (providers.length === 0) {
    console.log('No providers found. Using default endpoint...');
  } else {
    console.log(`Found ${providers.length} provider(s):`);
    providers.forEach(p => {
      console.log(`   - ${p.name}: ${p.endpoint} (${p.pricePerSignal})`);
    });
  }

  // Use first provider or default
  const providerEndpoint = providers[0]?.endpoint || 'http://localhost:4021';
  console.log(`\nUsing provider: ${providerEndpoint}`);

  // Request a signal
  try {
    const result = await requestSignal(providerEndpoint, payer);
    
    console.log('\n✅ Signal received!');
    console.log('═'.repeat(50));
    
    if (result.signal) {
      const s = result.signal;
      console.log(`Token:      ${s.token}`);
      console.log(`Direction:  ${s.direction}`);
      console.log(`Confidence: ${(s.confidence * 100).toFixed(1)}%`);
      console.log(`Reason:     ${s.reason}`);
      console.log(`Timeframe:  ${s.timeframe}`);
      console.log(`Signal ID:  ${s.id}`);
    }

    if (result.payment) {
      console.log(`\nPayment TX: ${result.payment.signature}`);
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
  }

  console.log('\n═'.repeat(50));
  console.log('Demo complete! In production, you would:');
  console.log('1. Store signals for analysis');
  console.log('2. Execute trades based on signals');
  console.log('3. Track provider accuracy over time');
}

main().catch(console.error);
