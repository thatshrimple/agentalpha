/**
 * AgentAlpha Demo API
 * 
 * Endpoints for live demos - allows commit/reveal via API
 * using a server-side demo wallet.
 */

import { Router } from 'express';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AgentAlphaClient, SignalInput } from './onchain.js';
import { createHash } from 'crypto';

const router = Router();

// Demo wallet - loaded lazily on first use
let demoWallet: Keypair | null = null;
let demoClient: AgentAlphaClient | null = null;
let initError: string | null = null;

const DEVNET_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

// Initialize demo wallet (lazy - called on first request)
function initDemoWallet(): boolean {
  if (demoWallet && demoClient) return true;
  if (initError) return false;
  
  try {
    if (process.env.DEMO_WALLET_SECRET) {
      // Load from environment (JSON array of numbers)
      const secret = JSON.parse(process.env.DEMO_WALLET_SECRET);
      demoWallet = Keypair.fromSecretKey(Uint8Array.from(secret));
      console.log(`🎭 Demo wallet loaded: ${demoWallet.publicKey.toBase58()}`);
    } else {
      // Use the deploy wallet (4b3SxY...) - same as registered provider
      const secret = [195,216,61,155,33,232,121,80,185,213,143,45,187,43,122,13,143,34,56,237,175,122,193,162,231,53,195,120,115,20,10,20,53,163,197,174,198,207,117,77,209,120,49,13,132,127,152,210,7,140,63,71,113,101,201,176,197,186,15,115,249,163,54,231];
      demoWallet = Keypair.fromSecretKey(Uint8Array.from(secret));
      console.log(`🎭 Demo wallet: ${demoWallet.publicKey.toBase58()}`);
    }

    const connection = new Connection(DEVNET_RPC, 'confirmed');
    demoClient = new AgentAlphaClient(connection, demoWallet);
    return true;
  } catch (error: any) {
    initError = error.message;
    console.error(`❌ Demo wallet init failed: ${error.message}`);
    return false;
  }
}

// Middleware to ensure demo is initialized
function requireDemoInit(req: any, res: any, next: any) {
  if (!initDemoWallet()) {
    return res.status(503).json({ 
      error: 'Demo API not available', 
      reason: initError,
      hint: 'The demo wallet could not be initialized. Try again later.'
    });
  }
  next();
}

/**
 * Compute signal hash matching the on-chain format
 */
function computeSignalHash(
  token: string,
  direction: 'BUY' | 'SELL',
  entry: number,
  takeProfit: number,
  stopLoss: number,
  timeframeHours: number,
  confidence: number
): { hex: string; bytes: number[] } {
  const directionNum = direction === 'BUY' ? 0 : 1;
  // Match the format from /hash endpoint
  const input = `${token}:${directionNum}:${Math.round(entry * 100)}:${Math.round(takeProfit * 100)}:${Math.round(stopLoss * 100)}:${timeframeHours}:${confidence}`;
  const hash = createHash('sha256').update(input).digest();
  return {
    hex: '0x' + hash.toString('hex'),
    bytes: Array.from(hash)
  };
}

// GET /demo/status - Check demo wallet status
router.get('/status', requireDemoInit, async (req, res) => {
  try {
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const balance = await connection.getBalance(demoWallet!.publicKey);
    
    // Check if registered as provider
    const provider = await demoClient!.getProvider(demoWallet!.publicKey);
    
    res.json({
      success: true,
      demo: {
        wallet: demoWallet!.publicKey.toBase58(),
        balanceSOL: balance / 1e9,
        balanceLamports: balance,
        isProvider: !!provider,
        providerName: provider?.name || null,
        totalSignals: provider ? Number(provider.totalSignals) : 0,
      },
      network: 'devnet',
      rpc: DEVNET_RPC,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /demo/commit - Commit a signal hash on-chain
router.post('/commit', requireDemoInit, async (req, res) => {
  try {
    const { token, direction, entry, takeProfit, stopLoss, timeframeHours, confidence } = req.body;

    // Validate
    if (!token || !direction || !entry || !takeProfit || !stopLoss || !timeframeHours || !confidence) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['token', 'direction', 'entry', 'takeProfit', 'stopLoss', 'timeframeHours', 'confidence'],
        example: {
          token: 'SOL',
          direction: 'BUY',
          entry: 120,
          takeProfit: 150,
          stopLoss: 110,
          timeframeHours: 24,
          confidence: 85
        }
      });
    }

    // Compute hash
    const hash = computeSignalHash(token, direction, entry, takeProfit, stopLoss, timeframeHours, confidence);
    
    // Commit on-chain
    console.log(`🔐 Committing signal: ${direction} ${token} @ ${entry}...`);
    const txSignature = await demoClient!.commitSignal(Uint8Array.from(hash.bytes));

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
        hex: hash.hex,
        bytes: hash.bytes,
      },
      onChain: {
        transaction: txSignature,
        explorer: `https://solscan.io/tx/${txSignature}?cluster=devnet`,
        wallet: demoWallet!.publicKey.toBase58(),
      },
      nextStep: 'Wait for price to move, then call POST /demo/reveal with the same signal data'
    });
  } catch (error: any) {
    console.error('Commit error:', error);
    
    if (error.message?.includes('already in use')) {
      return res.status(409).json({
        error: 'Signal already committed',
        hint: 'This exact signal hash was already committed. Try different parameters.'
      });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// POST /demo/reveal - Reveal a committed signal
router.post('/reveal', requireDemoInit, async (req, res) => {
  try {
    const { token, direction, entry, takeProfit, stopLoss, timeframeHours, confidence } = req.body;

    // Validate
    if (!token || !direction || !entry || !takeProfit || !stopLoss || !timeframeHours || !confidence) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['token', 'direction', 'entry', 'takeProfit', 'stopLoss', 'timeframeHours', 'confidence'],
        note: 'Use the EXACT same values you used for /demo/commit'
      });
    }

    // Compute hash (must match what was committed)
    const hash = computeSignalHash(token, direction, entry, takeProfit, stopLoss, timeframeHours, confidence);
    
    // Build signal input
    const signal: SignalInput = {
      token,
      direction: direction as 'BUY' | 'SELL',
      entry,
      takeProfit,
      stopLoss,
      timeframeHours,
      confidence
    };
    
    // Reveal on-chain
    console.log(`🔓 Revealing signal: ${direction} ${token} @ ${entry}...`);
    const txSignature = await demoClient!.revealSignal(signal, Uint8Array.from(hash.bytes));

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
      revealed: {
        hash: hash.hex,
      },
      onChain: {
        transaction: txSignature,
        explorer: `https://solscan.io/tx/${txSignature}?cluster=devnet`,
      },
      verification: 'Anyone can now verify the hash matches what was committed!'
    });
  } catch (error: any) {
    console.error('Reveal error:', error);
    
    if (error.message?.includes('AlreadyRevealed')) {
      return res.status(409).json({
        error: 'Signal already revealed',
        hint: 'This signal was already revealed.'
      });
    }
    
    if (error.message?.includes('not found') || error.message?.includes('AccountNotInitialized')) {
      return res.status(404).json({
        error: 'Signal commitment not found',
        hint: 'Make sure you committed this signal first with POST /demo/commit'
      });
    }
    
    res.status(500).json({ error: error.message });
  }
});

export default router;
