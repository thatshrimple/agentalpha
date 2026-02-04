/**
 * AgentAlpha On-Chain Client
 * 
 * TypeScript client for interacting with the AgentAlpha Solana program.
 * Handles provider registration, signal commits, reveals, and outcome recording.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import { SignalDirection } from './types.js';

// Program ID from deployed contract
export const PROGRAM_ID = new PublicKey('6sDwzatESkmF5T3K3rfNta4DCRgH8z9ZdYoPXeMtKRmP');

// Seeds for PDAs
const PROVIDER_SEED = Buffer.from('provider');
const SIGNAL_SEED = Buffer.from('signal');

// Instruction discriminators (from IDL)
const DISCRIMINATORS = {
  registerProvider: Buffer.from([254, 209, 54, 184, 46, 197, 109, 78]),
  commitSignal: Buffer.from([137, 14, 98, 40, 102, 88, 98, 135]),
  revealSignal: Buffer.from([224, 171, 21, 85, 195, 253, 227, 240]),
  updateProvider: Buffer.from([52, 208, 141, 191, 164, 54, 108, 150]),
  recordOutcome: Buffer.from([130, 121, 6, 102, 151, 160, 252, 6]),
};

export interface OnChainProvider {
  authority: PublicKey;
  name: string;
  endpoint: string;
  categories: number[];
  priceLamports: bigint;
  totalSignals: bigint;
  correctSignals: bigint;
  totalReturnBps: bigint;
  createdAt: bigint;
  updatedAt: bigint;
}

export interface OnChainSignalCommit {
  provider: PublicKey;
  signalHash: Uint8Array;
  committedAt: bigint;
  revealed: boolean;
  outcomeRecorded: boolean;
  token: string;
  direction: number;
  confidence: number;
  priceAtSignal: bigint;
  revealedAt: bigint;
  priceAtEvaluation: bigint;
  wasCorrect: boolean;
  returnBps: number;
  evaluatedAt: bigint;
}

/**
 * AgentAlpha on-chain client
 */
export class AgentAlphaClient {
  private connection: Connection;
  private payer: Keypair;

  constructor(connection: Connection, payer: Keypair) {
    this.connection = connection;
    this.payer = payer;
  }

