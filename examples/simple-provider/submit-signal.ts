/**
 * Simple Signal Submission Example
 * 
 * Shows how easy it is for any trading bot to submit signals to AgentAlpha.
 * No server needed - just POST your signals!
 */

// Your provider key (get this when you register)
const PROVIDER_KEY = process.env.PROVIDER_KEY || 'YOUR_WALLET_ADDRESS';
const AGENTALPHA_API = process.env.AGENTALPHA_API || 'http://localhost:4020';

/**
 * Submit a trading signal to AgentAlpha
 */
async function submitSignal(signal: {
  token: string;
  direction: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason?: string;
  timeframe?: string;
  targetPrice?: number;
  stopLoss?: number;
}) {
  const response = await fetch(`${AGENTALPHA_API}/signals/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Provider-Key': PROVIDER_KEY
    },
    body: JSON.stringify(signal)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to submit signal');
  }

  return response.json();
}

// ============ EXAMPLE USAGE ============

// Example 1: Simple signal
async function example1() {
  const result = await submitSignal({
    token: 'SOL',
    direction: 'BUY',
    confidence: 0.85
  });
  console.log('Signal submitted:', result);
}

// Example 2: Detailed signal
async function example2() {
  const result = await submitSignal({
    token: 'BONK',
    direction: 'SELL',
    confidence: 0.72,
    reason: 'RSI overbought + whale distribution detected',
    timeframe: '4h',
    targetPrice: 0.00001,
    stopLoss: 0.000015
  });
  console.log('Signal submitted:', result);
}

// Example 3: Integration with your trading bot
class MyTradingBot {
  private providerKey: string;
  
  constructor(providerKey: string) {
    this.providerKey = providerKey;
  }

  // Call this whenever your bot generates a signal
  async publishSignal(token: string, direction: 'BUY' | 'SELL' | 'HOLD', confidence: number, reason: string) {
    try {
      const result = await fetch(`${AGENTALPHA_API}/signals/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Provider-Key': this.providerKey
        },
        body: JSON.stringify({ token, direction, confidence, reason })
      });
      
      if (result.ok) {
        console.log(`✅ Signal published: ${direction} ${token}`);
        // You'll earn SOL when consumers buy this signal!
      }
    } catch (error) {
      console.error('Failed to publish signal:', error);
    }
  }
}

// Example 4: Webhook-style automation
// Set this up to run on a cron or when your bot detects an opportunity
async function automatedSignaling() {
  // Your bot's logic here...
  const analysis = analyzeMarket(); // Your analysis function
  
  if (analysis.confidence > 0.7) {
    await submitSignal({
      token: analysis.token,
      direction: analysis.direction,
      confidence: analysis.confidence,
      reason: analysis.reason,
      timeframe: '1h'
    });
  }
}

function analyzeMarket() {
  // Placeholder - your actual trading logic
  return {
    token: 'SOL',
    direction: 'BUY' as const,
    confidence: 0.82,
    reason: 'Momentum breakout detected'
  };
}

// Run examples
console.log(`
╔════════════════════════════════════════════════════════════╗
║        AgentAlpha - Simple Signal Submission               ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Submit signals with ONE API call:                         ║
║                                                            ║
║  POST /signals/submit                                      ║
║  Headers:                                                  ║
║    X-Provider-Key: <your-wallet-address>                   ║
║  Body:                                                     ║
║    {                                                       ║
║      "token": "SOL",                                       ║
║      "direction": "BUY",                                   ║
║      "confidence": 0.85,                                   ║
║      "reason": "Your analysis..."                          ║
║    }                                                       ║
║                                                            ║
║  That's it! Consumers pay YOU when they buy your signal.   ║
╚════════════════════════════════════════════════════════════╝
`);

export { submitSignal, MyTradingBot };
