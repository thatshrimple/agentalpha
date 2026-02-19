/**
 * AgentDEX Executor for AgentAlpha Signals
 * 
 * Auto-executes trading signals from AgentAlpha through AgentDEX API.
 * When a high-reputation provider reveals a signal, this module can:
 * 1. Validate the signal against your risk parameters
 * 2. Execute the swap via AgentDEX
 * 3. Record the execution for outcome tracking
 * 
 * Repo: https://github.com/solana-clawd/agent-dex
 */

import { PublicKey } from '@solana/web3.js';
import { Signal, Provider } from './types';

// AgentDEX API configuration
const AGENTDEX_API_URL = process.env.AGENTDEX_API_URL || 'https://agentdex.solana-clawd.dev';
const AGENTDEX_API_KEY = process.env.AGENTDEX_API_KEY || '';

// Common Solana token mints
export const TOKEN_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
};

export interface ExecutorConfig {
  apiUrl?: string;
  apiKey?: string;
  walletPublicKey: string;
  maxSlippageBps?: number; // Max slippage in basis points
  minProviderReputation?: number; // Min reputation score to auto-execute
  minConfidence?: number; // Min confidence to auto-execute
  maxPositionUsd?: number; // Max position size in USD
  dryRun?: boolean; // Simulate without executing
}

export interface ExecutionResult {
  signalHash: string;
  executed: boolean;
  swapSignature?: string;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: number;
  error?: string;
  dryRun: boolean;
}

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: number;
  otherAmountThreshold: string;
}

export class AgentDEXExecutor {
  private config: ExecutorConfig;

  constructor(config: ExecutorConfig) {
    this.config = {
      apiUrl: AGENTDEX_API_URL,
      maxSlippageBps: 100, // 1% default
      minProviderReputation: 0.6, // 60% minimum
      minConfidence: 70, // 70% minimum
      maxPositionUsd: 1000, // $1000 max
      dryRun: false,
      ...config,
    };
  }

  /**
   * Execute a signal from AgentAlpha
   */
  async executeSignal(
    signal: Signal,
    provider: Provider,
    positionSizeUsd: number
  ): Promise<ExecutionResult> {
    const signalHash = this.computeSignalHash(signal);

    // Validate provider reputation
    if (provider.accuracy < this.config.minProviderReputation!) {
      return {
        signalHash,
        executed: false,
        inputAmount: '0',
        outputAmount: '0',
        priceImpactPct: 0,
        error: `Provider reputation ${provider.accuracy} below minimum ${this.config.minProviderReputation}`,
        dryRun: this.config.dryRun!,
      };
    }

    // Validate signal confidence
    if (signal.confidence < this.config.minConfidence!) {
      return {
        signalHash,
        executed: false,
        inputAmount: '0',
        outputAmount: '0',
        priceImpactPct: 0,
        error: `Signal confidence ${signal.confidence} below minimum ${this.config.minConfidence}`,
        dryRun: this.config.dryRun!,
      };
    }

    // Validate position size
    if (positionSizeUsd > this.config.maxPositionUsd!) {
      return {
        signalHash,
        executed: false,
        inputAmount: '0',
        outputAmount: '0',
        priceImpactPct: 0,
        error: `Position size $${positionSizeUsd} exceeds maximum $${this.config.maxPositionUsd}`,
        dryRun: this.config.dryRun!,
      };
    }

    // Determine swap direction
    const { inputMint, outputMint } = this.getSwapMints(signal);
    
    // Convert position size to input amount (in smallest units)
    const inputAmount = this.usdToLamports(positionSizeUsd, signal.token);

    try {
      // Get quote from AgentDEX
      const quote = await this.getQuote(inputMint, outputMint, inputAmount);

      // Check price impact
      if (quote.priceImpactPct > 1.0) {
        return {
          signalHash,
          executed: false,
          inputAmount: quote.inputAmount,
          outputAmount: quote.outputAmount,
          priceImpactPct: quote.priceImpactPct,
          error: `Price impact ${quote.priceImpactPct.toFixed(2)}% too high`,
          dryRun: this.config.dryRun!,
        };
      }

      if (this.config.dryRun) {
        return {
          signalHash,
          executed: false,
          inputAmount: quote.inputAmount,
          outputAmount: quote.outputAmount,
          priceImpactPct: quote.priceImpactPct,
          dryRun: true,
        };
      }

      // Execute the swap
      const swapResult = await this.executeSwap(quote);

      return {
        signalHash,
        executed: true,
        swapSignature: swapResult.signature,
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        priceImpactPct: quote.priceImpactPct,
        dryRun: false,
      };
    } catch (error) {
      return {
        signalHash,
        executed: false,
        inputAmount: '0',
        outputAmount: '0',
        priceImpactPct: 0,
        error: `Execution failed: ${error}`,
        dryRun: this.config.dryRun!,
      };
    }
  }

