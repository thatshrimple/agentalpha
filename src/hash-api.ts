/**
 * AgentAlpha - Hash Generation API
 * 
 * Generates hashes for on-chain signal commits.
 * Format: {token}:{direction}:{entry}:{tp}:{sl}:{timeframe}:{confidence}
 */

import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

interface SignalInput {
  token: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  takeProfit: number;
  stopLoss: number;
  timeframeHours: number;
  confidence: number;
}

function generateHash(signal: SignalInput): { hash: string; bytes: number[]; input: string } {
  const dirNum = signal.direction === 'BUY' ? 0 : 1;
  const entryInt = Math.round(signal.entry * 100);
  const tpInt = Math.round(signal.takeProfit * 100);
  const slInt = Math.round(signal.stopLoss * 100);
  
  const input = `${signal.token}:${dirNum}:${entryInt}:${tpInt}:${slInt}:${signal.timeframeHours}:${signal.confidence}`;
  const hashBuffer = crypto.createHash('sha256').update(input).digest();
  
  return {
    hash: '0x' + hashBuffer.toString('hex'),
    bytes: Array.from(hashBuffer),
    input
  };
}

/**
 * GET /hash/docs - Documentation for hash format
 */
router.get('/docs', (req, res) => {
  res.json({
    title: 'AgentAlpha Signal Hash Format',
    programId: 'D5YAmNYP554B3NmzmBZxHduNCpd7K3TfDpstzCGfiw7A',
    network: 'devnet',
    
    format: {
      token: 'string - Token symbol (e.g., "SOL")',
      direction: '"BUY" or "SELL"',
      entry: 'number - Entry price in dollars',
      takeProfit: 'number - Take profit price',
      stopLoss: 'number - Stop loss price',
      timeframeHours: 'number - Evaluation window (1-72)',
      confidence: 'number - Confidence level (0-100)'
    },
    
    validation: {
      BUY: 'takeProfit > entry > stopLoss',
      SELL: 'stopLoss > entry > takeProfit'
    },
    
    outcomes: {
      'TP_HIT (1)': 'Price hit take profit → correct',
      'SL_HIT (2)': 'Price hit stop loss → wrong',
      'EXPIRED (3)': 'Neither hit → correct if profit'
    },
    
    example: {
      input: {
        token: 'SOL',
        direction: 'BUY',
        entry: 95.00,
        takeProfit: 105.00,
        stopLoss: 90.00,
        timeframeHours: 24,
        confidence: 85
      },
      humanReadable: 'BUY SOL @ 95 → TP 105 / SL 90 (24h) 85%'
    }
  });
});

/**
 * POST /hash - Generate signal hash
 */
router.post('/', (req, res) => {
  const { token, direction, entry, takeProfit, stopLoss, timeframeHours, confidence } = req.body;
  
  // Validate required fields
  const missing = [];
  if (!token) missing.push('token');
  if (!direction) missing.push('direction');
  if (entry === undefined) missing.push('entry');
  if (takeProfit === undefined) missing.push('takeProfit');
  if (stopLoss === undefined) missing.push('stopLoss');
  if (timeframeHours === undefined) missing.push('timeframeHours');
  if (confidence === undefined) missing.push('confidence');
  
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'Missing required fields',
      missing,
      docs: '/hash/docs'
    });
  }
  
  // Validate direction
  if (!['BUY', 'SELL'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "BUY" or "SELL"' });
  }
  
  // Validate ranges
  if (timeframeHours < 1 || timeframeHours > 72) {
    return res.status(400).json({ error: 'timeframeHours must be 1-72' });
  }
  if (confidence < 0 || confidence > 100) {
    return res.status(400).json({ error: 'confidence must be 0-100' });
  }
  
  // Validate TP/SL logic
  if (direction === 'BUY') {
    if (takeProfit <= entry) return res.status(400).json({ error: 'BUY: takeProfit must be > entry' });
    if (stopLoss >= entry) return res.status(400).json({ error: 'BUY: stopLoss must be < entry' });
  } else {
    if (takeProfit >= entry) return res.status(400).json({ error: 'SELL: takeProfit must be < entry' });
    if (stopLoss <= entry) return res.status(400).json({ error: 'SELL: stopLoss must be > entry' });
  }
  
  const { hash, bytes, input } = generateHash({
    token, direction, entry, takeProfit, stopLoss, timeframeHours, confidence
  });
  
  const rr = direction === 'BUY' 
    ? ((takeProfit - entry) / (entry - stopLoss)).toFixed(2)
    : ((entry - takeProfit) / (stopLoss - entry)).toFixed(2);
  
  res.json({
    success: true,
    signal: {
      token,
      direction,
      entry,
      takeProfit,
      stopLoss,
      timeframeHours,
      confidence,
      humanReadable: `${direction} ${token} @ ${entry} → TP ${takeProfit} / SL ${stopLoss} (${timeframeHours}h) ${confidence}%`
    },
    hash: {
      hex: hash,
      bytes,
      input
    },
    analysis: {
      riskRewardRatio: rr
    },
    onChain: {
      step1: 'Call commitSignal(hashBytes) on program D5YAmNYP554B3NmzmBZxHduNCpd7K3TfDpstzCGfiw7A',
      step2: 'Wait for evaluation window',
      step3: 'Call revealSignal with signal data',
      step4: 'Oracle records outcome'
    }
  });
});

export { router as hashRouter };
