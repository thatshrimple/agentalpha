/**
 * AgentAlpha - Example Signal Provider
 * 
 * A demo signal provider that generates mock sentiment signals.
 * Protected by x402 micropayments - consumers pay per signal.
 */

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import crypto from 'crypto';
import type { Signal, SignalCategory } from '../../src/types.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 4021;
const PROVIDER_NAME = process.env.PROVIDER_NAME || 'SentimentBot Alpha';
const PAY_TO = process.env.PAY_TO || '0x0000000000000000000000000000000000000000'; // Replace with your wallet!
const PRICE_PER_SIGNAL = process.env.PRICE_PER_SIGNAL || '$0.001';
const NETWORK = process.env.NETWORK || 'eip155:84532'; // Base Sepolia for testing

// x402 Setup
const facilitatorClient = new HTTPFacilitatorClient({
  url: 'https://x402.org/facilitator' // Testnet facilitator
});

const server = new x402ResourceServer(facilitatorClient)
  .register((NETWORK.split(':')[0] === 'eip155' ? NETWORK : 'eip155:84532') as `${string}:${string}`, new ExactEvmScheme());

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
  
  // Mock sentiment analysis (in real provider, this would be actual analysis)
  const sentiment = Math.random();
  let direction: Signal['direction'];
  let confidence: number;
  
  if (sentiment > 0.7) {
    direction = 'BUY';
    confidence = 0.6 + Math.random() * 0.35;
  } else if (sentiment < 0.3) {
    direction = 'SELL';
    confidence = 0.6 + Math.random() * 0.35;
  } else {
    direction = 'HOLD';
    confidence = 0.4 + Math.random() * 0.3;
  }

  const signal: Signal = {
    id: crypto.randomUUID(),
    providerId: 'sentiment-bot-alpha',
    timestamp: Date.now(),
    category: 'sentiment' as SignalCategory,
    token,
    direction,
    confidence: Math.round(confidence * 100) / 100,
    reason: `Sentiment score: ${Math.round(sentiment * 100)}% - ${direction === 'BUY' ? 'Bullish' : direction === 'SELL' ? 'Bearish' : 'Neutral'} social signals detected`,
    timeframe: '4h',
    metadata: {
      sentimentScore: sentiment,
      source: 'social_aggregator',
      sampleSize: Math.floor(Math.random() * 1000) + 500,
    }
  };

  // Store in history
  signalHistory.set(signal.id, signal);
  recentSignals.push(signal);
  if (recentSignals.length > 100) recentSignals.shift();

  // Commit to registry for reputation tracking (fire and forget)
  commitSignalToRegistry(signal);

  return signal;
}

// Generate initial signals
for (let i = 0; i < 5; i++) {
  generateSignal();
}

// Generate new signal every 30 seconds
setInterval(generateSignal, 30000);

// ========== ROUTES ==========

// Health check (free)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    provider: PROVIDER_NAME,
    signalsGenerated: signalHistory.size
  });
});

// Provider info (free)
app.get('/info', (req, res) => {
  res.json({
    id: 'sentiment-bot-alpha',
    name: PROVIDER_NAME,
    description: 'AI-powered sentiment analysis for Solana tokens. Aggregates social signals from Twitter, Discord, and Telegram.',
    categories: ['sentiment'],
    pricePerSignal: PRICE_PER_SIGNAL,
    network: NETWORK,
    endpoint: `http://localhost:${PORT}`,
    stats: {
      totalSignals: signalHistory.size,
      uptime: process.uptime(),
    }
  });
});

// Apply x402 payment middleware to protected routes
app.use(
  paymentMiddleware(
    {
      'GET /signal/latest': {
        accepts: [
          {
            scheme: 'exact',
            price: PRICE_PER_SIGNAL,
            network: NETWORK as `${string}:${string}`,
            payTo: PAY_TO,
          },
        ],
        description: 'Get the latest sentiment signal',
        mimeType: 'application/json',
      },
      'GET /signals': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.005', // Bulk discount
            network: NETWORK as `${string}:${string}`,
            payTo: PAY_TO,
          },
        ],
        description: 'Get recent sentiment signals (last 10)',
        mimeType: 'application/json',
      },
      'GET /signal/:id': {
        accepts: [
          {
            scheme: 'exact',
            price: PRICE_PER_SIGNAL,
            network: NETWORK as `${string}:${string}`,
            payTo: PAY_TO,
          },
        ],
        description: 'Get a specific signal by ID',
        mimeType: 'application/json',
      },
    },
    server
  )
);

// Latest signal (PAID)
app.get('/signal/latest', (req, res) => {
  const latest = recentSignals[recentSignals.length - 1];
  if (!latest) {
    return res.status(404).json({ error: 'No signals available' });
  }
  res.json({ signal: latest });
});

// Recent signals (PAID - bulk)
app.get('/signals', (req, res) => {
  const signals = recentSignals.slice(-10);
  res.json({ 
    signals,
    count: signals.length,
    provider: PROVIDER_NAME
  });
});

// Specific signal by ID (PAID)
app.get('/signal/:id', (req, res) => {
  const signal = signalHistory.get(req.params.id);
  if (!signal) {
    return res.status(404).json({ error: 'Signal not found' });
  }
  res.json({ signal });
});

// Register with the registry on startup
async function registerWithRegistry(): Promise<void> {
  try {
    const response = await fetch(`${REGISTRY_URL}/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: PROVIDER_NAME,
        description: 'AI-powered sentiment analysis for Solana tokens. Aggregates social signals from Twitter, Discord, and Telegram.',
        endpoint: `http://localhost:${PORT}`,
        categories: ['sentiment'],
        pricePerSignal: PRICE_PER_SIGNAL,
        network: NETWORK,
        payTo: PAY_TO,
      }),
    });
    
    if (response.ok) {
      const data = await response.json() as { provider: { id: string } };
      console.log(`[Provider] Registered with registry as ${data.provider.id}`);
    } else {
      console.warn('[Provider] Failed to register with registry (may already be registered)');
    }
  } catch (error) {
    console.warn('[Provider] Registry not available, running standalone');
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                   AgentAlpha Signal Provider               ║
╠════════════════════════════════════════════════════════════╣
║  Provider: ${PROVIDER_NAME.padEnd(43)}║
║  Endpoint: http://localhost:${String(PORT).padEnd(29)}║
║  Price:    ${PRICE_PER_SIGNAL.padEnd(43)}║
║  Network:  ${NETWORK.padEnd(43)}║
║  Pay To:   ${PAY_TO.slice(0, 10)}...${PAY_TO.slice(-8).padEnd(29)}║
╠════════════════════════════════════════════════════════════╣
║  Routes:                                                   ║
║    GET /health        - Health check (free)                ║
║    GET /info          - Provider info (free)               ║
║    GET /signal/latest - Latest signal (paid)               ║
║    GET /signals       - Recent signals (paid)              ║
║    GET /signal/:id    - Specific signal (paid)             ║
╚════════════════════════════════════════════════════════════╝
  `);
  
  // Register with registry
  await registerWithRegistry();
});