  /**
   * Get the provider PDA for an authority
   */
  getProviderPDA(authority: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [PROVIDER_SEED, authority.toBuffer()],
      PROGRAM_ID
    );
  }

  /**
   * Get the signal commit PDA
   */
  getSignalCommitPDA(provider: PublicKey, signalHash: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SIGNAL_SEED, provider.toBuffer(), signalHash],
      PROGRAM_ID
    );
  }

  /**
   * Compute signal hash for commit-reveal
   */
  static computeSignalHash(
    token: string,
    direction: SignalDirection,
    confidence: number
  ): Uint8Array {
    const directionNum = direction === 'BUY' ? 1 : direction === 'SELL' ? 2 : 0;
    const data = `${token}:${directionNum}:${confidence}`;
    const hash = createHash('sha256').update(data).digest();
    return new Uint8Array(hash);
  }

  /**
   * Register a new provider on-chain
   */
  async registerProvider(
    name: string,
    endpoint: string,
    categories: number[],
    priceLamports: bigint
  ): Promise<string> {
    const [providerPDA] = this.getProviderPDA(this.payer.publicKey);

    // Encode instruction data
    const nameBytes = Buffer.from(name, 'utf8');
    const endpointBytes = Buffer.from(endpoint, 'utf8');
    
    const data = Buffer.concat([
      DISCRIMINATORS.registerProvider,
      // String: 4-byte length + bytes
      this.encodeU32(nameBytes.length),
      nameBytes,
      this.encodeU32(endpointBytes.length),
      endpointBytes,
      // Vec<u8>: 4-byte length + bytes
      this.encodeU32(categories.length),
      Buffer.from(categories),
      // u64
      this.encodeU64(priceLamports),
    ]);

    const ix = {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: providerPDA, isSigner: false, isWritable: true },
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    };

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.payer]);
  }

  /**
   * Commit a signal hash on-chain
   */
  async commitSignal(signalHash: Uint8Array): Promise<string> {
    const [providerPDA] = this.getProviderPDA(this.payer.publicKey);
    const [signalCommitPDA] = this.getSignalCommitPDA(providerPDA, signalHash);

    const data = Buffer.concat([
      DISCRIMINATORS.commitSignal,
      Buffer.from(signalHash),
    ]);

    const ix = {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: signalCommitPDA, isSigner: false, isWritable: true },
        { pubkey: providerPDA, isSigner: false, isWritable: false },
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    };

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.payer]);
  }

  /**
   * Reveal a signal on-chain
   */
  async revealSignal(
    signalHash: Uint8Array,
    token: string,
    direction: SignalDirection,
    confidence: number,
    priceAtSignal: bigint
  ): Promise<string> {
    const [providerPDA] = this.getProviderPDA(this.payer.publicKey);
    const [signalCommitPDA] = this.getSignalCommitPDA(providerPDA, signalHash);

    const directionNum = direction === 'BUY' ? 1 : direction === 'SELL' ? 2 : 0;
    const tokenBytes = Buffer.from(token, 'utf8');

    const data = Buffer.concat([
      DISCRIMINATORS.revealSignal,
      this.encodeU32(tokenBytes.length),
      tokenBytes,
      Buffer.from([directionNum]),
      Buffer.from([confidence]),
      this.encodeU64(priceAtSignal),
    ]);

    const ix = {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: signalCommitPDA, isSigner: false, isWritable: true },
        { pubkey: providerPDA, isSigner: false, isWritable: false },
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    };

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.payer]);
  }

  /**
   * Fetch provider account data
   */
  async getProvider(authority: PublicKey): Promise<OnChainProvider | null> {
    const [providerPDA] = this.getProviderPDA(authority);
    const accountInfo = await this.connection.getAccountInfo(providerPDA);
    
    if (!accountInfo) return null;
    
    // Parse account data (skip 8-byte discriminator)
    return this.parseProviderAccount(accountInfo.data.slice(8));
  }

  /**
   * Fetch all registered providers
   */
  async getAllProviders(): Promise<OnChainProvider[]> {
    // Fetch all program accounts
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID);

    const providers: OnChainProvider[] = [];
    
    for (const { account } of accounts) {
      try {
        // Skip accounts that are too small to be providers
        if (account.data.length < 100) continue;
        
        // Try to parse as provider account (skip 8-byte discriminator)
        const provider = this.parseProviderAccount(account.data.slice(8));
        
        // Validate it looks like a provider (has name and endpoint)
        if (provider.name && provider.name.length > 0 && 
            provider.endpoint && provider.endpoint.length > 0) {
          providers.push(provider);
        }
      } catch (e) {
        // Not a provider account, skip
      }
    }

    return providers;
  }

  // Helper: encode u32 little-endian
  private encodeU32(value: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value);
    return buf;
  }

  // Helper: encode u64 little-endian
  private encodeU64(value: bigint): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value);
    return buf;
  }

  // Helper: parse provider account data
  private parseProviderAccount(data: Buffer): OnChainProvider {
    let offset = 0;

    // authority: pubkey (32 bytes)
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // name: string (4-byte length + bytes)
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.slice(offset, offset + nameLen).toString('utf8');
    offset += nameLen;

    // endpoint: string
    const endpointLen = data.readUInt32LE(offset);
    offset += 4;
    const endpoint = data.slice(offset, offset + endpointLen).toString('utf8');
    offset += endpointLen;

    // categories: Vec<u8>
    const categoriesLen = data.readUInt32LE(offset);
    offset += 4;
    const categories = Array.from(data.slice(offset, offset + categoriesLen));
    offset += categoriesLen;

    // price_lamports: u64
    const priceLamports = data.readBigUInt64LE(offset);
    offset += 8;

    // total_signals: u64
    const totalSignals = data.readBigUInt64LE(offset);
    offset += 8;

    // correct_signals: u64
    const correctSignals = data.readBigUInt64LE(offset);
    offset += 8;

    // total_return_bps: i64
    const totalReturnBps = data.readBigInt64LE(offset);
    offset += 8;

    // created_at: i64
    const createdAt = data.readBigInt64LE(offset);
    offset += 8;

    // updated_at: i64
    const updatedAt = data.readBigInt64LE(offset);
    offset += 8;

    return {
      authority,
      name,
      endpoint,
      categories,
      priceLamports,
      totalSignals,
      correctSignals,
      totalReturnBps,
      createdAt,
      updatedAt,
    };
  }
}

/**
 * Create a client connected to devnet
 */
export function createDevnetClient(payer: Keypair): AgentAlphaClient {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  return new AgentAlphaClient(connection, payer);
}

/**
 * Create a client connected to mainnet
 */
export function createMainnetClient(payer: Keypair): AgentAlphaClient {
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  return new AgentAlphaClient(connection, payer);
}
