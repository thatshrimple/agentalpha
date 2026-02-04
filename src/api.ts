/**
 * AgentAlpha - Discovery API
 * 
 * REST API for discovering signal providers.
 * This is the registry/discovery layer of AgentAlpha.
 */

import express from 'express';
import cors from 'cors';
import { registry } from './registry.js';
import { reputationTracker } from './reputation.js';
import { onchainSync } from './onchain-sync.js';
import signalApi from './signal-api.js';
import type { Provider, ProviderSearchParams, SignalCategory, Signal } from './types.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Mount signal submission API
app.use('/signals', signalApi);

const PORT = process.env.PORT || process.env.REGISTRY_PORT || 4020;
const ENABLE_ONCHAIN_SYNC = process.env.ENABLE_ONCHAIN_SYNC !== 'false';

// ========== ROUTES ==========

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'AgentAlpha Registry',
    providers: registry.list().length,
    onchainSync: ENABLE_ONCHAIN_SYNC
  });
});

// ========== ON-CHAIN ROUTES ==========

// Get on-chain stats
app.get('/onchain/stats', async (req, res) => {
  try {
    const stats = await onchainSync.getOnChainStats();
    res.json({ 
      success: true,
      ...stats,
      note: stats.network === 'devnet' 
        ? '⚠️ DEVNET - Mainnet coming soon!' 
        : '🚀 MAINNET'
    });
  } catch (error) {
    console.error('On-chain stats error:', error);
    res.status(500).json({ error: 'Failed to fetch on-chain stats' });
  }
});

// Get provider directly from chain
app.get('/onchain/providers/:authority', async (req, res) => {
  try {
    const provider = await onchainSync.getOnChainProvider(req.params.authority);
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found on-chain' });
    }
    
    // Convert bigints to numbers for JSON
    res.json({
      success: true,
      provider: {
        authority: provider.authority.toBase58(),
        name: provider.name,
        endpoint: provider.endpoint,
        categories: provider.categories,
        priceLamports: provider.priceLamports.toString(),
        priceSOL: Number(provider.priceLamports) / 1e9,
        totalSignals: Number(provider.totalSignals),
        correctSignals: Number(provider.correctSignals),
        accuracy: provider.totalSignals > 0n 
          ? Number(provider.correctSignals * 100n / provider.totalSignals) 
          : 0,
        avgReturnBps: provider.totalSignals > 0n
          ? Number(provider.totalReturnBps / provider.totalSignals)
          : 0,
        createdAt: new Date(Number(provider.createdAt) * 1000).toISOString(),
        updatedAt: new Date(Number(provider.updatedAt) * 1000).toISOString(),
      },
      network: process.env.SOLANA_NETWORK || 'devnet'
    });
  } catch (error) {
    console.error('On-chain provider fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch provider from chain' });
  }
});

// List all on-chain providers
app.get('/onchain/providers', async (req, res) => {
  try {
    const providers = await onchainSync.getAllOnChainProviders();
    
    res.json({
      success: true,
      providers: providers.map(p => ({
        authority: p.authority.toBase58(),
        name: p.name,
        endpoint: p.endpoint,
        categories: p.categories,
        priceSOL: Number(p.priceLamports) / 1e9,
        totalSignals: Number(p.totalSignals),
        correctSignals: Number(p.correctSignals),
        accuracy: p.totalSignals > 0n 
          ? Number(p.correctSignals * 100n / p.totalSignals) 
          : 0,
      })),
      count: providers.length,
      network: process.env.SOLANA_NETWORK || 'devnet'
    });
  } catch (error) {
    console.error('On-chain providers list error:', error);
    res.status(500).json({ error: 'Failed to fetch providers from chain' });
  }
});

// Manual sync trigger
app.post('/onchain/sync', async (req, res) => {
  try {
    const result = await onchainSync.syncAll();
    res.json({ 
      success: true, 
      ...result,
      message: `Synced ${result.synced} providers from chain`
    });
  } catch (error) {
    console.error('On-chain sync error:', error);
    res.status(500).json({ error: 'Failed to sync from chain' });
  }
});

// Register a new provider
app.post('/providers', (req, res) => {
  try {
    const { 
      name, 
      description, 
      endpoint, 
      categories, 
      pricePerSignal, 
      network, 
      payTo 
    } = req.body;

    // Validation
    if (!name || !categories || !pricePerSignal || !network || !payTo) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'categories', 'pricePerSignal', 'network', 'payTo'],
        optional: ['description', 'endpoint']
      });
    }

    const { provider, apiKey } = registry.register({
      name,
      description: description || '',
      endpoint: endpoint || '',
      categories,
      pricePerSignal,
      network,
      payTo,
    });

    res.status(201).json({ 
      provider,
      apiKey,
      important: '⚠️ SAVE YOUR API KEY! It is shown only once and cannot be recovered.',
      usage: {
        submitSignals: 'POST /signals/submit with header "X-API-Key: ' + apiKey + '"'
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register provider' });
  }
});

