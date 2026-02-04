/**
 * AgentAlpha - Core Types
 * Types for the agent signal marketplace
 */

// Signal categories
export type SignalCategory = 
  | 'sentiment'      // Social/news sentiment analysis
  | 'whale'          // Large wallet movements
  | 'momentum'       // Technical momentum signals
  | 'arbitrage'      // Cross-exchange opportunities
  | 'news'           // Breaking news alerts
  | 'onchain'        // On-chain analytics
  | 'custom';        // Custom/other signals

// Signal direction
export type SignalDirection = 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL';

// A trading signal
export interface Signal {
  id: string;                    // Unique signal ID
  providerId: string;            // Provider who generated this signal
  timestamp: number;             // Unix timestamp (ms)
  category: SignalCategory;      // Signal category
  
  // The actual signal data
  token: string;                 // Token symbol (e.g., "SOL", "BONK")
  tokenAddress?: string;         // Token mint address (Solana)
  direction: SignalDirection;    // BUY/SELL/HOLD
  confidence: number;            // 0-1 confidence score
  
  // Optional metadata
  reason?: string;               // Human-readable reason
  timeframe?: string;            // Expected timeframe (e.g., "1h", "4h", "1d")
  targetPrice?: number;          // Target price if applicable
  stopLoss?: number;             // Suggested stop loss
  metadata?: Record<string, any>; // Additional data
}

// Provider registration info
export interface Provider {
  id: string;                    // Unique provider ID
  name: string;                  // Display name
  description: string;           // What signals they provide
  endpoint: string;              // x402 endpoint URL
  categories: SignalCategory[];  // Signal categories offered
  
  // Pricing
  pricePerSignal: string;        // Price in USD (e.g., "$0.001")
  network: string;               // Payment network (e.g., "eip155:84532")
  payTo: string;                 // Wallet address for payments
  
  // Reputation (updated over time)
  reputation: ProviderReputation;
  
  // On-chain link (optional)
  onChainAuthority?: string;     // Solana pubkey if registered on-chain
  
  // Metadata
  createdAt: number;
  updatedAt: number;
  lastSeen?: number;             // Last sync from chain
}

// Provider reputation tracking
export interface ProviderReputation {
  totalSignals: number;          // Total signals issued
  correctSignals: number;        // Signals that hit target
  avgReturn: number;             // Average return per signal (%)
  hitRate: number;               // Percentage correct (0-100)
  avgConfidence: number;         // Average confidence score
  lastUpdated: number;           // Last reputation update
}

// Signal commit (for verification)
export interface SignalCommit {
  providerId: string;
  signalHash: string;            // SHA256 hash of signal JSON
  timestamp: number;
  revealed: boolean;
  signal?: Signal;               // Populated after reveal
  outcome?: SignalOutcome;       // Populated after evaluation
}

// Signal outcome for reputation
export interface SignalOutcome {
  signalId: string;
  priceAtSignal: number;
  priceAtEvaluation: number;
  evaluationTimestamp: number;
  wasCorrect: boolean;
  returnPercent: number;
}

// Registry API types
export interface ProviderListResponse {
  providers: Provider[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProviderSearchParams {
  category?: SignalCategory;
  minReputation?: number;
  maxPrice?: string;
  page?: number;
  pageSize?: number;
}
