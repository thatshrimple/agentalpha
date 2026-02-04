/**
 * AgentAlpha SDK
 * 
 * Main entry point for the AgentAlpha signal marketplace SDK.
 */

export * from './types.js';
export { registry } from './registry.js';
export { reputationTracker } from './reputation.js';
export * from './onchain.js';

// Re-export for convenience
import type { Signal, Provider, SignalCategory } from './types.js';

/**
 * Create a signal provider configuration for x402
 */
export function createProviderConfig(options: {
  payTo: string;
  pricePerSignal: string;
  network?: string;
  description?: string;
}) {
  return {
    accepts: [
      {
        scheme: 'exact',
        price: options.pricePerSignal,
        network: options.network || 'eip155:84532', // Base Sepolia default
        payTo: options.payTo,
      },
    ],
    description: options.description || 'AgentAlpha Signal Provider',
    mimeType: 'application/json',
  };
}

/**
 * Utility to hash a signal for commit-reveal verification
 */
export function hashSignal(signal: Signal): string {
  const data = JSON.stringify({
    token: signal.token,
    direction: signal.direction,
    confidence: signal.confidence,
    timestamp: signal.timestamp,
  });
  
  // Note: Use crypto.subtle in browser, crypto in Node
  if (typeof window !== 'undefined') {
    // Browser
    const encoder = new TextEncoder();
    return Array.from(encoder.encode(data))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Node.js
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

/**
 * Calculate reputation score from outcomes
 */
export function calculateReputation(outcomes: Array<{ wasCorrect: boolean; returnPercent: number }>) {
  if (outcomes.length === 0) {
    return { hitRate: 0, avgReturn: 0 };
  }

  const correct = outcomes.filter(o => o.wasCorrect).length;
  const hitRate = (correct / outcomes.length) * 100;
  const avgReturn = outcomes.reduce((sum, o) => sum + o.returnPercent, 0) / outcomes.length;

  return { hitRate, avgReturn };
}
