/**
 * AgentAlpha - Signal Submission API
 * 
 * Simple API for providers to submit signals without running their own server.
 * AgentAlpha hosts the x402 paywall and handles payments.
 * 
 * Flow:
 * 1. Provider registers (on-chain or API)
 * 2. Provider POSTs signals to /signals/submit
 * 3. Consumers query /signals/latest and pay via x402
 * 4. Provider's reputation updates based on outcomes
 */

import express, { Router } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import crypto from 'crypto';
import { createSignalPaywall } from './x402-solana.js';
import { registry } from './registry.js';
import { reputationTracker } from './reputation.js';
import type { Signal, SignalDirection, SignalCategory } from './types.js';

const router = Router();

// In-memory signal storage (would be DB in production)
const signalStore = new Map<string, Signal[]>(); // providerId -> signals
const latestSignals = new Map<string, Signal>(); // providerId -> latest signal

// Treasury wallet for payments (redistributes to providers)
const TREASURY_WALLET = process.env.TREASURY_WALLET || '2XUvxhB6VxbPunkWMJi5LkCW6kRnWXn8186XvSHSTJ5y';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

const connection = new Connection(RPC_URL, 'confirmed');

/**
 * Provider submits a new signal
 * POST /signals/submit
 * 
 * Headers:
 *   X-Provider-Key: <provider's signing key or API key>
 * 
 * Body:
 *   {
 *     "token": "SOL",
 *     "direction": "BUY",
 *     "confidence": 0.85,
 *     "reason": "Whale accumulation detected",
 *     "timeframe": "4h",
 *     "category": "whale"
 *   }
 */
router.post('/submit', async (req, res) => {
  try {
    const providerKey = req.headers['x-provider-key'] as string;
    
    if (!providerKey) {
      return res.status(401).json({ 
        error: 'Missing X-Provider-Key header',
        hint: 'Register at POST /providers to get your key'
      });
    }

    // Find provider by key (in production, verify signature)
    const providers = registry.list();
    const provider = providers.find(p => 
      p.payTo === providerKey || 
      p.id === providerKey ||
      p.onChainAuthority === providerKey
    );

    if (!provider) {
      return res.status(401).json({ 
        error: 'Unknown provider',
        hint: 'Register first at POST /providers'
      });
    }

    // Validate signal data
    const { token, direction, confidence, reason, timeframe, category, targetPrice, stopLoss } = req.body;

    if (!token || !direction) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['token', 'direction'],
        optional: ['confidence', 'reason', 'timeframe', 'category', 'targetPrice', 'stopLoss']
      });
    }

    if (!['BUY', 'SELL', 'HOLD', 'NEUTRAL'].includes(direction)) {
      return res.status(400).json({
        error: 'Invalid direction',
        valid: ['BUY', 'SELL', 'HOLD', 'NEUTRAL']
      });
    }

    // Create signal
    const signal: Signal = {
      id: crypto.randomUUID(),
      providerId: provider.id,
      timestamp: Date.now(),
      category: (category || 'custom') as SignalCategory,
      token: token.toUpperCase(),
      direction: direction as SignalDirection,
      confidence: Math.min(1, Math.max(0, confidence || 0.5)),
      reason,
      timeframe,
      targetPrice,
      stopLoss,
      metadata: {
        providerName: provider.name,
        submittedAt: new Date().toISOString()
      }
    };

    // Store signal
    if (!signalStore.has(provider.id)) {
      signalStore.set(provider.id, []);
    }
    signalStore.get(provider.id)!.push(signal);
    latestSignals.set(provider.id, signal);

    // Commit to reputation system
    reputationTracker.commitSignal(signal);

    console.log(`[SignalAPI] New signal from ${provider.name}: ${signal.direction} ${signal.token}`);

    res.status(201).json({
      success: true,
      signal: {
        id: signal.id,
        token: signal.token,
        direction: signal.direction,
        timestamp: signal.timestamp
      },
      message: 'Signal submitted! Consumers can now purchase it.',
      accessUrl: `/signals/provider/${provider.id}/latest`
    });

  } catch (error: any) {
    console.error('[SignalAPI] Submit error:', error);
    res.status(500).json({ error: 'Failed to submit signal' });
  }
});

/**
 * Get latest signal from a provider (PAID)
 * GET /signals/provider/:providerId/latest
 */
router.get('/provider/:providerId/latest', async (req, res, next) => {
  const provider = registry.get(req.params.providerId);
  
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const signal = latestSignals.get(provider.id);
  if (!signal) {
    return res.status(404).json({ error: 'No signals from this provider yet' });
  }

  // Dynamic paywall based on provider's price
  const priceLamports = parseFloat(provider.pricePerSignal) * 1e9 || 10_000_000;
  
  const paywall = createSignalPaywall({
    priceInLamports: priceLamports,
    recipient: provider.payTo || TREASURY_WALLET,
    connection,
    network: 'solana-devnet'
  });

  // Apply paywall middleware
  paywall(req, res, () => {
    const payment = (req as any).payment;
    
    res.json({
      signal,
      provider: {
        id: provider.id,
        name: provider.name,
        reputation: provider.reputation
      },
      payment: {
        verified: true,
        signature: payment?.signature,
        paidTo: provider.payTo
      }
    });
  });
});

/**
 * List all available signals (preview only, free)
 * GET /signals/feed
 */
router.get('/feed', (req, res) => {
  const feed: any[] = [];
  
  for (const [providerId, signal] of latestSignals.entries()) {
    const provider = registry.get(providerId);
    if (provider) {
      feed.push({
        providerId: provider.id,
        providerName: provider.name,
        token: signal.token,
        direction: signal.direction,
        timestamp: signal.timestamp,
        price: provider.pricePerSignal,
        reputation: {
          totalSignals: provider.reputation.totalSignals,
          hitRate: provider.reputation.hitRate
        },
        // Full details require payment
        accessUrl: `/signals/provider/${provider.id}/latest`
      });
    }
  }

  // Sort by recency
  feed.sort((a, b) => b.timestamp - a.timestamp);

  res.json({
    signals: feed.slice(0, 50),
    total: feed.length,
    message: 'Pay via x402 to access full signal details'
  });
});

/**
 * Get provider's signal history (PAID - bulk access)
 * GET /signals/provider/:providerId/history
 */
router.get('/provider/:providerId/history', (req, res) => {
  const provider = registry.get(req.params.providerId);
  
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const signals = signalStore.get(provider.id) || [];
  
  // Return summary for free, full history behind paywall
  res.json({
    provider: {
      id: provider.id,
      name: provider.name,
      reputation: provider.reputation
    },
    summary: {
      totalSignals: signals.length,
      tokens: [...new Set(signals.map(s => s.token))],
      recentDirections: signals.slice(-10).map(s => ({ 
        token: s.token, 
        direction: s.direction,
        timestamp: s.timestamp 
      }))
    },
    fullHistoryAccess: 'Coming soon - bulk purchase option'
  });
});

export default router;
