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

// Program ID from deployed contract
export const PROGRAM_ID = new PublicKey('6sDwzatESkmF5T3K3rfNta4DCRgH8z9ZdYoPXeMtKRmP');

// Seeds for PDAs
const PROVIDER_SEED = Buffer.from('provider');
const SIGNAL_SEED = Buffer.from('signal');

// Instruction discriminators (from Anchor IDL)
const DISCRIMINATORS = {
  registerProvider: Buffer.from([254, 209, 54, 184, 46, 197, 109, 78]),
  commitSignal: Buffer.from([137, 14, 98, 40, 102, 88, 98, 135]),
  revealSignal: Buffer.from([224, 171, 21, 85, 195, 253, 227, 240]),
  updateProvider: Buffer.from([52, 208, 141, 191, 164, 54, 108, 150]),
  recordOutcome: Buffer.from([130, 121, 6, 102, 151, 160, 252, 6]),
};

export interface SignalInput {
  token: string;
  direction: 'BUY' | 'SELL';
  entry: number;        // Entry price in dollars
  takeProfit: number;   // TP price in dollars
  stopLoss: number;     // SL price in dollars
  timeframeHours: number;
  confidence: number;   // 0-100
}

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
  entryCents: bigint;
  tpCents: bigint;
  slCents: bigint;
  timeframeHours: number;
  confidence: number;
  revealedAt: bigint;
  outcome: number;
  finalPriceCents: bigint;
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
   * Format: "{token}:{direction}:{entry_cents}:{tp_cents}:{sl_cents}:{timeframe}:{confidence}"
   */
  static computeSignalHash(signal: SignalInput): { hash: Uint8Array; input: string } {
    const dirNum = signal.direction === 'BUY' ? 0 : 1;
    const entryCents = Math.round(signal.entry * 100);
    const tpCents = Math.round(signal.takeProfit * 100);
    const slCents = Math.round(signal.stopLoss * 100);
    
    const input = `${signal.token}:${dirNum}:${entryCents}:${tpCents}:${slCents}:${signal.timeframeHours}:${signal.confidence}`;
    const hash = createHash('sha256').update(input).digest();
    
    return { hash: new Uint8Array(hash), input };
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

    const nameBytes = Buffer.from(name, 'utf8');
    const endpointBytes = Buffer.from(endpoint, 'utf8');
    
    const data = Buffer.concat([
      DISCRIMINATORS.registerProvider,
      this.encodeU32(nameBytes.length),
      nameBytes,
      this.encodeU32(endpointBytes.length),
      endpointBytes,
      this.encodeU32(categories.length),
      Buffer.from(categories),
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
   * Must match the hash that was committed
   */
  async revealSignal(signal: SignalInput, signalHash: Uint8Array): Promise<string> {
    const [providerPDA] = this.getProviderPDA(this.payer.publicKey);
    const [signalCommitPDA] = this.getSignalCommitPDA(providerPDA, signalHash);

    const dirNum = signal.direction === 'BUY' ? 0 : 1;
    const entryCents = BigInt(Math.round(signal.entry * 100));
    const tpCents = BigInt(Math.round(signal.takeProfit * 100));
    const slCents = BigInt(Math.round(signal.stopLoss * 100));
    const tokenBytes = Buffer.from(signal.token, 'utf8');

    const data = Buffer.concat([
      DISCRIMINATORS.revealSignal,
      this.encodeU32(tokenBytes.length),
      tokenBytes,
      Buffer.from([dirNum]),
      this.encodeU64(entryCents),
      this.encodeU64(tpCents),
      this.encodeU64(slCents),
      Buffer.from([signal.timeframeHours]),
      Buffer.from([signal.confidence]),
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
    
    return this.parseProviderAccount(accountInfo.data.slice(8));
  }

  /**
   * Fetch all registered providers
   */
  async getAllProviders(): Promise<OnChainProvider[]> {
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID);
    const providers: OnChainProvider[] = [];
    
    for (const { account } of accounts) {
      try {
        if (account.data.length < 100) continue;
        const provider = this.parseProviderAccount(account.data.slice(8));
        if (provider.name && provider.name.length > 0) {
          providers.push(provider);
        }
      } catch (e) {
        // Not a provider account
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

    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.slice(offset, offset + nameLen).toString('utf8');
    offset += nameLen;

    const endpointLen = data.readUInt32LE(offset);
    offset += 4;
    const endpoint = data.slice(offset, offset + endpointLen).toString('utf8');
    offset += endpointLen;

    const categoriesLen = data.readUInt32LE(offset);
    offset += 4;
    const categories = Array.from(data.slice(offset, offset + categoriesLen));
    offset += categoriesLen;

    const priceLamports = data.readBigUInt64LE(offset);
    offset += 8;

    const totalSignals = data.readBigUInt64LE(offset);
    offset += 8;

    const correctSignals = data.readBigUInt64LE(offset);
    offset += 8;

    const totalReturnBps = data.readBigInt64LE(offset);
    offset += 8;

    const createdAt = data.readBigInt64LE(offset);
    offset += 8;

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
