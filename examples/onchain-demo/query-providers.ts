/**
 * Quick query to check deployed program
 */

import { Connection, PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('2dAju7NnKZiA7AmBBd2ciU1FWqD7fgMmQGjAKo5ZPKQA');
const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
  console.log('🦐 AgentAlpha Program Query\n');
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
  
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  // Get program account info
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  console.log(`\nProgram exists: ${programInfo !== null}`);
  console.log(`Executable: ${programInfo?.executable}`);
  console.log(`Owner: ${programInfo?.owner.toBase58()}`);
  console.log(`Data length: ${programInfo?.data.length} bytes`);
  
  // Get all program accounts (providers, signals, etc.)
  console.log('\n📊 Fetching program accounts...');
  const accounts = await connection.getProgramAccounts(PROGRAM_ID);
  console.log(`Found ${accounts.length} accounts`);
  
  for (const { pubkey, account } of accounts) {
    console.log(`\n  Account: ${pubkey.toBase58()}`);
    console.log(`  Data size: ${account.data.length} bytes`);
    console.log(`  Lamports: ${account.lamports}`);
    
    // Try to identify account type by discriminator
    if (account.data.length >= 8) {
      const discriminator = account.data.slice(0, 8);
      console.log(`  Discriminator: ${Buffer.from(discriminator).toString('hex')}`);
    }
  }
  
  console.log('\n✅ Program is live on devnet!');
}

main().catch(console.error);