// List/search providers
app.get('/providers', (req, res) => {
  try {
    const params: ProviderSearchParams = {
      category: req.query.category as SignalCategory | undefined,
      minReputation: req.query.minReputation ? parseFloat(req.query.minReputation as string) : undefined,
      maxPrice: req.query.maxPrice as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string) : 20,
    };

    const result = registry.search(params);
    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get specific provider
app.get('/providers/:id', (req, res) => {
  const provider = registry.get(req.params.id);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  res.json({ provider });
});

// Update provider
app.patch('/providers/:id', (req, res) => {
  const provider = registry.update(req.params.id, req.body);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  res.json({ provider });
});

// Update provider reputation (called by reputation oracle/indexer)
app.post('/providers/:id/reputation', (req, res) => {
  const { totalSignals, correctSignals, avgReturn, hitRate, avgConfidence } = req.body;
  
  const provider = registry.updateReputation(req.params.id, {
    totalSignals,
    correctSignals,
    avgReturn,
    hitRate,
    avgConfidence,
  });

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  res.json({ provider });
});

// Delete provider
app.delete('/providers/:id', (req, res) => {
  const deleted = registry.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  res.json({ success: true });
});

// Get categories
app.get('/categories', (req, res) => {
  const categories: SignalCategory[] = [
    'sentiment',
    'whale',
    'momentum',
    'arbitrage',
    'news',
    'onchain',
    'custom',
  ];
  res.json({ categories });
});

// ========== REPUTATION ENDPOINTS ==========

// Commit a signal (provider commits hash before revealing)
app.post('/reputation/commit', (req, res) => {
  try {
    const signal = req.body.signal as Signal;
    if (!signal || !signal.id || !signal.providerId) {
      return res.status(400).json({ error: 'Invalid signal' });
    }
    
    const commit = reputationTracker.commitSignal(signal);
    res.status(201).json({ commit });
  } catch (error) {
    console.error('Commit error:', error);
    res.status(500).json({ error: 'Failed to commit signal' });
  }
});

// Reveal a signal (provider reveals full signal data)
app.post('/reputation/reveal', (req, res) => {
  try {
    const { signalId, signal } = req.body;
    if (!signalId || !signal) {
      return res.status(400).json({ error: 'Missing signalId or signal' });
    }
    
    const success = reputationTracker.revealSignal(signalId, signal);
    if (!success) {
      return res.status(400).json({ error: 'Failed to reveal signal' });
    }
    
    res.json({ success: true, signalId });
  } catch (error) {
    console.error('Reveal error:', error);
    res.status(500).json({ error: 'Failed to reveal signal' });
  }
});

// Record outcome (oracle/indexer reports signal result)
app.post('/reputation/outcome', (req, res) => {
  try {
    const { signalId, priceAtSignal, priceAtEvaluation } = req.body;
    if (!signalId || priceAtSignal === undefined || priceAtEvaluation === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const outcome = reputationTracker.recordOutcome(
      signalId,
      priceAtSignal,
      priceAtEvaluation,
      Date.now()
    );
    
    if (!outcome) {
      return res.status(400).json({ error: 'Failed to record outcome' });
    }

    // Update provider reputation in registry
    const commit = reputationTracker.getCommit(signalId);
    if (commit?.providerId) {
      const reputation = reputationTracker.calculateReputation(commit.providerId);
      registry.updateReputation(commit.providerId, reputation);
    }
    
    res.json({ outcome });
  } catch (error) {
    console.error('Outcome error:', error);
    res.status(500).json({ error: 'Failed to record outcome' });
  }
});

// Get provider reputation details
app.get('/reputation/:providerId', (req, res) => {
  const reputation = reputationTracker.calculateReputation(req.params.providerId);
  const commits = reputationTracker.getProviderCommits(req.params.providerId);
  
  res.json({ 
    providerId: req.params.providerId,
    reputation,
    recentCommits: commits.slice(-10), // Last 10 commits
    totalCommits: commits.length
  });
});

// Get specific signal commit
app.get('/reputation/commit/:signalId', (req, res) => {
  const commit = reputationTracker.getCommit(req.params.signalId);
  if (!commit) {
    return res.status(404).json({ error: 'Commit not found' });
  }
  res.json({ commit });
});

// Start server
app.listen(PORT, () => {
  const network = process.env.SOLANA_NETWORK || 'devnet';
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                   AgentAlpha Registry API                  ║
╠════════════════════════════════════════════════════════════╣
║  Endpoint: http://localhost:${String(PORT).padEnd(29)}║
║  Network:  ${network.toUpperCase().padEnd(47)}║
╠════════════════════════════════════════════════════════════╣
║  Discovery Routes:                                         ║
║    GET    /health           - Health check                 ║
║    GET    /providers        - List/search providers        ║
║    POST   /providers        - Register new provider        ║
║    GET    /providers/:id    - Get provider details         ║
║    PATCH  /providers/:id    - Update provider              ║
║    DELETE /providers/:id    - Remove provider              ║
║    GET    /categories       - List signal categories       ║
╠════════════════════════════════════════════════════════════╣
║  On-Chain Routes (${network}):                             ║
║    GET    /onchain/stats    - On-chain statistics          ║
║    GET    /onchain/providers - List on-chain providers     ║
║    GET    /onchain/providers/:auth - Get by authority      ║
║    POST   /onchain/sync     - Trigger manual sync          ║
╠════════════════════════════════════════════════════════════╣
║  Reputation Routes:                                        ║
║    POST   /reputation/commit  - Commit signal hash         ║
║    POST   /reputation/reveal  - Reveal signal              ║
║    POST   /reputation/outcome - Record outcome             ║
║    GET    /reputation/:id     - Get provider reputation    ║
╚════════════════════════════════════════════════════════════╝
  `);

  // Start on-chain sync if enabled
  if (ENABLE_ONCHAIN_SYNC) {
    console.log(`🔗 Starting on-chain sync (${network})...`);
    onchainSync.startPeriodicSync(60000); // Sync every minute
  }
});

export default app;
