/**
 * Register Scampi as an AgentAlpha provider
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AgentAlphaClient, PROGRAM_ID } from '../src/onchain.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
  console.log('🦐 Registering Scampi as AgentAlpha Provider\n');
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}\n`);

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

  // Check if already registered
  const existingProvider = await client.getProvider(payer.publicKey);
  
  if (existingProvider) {
    console.log('✅ Already registered!');
    console.log(`Name: ${existingProvider.name}`);
    console.log(`Endpoint: ${existingProvider.endpoint}`);
    console.log(`Total signals: ${existingProvider.totalSignals}`);
    console.log(`Correct signals: ${existingProvider.correctSignals}`);
    return;
  }

  // Register as Scampi
  console.log('📝 Registering...');
  
  try {
    const txSig = await client.registerProvider(
      'Scampi',                                      // name
      'https://web-production-75d60.up.railway.app', // endpoint (our API!)
      [0, 1, 2],                                     // categories: sentiment, whale, momentum
      5_000_000n                                     // price: 0.005 SOL
    );
    console.log(`\n✅ Registered! TX: ${txSig}`);
    console.log(`\nView on explorer:`);
    console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
  } catch (err) {
    console.log(`\n❌ Registration failed: ${err}`);
  }
}

main().catch(console.error);
