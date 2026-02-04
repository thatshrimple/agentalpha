/**
 * AgentAlpha - Example Signal Provider (Solana x402)
 * 
 * A demo signal provider that generates mock sentiment signals.
 * Protected by Solana-native x402 micropayments - consumers pay per signal.
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { Connection } from '@solana/web3.js';
import { createSignalPaywall } from '../../src/x402-solana.js';
import type { Signal, SignalCategory } from '../../src/types.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 4021;
const PROVIDER_NAME = process.env.PROVIDER_NAME || 'SentimentBot Alpha';
const PAY_TO = process.env.PAY_TO || '2XUvxhB6VxbPunkWMJi5LkCW6kRnWXn8186XvSHSTJ5y'; // Demo wallet
const PRICE_LAMPORTS = parseInt(process.env.PRICE_LAMPORTS || '10000000'); // 0.01 SOL
const NETWORK = (process.env.SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Solana connection
const connection = new Connection(RPC_URL, 'confirmed');

// x402 payment middleware for Solana
const paywall = createSignalPaywall({
  priceInLamports: PRICE_LAMPORTS,
  recipient: PAY_TO,
  connection,
  network: `solana-${NETWORK}` as 'solana-devnet' | 'solana-mainnet'
});

// In-memory signal storage (for demo)
const recentSignals: Signal[] = [];
const signalHistory: Map<string, Signal> = new Map();

// Registry URL for commit-reveal
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4020';

// Commit signal to registry for reputation tracking
async function commitSignalToRegistry(signal: Signal): Promise<void> {
  try {
    await fetch(`${REGISTRY_URL}/reputation/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal }),
    });
    console.log(`[Provider] Committed signal ${signal.id.slice(0, 8)}... to registry`);
  } catch (error) {
    console.error('[Provider] Failed to commit signal:', error);
  }
}

// Generate a mock sentiment signal
function generateSignal(): Signal {
  const tokens = ['SOL', 'BONK', 'WIF', 'JUP', 'PYTH', 'JTO', 'RNDR'];
  const token = tokens[Math.floor(Math.random() * tokens.length)];
  
  // Simulate sentiment analysis
  const sentiment = Math.random();
  let direction: 'BUY' | 'SELL' | 'HOLD';
  if (sentiment > 0.65) direction = 'BUY';
  else if (sentiment < 0.35) direction = 'SELL';
  else direction = 'HOLD';

  const signal: Signal = {
    id: crypto.randomUUID(),
    providerId: PROVIDER_NAME,
    timestamp: Date.now(),
    category: 'sentiment' as SignalCategory,
    token,
    direction,
    confidence: 0.5 + (Math.random() * 0.4), // 0.5-0.9
    reason: `Sentiment analysis indicates ${direction.toLowerCase()} pressure on ${token}`,
    timeframe: '1h',
  };

  return signal;
}

// ========== ROUTES ==========

// Health check (free)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    provider: PROVIDER_NAME,
    network: NETWORK,
    payTo: PAY_TO,
    pricePerSignal: `${PRICE_LAMPORTS / 1e9} SOL`
  });
});

// Provider info (free)
app.get('/info', (req, res) => {
  res.json({
    name: PROVIDER_NAME,
    description: 'AI-powered sentiment analysis for Solana tokens',
    categories: ['sentiment'],
    pricing: {
      network: `solana-${NETWORK}`,
      pricePerSignal: PRICE_LAMPORTS,
      priceFormatted: `${PRICE_LAMPORTS / 1e9} SOL`,
      payTo: PAY_TO
    },
    stats: {
      signalsGenerated: signalHistory.size,
      recentSignals: recentSignals.length
    }
  });
});

// Get latest signal (PAID - requires x402 payment)
app.get('/signal/latest', paywall, async (req, res) => {
  const signal = generateSignal();
  
  // Store signal
  signalHistory.set(signal.id, signal);
  recentSignals.push(signal);
  if (recentSignals.length > 100) recentSignals.shift();

  // Commit to registry for reputation tracking
  await commitSignalToRegistry(signal);

  // Get payment info from middleware
  const payment = (req as any).payment;

  console.log(`[Provider] Served signal ${signal.id.slice(0, 8)}... (paid via ${payment?.signature?.slice(0, 16)}...)`);

  res.json({
    signal,
    payment: {
      verified: true,
      signature: payment?.signature,
      amount: payment?.amount
    }
  });
});

// Get signal by ID (PAID)
app.get('/signal/:id', paywall, (req, res) => {
  const signal = signalHistory.get(req.params.id);
  if (!signal) {
    return res.status(404).json({ error: 'Signal not found' });
  }
  res.json({ signal });
});

// Subscribe to signals (returns payment info)
app.get('/subscribe', (req, res) => {
  res.json({
    provider: PROVIDER_NAME,
    instructions: [
      '1. Send SOL payment to the address below',
      '2. Include the tx signature in X-Payment header',
      '3. Request /signal/latest to receive signals'
    ],
    payment: {
      network: `solana-${NETWORK}`,
      recipient: PAY_TO,
      amountLamports: PRICE_LAMPORTS,
      amountSol: PRICE_LAMPORTS / 1e9
    },
    example: {
      curl: `curl -H "X-Payment: <TX_SIGNATURE>" http://localhost:${PORT}/signal/latest`
    }
  });
});

// Historical signals (free preview, limited)
app.get('/signals/preview', (req, res) => {
  const preview = recentSignals.slice(-3).map(s => ({
    id: s.id,
    token: s.token,
    direction: s.direction,
    timestamp: s.timestamp,
    // Hide confidence and reason in preview
  }));

  res.json({
    preview,
    message: 'Pay via x402 to access full signal details',
    fullAccess: '/signal/latest'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║              AgentAlpha Signal Provider                    ║
║                   (Solana x402)                            ║
╠════════════════════════════════════════════════════════════╣
║  Provider: ${PROVIDER_NAME.padEnd(43)}║
║  Network:  Solana ${NETWORK.padEnd(39)}║
║  Price:    ${(PRICE_LAMPORTS / 1e9 + ' SOL').padEnd(43)}║
║  Pay to:   ${PAY_TO.slice(0, 20)}...${PAY_TO.slice(-8).padEnd(16)}║
╠════════════════════════════════════════════════════════════╣
║  Endpoints:                                                ║
║    GET /health         - Health check (free)               ║
║    GET /info           - Provider info (free)              ║
║    GET /subscribe      - Payment instructions              ║
║    GET /signals/preview - Recent signals preview (free)    ║
║    GET /signal/latest  - Latest signal (PAID)              ║
║    GET /signal/:id     - Signal by ID (PAID)               ║
╠════════════════════════════════════════════════════════════╣
║  x402 Flow:                                                ║
║    1. GET /signal/latest → 402 Payment Required            ║
║    2. Send SOL to ${PAY_TO.slice(0, 12)}...                        ║
║    3. Retry with X-Payment: <tx-signature>                 ║
║    4. Receive signal!                                      ║
╚════════════════════════════════════════════════════════════╝
  `);
});

export default app;