  /**
   * Get swap quote from AgentDEX
   */
  private async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<QuoteResponse> {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: this.config.maxSlippageBps!.toString(),
    });

    const response = await fetch(`${this.config.apiUrl}/quote?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Quote failed: ${await response.text()}`);
    }

    return response.json();
  }

  /**
   * Execute swap via AgentDEX
   */
  private async executeSwap(quote: QuoteResponse): Promise<{ signature: string }> {
    const response = await fetch(`${this.config.apiUrl}/swap`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: this.config.walletPublicKey,
        dynamicSlippage: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Swap failed: ${await response.text()}`);
    }

    const result = await response.json();
    return { signature: result.swapTransaction };
  }

  /**
   * Determine input/output mints based on signal direction
   */
  private getSwapMints(signal: Signal): { inputMint: string; outputMint: string } {
    const tokenMint = TOKEN_MINTS[signal.token] || TOKEN_MINTS.SOL;
    const stableMint = TOKEN_MINTS.USDC;

    // BUY/LONG: USDC -> Token
    // SELL/SHORT: Token -> USDC
    if (signal.direction === 0 || signal.direction.toString().toUpperCase() === 'BUY') {
      return { inputMint: stableMint, outputMint: tokenMint };
    } else {
      return { inputMint: tokenMint, outputMint: stableMint };
    }
  }

  /**
   * Convert USD to lamports (simplified, assumes SOL for now)
   */
  private usdToLamports(usd: number, _token: string): number {
    // This is simplified - in production, fetch current price
    const SOL_PRICE_USD = 150; // Example price
    const solAmount = usd / SOL_PRICE_USD;
    return Math.floor(solAmount * 1e9); // Convert to lamports
  }

  /**
   * Compute signal hash for tracking
   */
  private computeSignalHash(signal: Signal): string {
    const input = `${signal.token}:${signal.direction}:${signal.entryPrice}:${signal.takeProfit}:${signal.stopLoss}:${signal.timeframeHours}:${signal.confidence}`;
    // Simple hash for demo - use proper crypto hash in production
    return Buffer.from(input).toString('hex').slice(0, 16);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}

/**
 * Subscribe to AgentAlpha signals and auto-execute via AgentDEX
 * 
 * Usage:
 * ```typescript
 * const executor = new AgentDEXExecutor({
 *   walletPublicKey: 'your-wallet',
 *   minProviderReputation: 0.7,
 *   maxPositionUsd: 500,
 * });
 * 
 * // When signal is revealed:
 * const result = await executor.executeSignal(signal, provider, 100);
 * if (result.executed) {
 *   console.log(`Trade executed: ${result.swapSignature}`);
 * }
 * ```
 */
export async function createExecutorFromEnv(): Promise<AgentDEXExecutor> {
  const config: ExecutorConfig = {
    walletPublicKey: process.env.WALLET_PUBLIC_KEY || '',
    apiUrl: process.env.AGENTDEX_API_URL,
    apiKey: process.env.AGENTDEX_API_KEY,
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '100'),
    minProviderReputation: parseFloat(process.env.MIN_PROVIDER_REPUTATION || '0.6'),
    minConfidence: parseInt(process.env.MIN_CONFIDENCE || '70'),
    maxPositionUsd: parseFloat(process.env.MAX_POSITION_USD || '1000'),
    dryRun: process.env.DRY_RUN === 'true',
  };

  return new AgentDEXExecutor(config);
}
