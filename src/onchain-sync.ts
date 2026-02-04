/**
 * AgentAlpha On-Chain Sync Service
 * 
 * Bridges on-chain state to the off-chain discovery API.
 * Reads provider data from Solana and syncs to local registry.
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AgentAlphaClient, OnChainProvider, PROGRAM_ID } from './onchain.js';
import { registry } from './registry.js';
import type { Provider, SignalCategory } from './types.js';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

// Category mapping: on-chain index -> category name
const CATEGORY_MAP: Record<number, SignalCategory> = {
  0: 'sentiment',
  1: 'whale',
  2: 'momentum',
  3: 'arbitrage',
  4: 'news',
  5: 'onchain',
  6: 'custom',
};

export class OnChainSync {
  private connection: Connection;
  private client: AgentAlphaClient;
  private syncInterval: NodeJS.Timeout | null = null;
  private network: 'devnet' | 'mainnet';

  constructor(network: 'devnet' | 'mainnet' = 'devnet') {
    this.network = network;
    const rpc = network === 'mainnet' ? MAINNET_RPC : DEVNET_RPC;
    this.connection = new Connection(rpc, 'confirmed');
    
    // Create read-only client (dummy keypair, won't sign)
    const dummyKeypair = Keypair.generate();
    this.client = new AgentAlphaClient(this.connection, dummyKeypair);
  }

  /**
   * Convert on-chain provider to off-chain format
   */
  private toOffChainProvider(onchain: OnChainProvider): Omit<Provider, 'id' | 'createdAt' | 'lastSeen'> {
    const categories = onchain.categories
      .map(idx => CATEGORY_MAP[idx])
      .filter((c): c is SignalCategory => !!c);

    const totalSignals = Number(onchain.totalSignals);
    const correctSignals = Number(onchain.correctSignals);
    const hitRate = totalSignals > 0 ? correctSignals / totalSignals : 0;
    const avgReturn = totalSignals > 0 
      ? Number(onchain.totalReturnBps) / totalSignals / 100 
      : 0;

    return {
      name: onchain.name,
      description: `On-chain provider (${this.network})`,
      endpoint: onchain.endpoint,
      categories,
      pricePerSignal: `${Number(onchain.priceLamports) / 1e9} SOL`,
      network: 'solana',
      payTo: onchain.authority.toBase58(),
      reputation: {
        totalSignals,
        correctSignals,
        avgReturn,
        hitRate,
        avgConfidence: 0, // Not tracked on-chain
        lastUpdated: Date.now(),
      },
      onChainAuthority: onchain.authority.toBase58(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Fetch a single provider from chain by authority pubkey
   */
  async getOnChainProvider(authority: string): Promise<OnChainProvider | null> {
    try {
      const pubkey = new PublicKey(authority);
      return await this.client.getProvider(pubkey);
    } catch (error) {
      console.error(`Failed to fetch provider ${authority}:`, error);
      return null;
    }
  }

  /**
   * Fetch all providers from chain
   */
  async getAllOnChainProviders(): Promise<OnChainProvider[]> {
    try {
      return await this.client.getAllProviders();
    } catch (error) {
      console.error('Failed to fetch all providers:', error);
      return [];
    }
  }

  /**
   * Sync all on-chain providers to off-chain registry
   */
  async syncAll(): Promise<{ synced: number; errors: number }> {
    console.log(`[OnChainSync] Syncing providers from ${this.network}...`);
    
    const onchainProviders = await this.getAllOnChainProviders();
    let synced = 0;
    let errors = 0;

    for (const onchain of onchainProviders) {
      try {
        const offchainData = this.toOffChainProvider(onchain);
        const authority = onchain.authority.toBase58();
        
        // Check if already registered by authority
        const existing = registry.list().find(p => p.onChainAuthority === authority);
        
        if (existing) {
          // Update existing
          registry.update(existing.id, offchainData);
        } else {
          // Register new
          registry.register(offchainData);
        }
        synced++;
      } catch (error) {
        console.error(`Failed to sync provider:`, error);
        errors++;
      }
    }

    console.log(`[OnChainSync] Synced ${synced} providers, ${errors} errors`);
    return { synced, errors };
  }

  /**
   * Start periodic sync
   */
  startPeriodicSync(intervalMs: number = 60000): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    // Initial sync (fire and forget, don't block)
    this.syncAll().catch(err => {
      console.error('[OnChainSync] Initial sync error:', err);
    });
    
    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.syncAll().catch(err => {
        console.error('[OnChainSync] Periodic sync error:', err);
      });
    }, intervalMs);
    
    console.log(`[OnChainSync] Started periodic sync every ${intervalMs / 1000}s`);
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[OnChainSync] Stopped periodic sync');
    }
  }

  /**
   * Get on-chain stats
   */
  async getOnChainStats(): Promise<{
    network: string;
    programId: string;
    totalProviders: number;
    totalSignals: number;
    totalCorrect: number;
    overallAccuracy: number;
  }> {
    const providers = await this.getAllOnChainProviders();
    
    let totalSignals = 0n;
    let totalCorrect = 0n;
    
    for (const p of providers) {
      totalSignals += p.totalSignals;
      totalCorrect += p.correctSignals;
    }
    
    const overallAccuracy = totalSignals > 0n 
      ? Number(totalCorrect * 100n / totalSignals) 
      : 0;

    return {
      network: this.network,
      programId: PROGRAM_ID.toBase58(),
      totalProviders: providers.length,
      totalSignals: Number(totalSignals),
      totalCorrect: Number(totalCorrect),
      overallAccuracy,
    };
  }
}

// Singleton instance
export const onchainSync = new OnChainSync(
  process.env.SOLANA_NETWORK as 'devnet' | 'mainnet' || 'devnet'
);
