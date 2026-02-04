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

class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  // Register a new provider
  register(registration: {
    name: string;
    description: string;
    endpoint: string;
    categories: SignalCategory[];
    pricePerSignal: string;
    network: string;
    payTo: string;
  }): Provider {
    const id = crypto.randomUUID();
    const now = Date.now();

    const provider: Provider = {
      id,
      name: registration.name,
      description: registration.description,
      endpoint: registration.endpoint,
      categories: registration.categories,
      pricePerSignal: registration.pricePerSignal,
      network: registration.network,
      payTo: registration.payTo,
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

    this.providers.set(id, provider);
    console.log(`[Registry] Registered provider: ${provider.name} (${id})`);
    return provider;
  }

  // Get provider by ID
  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  // Update provider
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

  // Update reputation
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

  // Search providers
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

  // List all providers
  list(): Provider[] {
    return Array.from(this.providers.values());
  }

  // Delete provider
  delete(id: string): boolean {
    return this.providers.delete(id);
  }

  // Export for persistence
  export(): Provider[] {
    return this.list();
  }

  // Import from persistence
  import(providers: Provider[]): void {
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
  }
}

// Singleton instance
export const registry = new ProviderRegistry();
export default registry;
