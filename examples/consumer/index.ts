/**
 * AgentAlpha - Example Signal Consumer
 * 
 * A demo trading agent that:
 * 1. Discovers signal providers from the registry
 * 2. Pays for signals via x402
 * 3. Processes signals for trading decisions
 */

import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import type { Signal, Provider } from '../../src/types.js';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY as `0x${string}`;
const PROVIDER_URL = process.env.PROVIDER_URL || 'http://localhost:4021';
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4020';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '60000'); // 1 minute

if (!PRIVATE_KEY) {
  console.error('❌ EVM_PRIVATE_KEY environment variable required');
  console.log('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.log('   Then fund it with testnet USDC on Base Sepolia');
  process.exit(1);
}

// Setup x402 client
const signer = privateKeyToAccount(PRIVATE_KEY);
const client = new x402Client();
registerExactEvmScheme(client, { signer });

// Wrap fetch with automatic payment handling
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

console.log(`
╔════════════════════════════════════════════════════════════╗
║                   AgentAlpha Signal Consumer               ║
╠════════════════════════════════════════════════════════════╣
║  Wallet:   ${signer.address.slice(0, 10)}...${signer.address.slice(-8).padEnd(29)}║
║  Provider: ${PROVIDER_URL.padEnd(43)}║
║  Interval: ${(POLL_INTERVAL / 1000).toString().padEnd(5)}s                                       ║
╚════════════════════════════════════════════════════════════╝
`);

// Track processed signals to avoid duplicates
const processedSignals = new Set<string>();

// Signal processing callback
type SignalHandler = (signal: Signal) => void;

class SignalConsumer {
  private handlers: SignalHandler[] = [];
  private running = false;

  // Register a handler for new signals
  onSignal(handler: SignalHandler): void {
    this.handlers.push(handler);
  }

  // Fetch latest signal from provider (pays via x402)
  async fetchLatestSignal(providerUrl: string): Promise<Signal | null> {
    try {
      console.log(`📡 Fetching signal from ${providerUrl}/signal/latest`);
      
      const response = await fetchWithPayment(`${providerUrl}/signal/latest`, {
        method: 'GET',
      });

      if (!response.ok) {
        console.error(`❌ Failed to fetch signal: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json() as { signal: Signal };
      
      // Check for payment receipt
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => response.headers.get(name)
      );
      
      if (paymentResponse) {
        console.log(`💰 Payment settled: ${'txHash' in paymentResponse ? (paymentResponse as any).txHash : 'confirmed'}`);
      }

      return data.signal;
    } catch (error) {
      console.error('❌ Error fetching signal:', error);
      return null;
    }
  }

  // Fetch bulk signals (recent)
  async fetchRecentSignals(providerUrl: string): Promise<Signal[]> {
    try {
      console.log(`📡 Fetching recent signals from ${providerUrl}/signals`);
      
      const response = await fetchWithPayment(`${providerUrl}/signals`, {
        method: 'GET',
      });

      if (!response.ok) {
        console.error(`❌ Failed to fetch signals: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json() as { signals: Signal[] };
      return data.signals;
    } catch (error) {
      console.error('❌ Error fetching signals:', error);
      return [];
    }
  }

  // Process a signal
  private processSignal(signal: Signal): void {
    if (processedSignals.has(signal.id)) {
      return; // Already processed
    }

    processedSignals.add(signal.id);
    console.log(`\n🔔 NEW SIGNAL RECEIVED:`);
    console.log(`   Token:      ${signal.token}`);
    console.log(`   Direction:  ${signal.direction}`);
    console.log(`   Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
    console.log(`   Reason:     ${signal.reason || 'N/A'}`);
    console.log(`   Timeframe:  ${signal.timeframe || 'N/A'}`);
    console.log(`   ID:         ${signal.id}`);

    // Call registered handlers
    for (const handler of this.handlers) {
      try {
        handler(signal);
      } catch (error) {
        console.error('Error in signal handler:', error);
      }
    }
  }

  // Start polling for signals
  async start(providerUrl: string, intervalMs: number): Promise<void> {
    this.running = true;
    console.log(`🚀 Starting signal consumer, polling every ${intervalMs / 1000}s`);

    // Initial fetch
    const signal = await this.fetchLatestSignal(providerUrl);
    if (signal) {
      this.processSignal(signal);
    }

    // Polling loop
    while (this.running) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      
      if (!this.running) break;

      const newSignal = await this.fetchLatestSignal(providerUrl);
      if (newSignal) {
        this.processSignal(newSignal);
      }
    }
  }

  // Stop polling
  stop(): void {
    this.running = false;
    console.log('🛑 Stopping signal consumer');
  }
}

// Demo trading logic
function demoTradingLogic(signal: Signal): void {
  if (signal.confidence < 0.6) {
    console.log(`   ⏸️  Confidence too low (${(signal.confidence * 100).toFixed(1)}%), skipping`);
    return;
  }

  if (signal.direction === 'BUY') {
    console.log(`   ✅ WOULD BUY ${signal.token} based on ${signal.category} signal`);
  } else if (signal.direction === 'SELL') {
    console.log(`   ✅ WOULD SELL ${signal.token} based on ${signal.category} signal`);
  } else {
    console.log(`   ⏸️  HOLD signal, no action`);
  }
}

// Main
async function main() {
  const consumer = new SignalConsumer();
  
  // Register trading logic
  consumer.onSignal(demoTradingLogic);

  // Handle shutdown
  process.on('SIGINT', () => {
    consumer.stop();
    process.exit(0);
  });

  // Start consuming signals
  await consumer.start(PROVIDER_URL, POLL_INTERVAL);
}

main().catch(console.error);
