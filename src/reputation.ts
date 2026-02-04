/**
 * AgentAlpha - Reputation System
 * 
 * Tracks signal provider reputation based on signal outcomes.
 * MVP: Off-chain tracking. Future: On-chain commit-reveal.
 */

import crypto from 'crypto';
import type { Signal, SignalCommit, SignalOutcome, ProviderReputation } from './types.js';

class ReputationTracker {
  private commits: Map<string, SignalCommit> = new Map();
  private outcomes: Map<string, SignalOutcome[]> = new Map(); // providerId -> outcomes

  /**
   * Commit a signal (hash only) before revealing
   * This proves the provider had the signal at a specific time
   */
  commitSignal(signal: Signal): SignalCommit {
    const signalData = JSON.stringify({
      token: signal.token,
      direction: signal.direction,
      confidence: signal.confidence,
      timestamp: signal.timestamp,
    });
    
    const signalHash = crypto.createHash('sha256').update(signalData).digest('hex');
    
    const commit: SignalCommit = {
      providerId: signal.providerId,
      signalHash,
      timestamp: Date.now(),
      revealed: false,
    };

    this.commits.set(signal.id, commit);
    console.log(`[Reputation] Committed signal ${signal.id.slice(0, 8)}... hash: ${signalHash.slice(0, 16)}...`);
    
    return commit;
  }

  /**
   * Reveal a signal (full data) after commit
   */
  revealSignal(signalId: string, signal: Signal): boolean {
    const commit = this.commits.get(signalId);
    if (!commit) {
      console.error(`[Reputation] No commit found for signal ${signalId}`);
      return false;
    }

    if (commit.revealed) {
      console.error(`[Reputation] Signal ${signalId} already revealed`);
      return false;
    }

    // Verify hash matches
    const signalData = JSON.stringify({
      token: signal.token,
      direction: signal.direction,
      confidence: signal.confidence,
      timestamp: signal.timestamp,
    });
    
    const computedHash = crypto.createHash('sha256').update(signalData).digest('hex');
    
    if (computedHash !== commit.signalHash) {
      console.error(`[Reputation] Hash mismatch! Signal may have been altered.`);
      return false;
    }

    commit.revealed = true;
    commit.signal = signal;
    this.commits.set(signalId, commit);
    
    console.log(`[Reputation] Revealed signal ${signalId.slice(0, 8)}...`);
    return true;
  }

  /**
   * Record the outcome of a signal (was it correct?)
   */
  recordOutcome(
    signalId: string,
    priceAtSignal: number,
    priceAtEvaluation: number,
    evaluationTimestamp: number
  ): SignalOutcome | null {
    const commit = this.commits.get(signalId);
    if (!commit || !commit.revealed || !commit.signal) {
      console.error(`[Reputation] Signal ${signalId} not found or not revealed`);
      return null;
    }

    const signal = commit.signal;
    const returnPercent = ((priceAtEvaluation - priceAtSignal) / priceAtSignal) * 100;
    
    // Determine if signal was correct
    let wasCorrect = false;
    if (signal.direction === 'BUY' && returnPercent > 0) {
      wasCorrect = true;
    } else if (signal.direction === 'SELL' && returnPercent < 0) {
      wasCorrect = true;
    } else if (signal.direction === 'HOLD' && Math.abs(returnPercent) < 1) {
      wasCorrect = true; // Within 1% is considered correct for HOLD
    }

    const outcome: SignalOutcome = {
      signalId,
      priceAtSignal,
      priceAtEvaluation,
      evaluationTimestamp,
      wasCorrect,
      returnPercent,
    };

    commit.outcome = outcome;
    this.commits.set(signalId, commit);

    // Add to provider's outcomes
    const providerId = signal.providerId;
    if (!this.outcomes.has(providerId)) {
      this.outcomes.set(providerId, []);
    }
    this.outcomes.get(providerId)!.push(outcome);

    console.log(`[Reputation] Recorded outcome for ${signalId.slice(0, 8)}...: ${wasCorrect ? '✅' : '❌'} (${returnPercent.toFixed(2)}%)`);
    
    return outcome;
  }

  /**
   * Calculate reputation for a provider
   */
  calculateReputation(providerId: string): ProviderReputation {
    const outcomes = this.outcomes.get(providerId) || [];
    
    if (outcomes.length === 0) {
      return {
        totalSignals: 0,
        correctSignals: 0,
        avgReturn: 0,
        hitRate: 0,
        avgConfidence: 0,
        lastUpdated: Date.now(),
      };
    }

    const correctSignals = outcomes.filter(o => o.wasCorrect).length;
    const hitRate = (correctSignals / outcomes.length) * 100;
    const avgReturn = outcomes.reduce((sum, o) => sum + o.returnPercent, 0) / outcomes.length;

    // Get average confidence from commits
    const providerCommits = Array.from(this.commits.values())
      .filter(c => c.providerId === providerId && c.revealed && c.signal);
    const avgConfidence = providerCommits.length > 0
      ? providerCommits.reduce((sum, c) => sum + (c.signal?.confidence || 0), 0) / providerCommits.length
      : 0;

    return {
      totalSignals: outcomes.length,
      correctSignals,
      avgReturn,
      hitRate,
      avgConfidence,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get all commits for a provider
   */
  getProviderCommits(providerId: string): SignalCommit[] {
    return Array.from(this.commits.values())
      .filter(c => c.providerId === providerId);
  }

  /**
   * Get commit by signal ID
   */
  getCommit(signalId: string): SignalCommit | undefined {
    return this.commits.get(signalId);
  }

  /**
   * Export for persistence
   */
  export() {
    return {
      commits: Array.from(this.commits.entries()),
      outcomes: Array.from(this.outcomes.entries()),
    };
  }

  /**
   * Import from persistence
   */
  import(data: { commits: [string, SignalCommit][]; outcomes: [string, SignalOutcome[]][] }) {
    this.commits = new Map(data.commits);
    this.outcomes = new Map(data.outcomes);
  }
}

// Singleton instance
export const reputationTracker = new ReputationTracker();
export default reputationTracker;
