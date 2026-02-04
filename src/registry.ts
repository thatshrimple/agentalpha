/**
 * AgentAlpha - Provider Registry
 * In-memory registry for MVP, can be replaced with on-chain storage later
 */

import { 
  Provider, 
  ProviderReputation, 
  ProviderListResponse, 
  ProviderSearchParams,
  SignalCategory 
} from './types.js';
import crypto from 'crypto';

// Store API keys separately (not exposed in provider listings)
const apiKeys: Map<string, string> = new Map(); // apiKey -> providerId
const providerApiKeys: Map<string, string> = new Map(); // providerId -> apiKey

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  const prefix = 'aa_sk_'; // agentalpha_secret_key
  const random = crypto.randomBytes(32).toString('hex');
  return `${prefix}${random}`;
}

class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  /**
   * Register a new provider
   * Returns provider AND secret apiKey (only shown once!)
   */
  register(registration: {
    name: string;
    description: string;
    endpoint?: string;
    categories: SignalCategory[];
    pricePerSignal: string;
    network: string;
    payTo: string;
    onChainAuthority?: string;
  }): { provider: Provider; apiKey: string } {
    const id = crypto.randomUUID();
    const now = Date.now();

    const provider: Provider = {
      id,
      name: registration.name,
      description: registration.description,
      endpoint: registration.endpoint || '',
      categories: registration.categories,
      pricePerSignal: registration.pricePerSignal,
      network: registration.network,
      payTo: registration.payTo,
      onChainAuthority: registration.onChainAuthority,
      reputation: {
        totalSignals: 0,
        correctSignals: 0,
        avgReturn: 0,
        hitRate: 0,
        avgConfidence: 0,
        lastUpdated: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Generate secret API key
    const apiKey = generateApiKey();
    
    // Store mappings
    this.providers.set(id, provider);
    apiKeys.set(apiKey, id);
    providerApiKeys.set(id, apiKey);

    console.log(`[Registry] Registered provider: ${provider.name} (${id})`);
    
    // Return both - apiKey only shown once!
    return { provider, apiKey };
  }

  /**
   * Verify API key and get provider
   */
  verifyApiKey(apiKey: string): Provider | null {
    const providerId = apiKeys.get(apiKey);
    if (!providerId) return null;
    return this.providers.get(providerId) || null;
  }

  /**
   * Get provider by ID
   */
  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  /**
   * Find provider by wallet address or on-chain authority
   */
  findByWallet(wallet: string): Provider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.payTo === wallet || provider.onChainAuthority === wallet) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * Update provider
   */
  update(id: string, updates: Partial<Provider>): Provider | undefined {
    const provider = this.providers.get(id);
    if (!provider) return undefined;

    const updated = { 
      ...provider, 
      ...updates, 
      id, // Prevent ID change
      updatedAt: Date.now() 
    };
    this.providers.set(id, updated);
    return updated;
  }

  /**
   * Update reputation
   */
  updateReputation(id: string, reputation: Partial<ProviderReputation>): Provider | undefined {
    const provider = this.providers.get(id);
    if (!provider) return undefined;

    provider.reputation = {
      ...provider.reputation,
      ...reputation,
      lastUpdated: Date.now(),
    };
    provider.updatedAt = Date.now();
    this.providers.set(id, provider);
    return provider;
  }

  /**
   * Search providers
   */
  search(params: ProviderSearchParams): ProviderListResponse {
    let results = Array.from(this.providers.values());

    // Filter by category
    if (params.category) {
      results = results.filter(p => p.categories.includes(params.category!));
    }

    // Filter by min reputation
    if (params.minReputation !== undefined) {
      results = results.filter(p => p.reputation.hitRate >= params.minReputation!);
    }

    // Sort by reputation (hit rate) descending
    results.sort((a, b) => b.reputation.hitRate - a.reputation.hitRate);

    // Pagination
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const start = (page - 1) * pageSize;
    const paged = results.slice(start, start + pageSize);

    return {
      providers: paged,
      total: results.length,
      page,
      pageSize,
    };
  }

  /**
   * List all providers
   */
  list(): Provider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Delete provider
   */
  delete(id: string): boolean {
    // Also clean up API key
    const apiKey = providerApiKeys.get(id);
    if (apiKey) {
      apiKeys.delete(apiKey);
      providerApiKeys.delete(id);
    }
    return this.providers.delete(id);
  }

  /**
   * Export for persistence
   */
  export(): Provider[] {
    return this.list();
  }

  /**
   * Import from persistence
   */
  import(providers: Provider[]): void {
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
  }
}

// Singleton instance
export const registry = new ProviderRegistry();
export default registry;
