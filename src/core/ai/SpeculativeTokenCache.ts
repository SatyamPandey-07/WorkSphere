/**
 * @file SpeculativeTokenCache.ts
 * @description Streaming speculative LLM token decoding cache and draft-verification engine
 * for real-time AI copilots, meeting summarizers, and latency-critical workspace assistants.
 * Implements prefix trie speculative n-grams, stochastic draft acceptance verification,
 * Shannon entropy confidence gating, and dynamic draft-length adaptation.
 */

export interface TokenLogprob {
  tokenId: number;
  tokenText: string;
  prob: number; // Probability in [0, 1]
}

export interface SpeculativeTrieNode {
  tokenId: number;
  tokenText: string;
  frequency: number;
  probability: number;
  lastAccessed: number;
  children: Map<number, SpeculativeTrieNode>;
}

export interface DraftProposal {
  prefixTokens: number[];
  draftTokens: TokenLogprob[];
  source: 'trie_cache' | 'draft_model';
  estimatedAcceptanceRate: number;
}

export interface VerificationResult {
  acceptedTokens: TokenLogprob[];
  rejectedAt: number | null; // Index in draftTokens where rejection occurred, or null if all accepted
  recoveryToken: TokenLogprob | null;
  totalAccepted: number;
  acceptanceRate: number;
  targetEvaluations: number;
}

export interface SpeculativeEngineConfig {
  maxDraftLength?: number;       // Maximum speculative draft tokens (default: 5)
  minDraftLength?: number;       // Minimum draft tokens (default: 1)
  entropyThreshold?: number;     // Shannon entropy threshold in bits to gate speculative draft (default: 2.5)
  targetDraftRatio?: number;     // Relative cost of draft model vs target model (default: 0.1)
  trieCapacity?: number;         // Maximum nodes in prefix trie (default: 10000)
  alphaDecayRate?: number;       // Moving average decay rate for acceptance rate (default: 0.1)
}

export interface SpeculativeMetrics {
  totalDraftTokensProposed: number;
  totalDraftTokensAccepted: number;
  totalTargetSteps: number;
  overallAcceptanceRate: number;
  effectiveSpeedupFactor: number;
  entropyGatedSkips: number;
  cacheHitCount: number;
  cacheMissCount: number;
}

/**
 * SpeculativeTokenCache
 * Streaming speculative decoding cache and verification engine.
 */
export class SpeculativeTokenCache {
  public readonly maxDraftLength: number;
  public readonly minDraftLength: number;
  public readonly entropyThreshold: number;
  public readonly targetDraftRatio: number;
  public readonly trieCapacity: number;
  public readonly alphaDecayRate: number;

  private root: SpeculativeTrieNode;
  private nodeCount: number = 0;
  private currentDraftLength: number;
  private movingAcceptanceRate: number = 0.75;

  // Telemetry metrics
  private metrics: SpeculativeMetrics = {
    totalDraftTokensProposed: 0,
    totalDraftTokensAccepted: 0,
    totalTargetSteps: 0,
    overallAcceptanceRate: 0.75,
    effectiveSpeedupFactor: 1.0,
    entropyGatedSkips: 0,
    cacheHitCount: 0,
    cacheMissCount: 0
  };

  constructor(config: SpeculativeEngineConfig = {}) {
    this.maxDraftLength = config.maxDraftLength ?? 5;
    this.minDraftLength = config.minDraftLength ?? 1;
    this.entropyThreshold = config.entropyThreshold ?? 2.5;
    this.targetDraftRatio = config.targetDraftRatio ?? 0.1;
    this.trieCapacity = config.trieCapacity ?? 10000;
    this.alphaDecayRate = config.alphaDecayRate ?? 0.1;

    this.currentDraftLength = Math.min(3, this.maxDraftLength);

    this.root = {
      tokenId: -1,
      tokenText: '<ROOT>',
      frequency: 0,
      probability: 1.0,
      lastAccessed: Date.now(),
      children: new Map()
    };
  }

  // ==========================================
  // Trie Management & Speculative Lookups
  // ==========================================

  /**
   * Insert an observed sequence of tokens into the speculative prefix trie.
   */
  public recordSequence(tokens: TokenLogprob[]): void {
    if (tokens.length === 0) return;

    for (let i = 0; i < tokens.length; i++) {
      let current = this.root;
      const windowEnd = Math.min(tokens.length, i + this.maxDraftLength + 1);

      for (let j = i; j < windowEnd; j++) {
        const token = tokens[j];
        let child = current.children.get(token.tokenId);

        if (!child) {
          if (this.nodeCount >= this.trieCapacity) {
            this.pruneLruNodes();
          }

          child = {
            tokenId: token.tokenId,
            tokenText: token.tokenText,
            frequency: 0,
            probability: token.prob,
            lastAccessed: Date.now(),
            children: new Map()
          };
          current.children.set(token.tokenId, child);
          this.nodeCount++;
        }

        child.frequency++;
        child.lastAccessed = Date.now();
        // Update exponential moving average of transition probability
        child.probability = 0.9 * child.probability + 0.1 * token.prob;
        current = child;
      }
    }
  }

  /**
   * Look up a speculative continuation draft for a given prefix.
   */
  public proposeDraft(prefixTokens: number[], targetEntropy?: number): DraftProposal | null {
    // Check entropy gate: high entropy indicates high model uncertainty
    if (targetEntropy !== undefined && targetEntropy > this.entropyThreshold) {
      this.metrics.entropyGatedSkips++;
      return null;
    }

    // Traverse prefix to find root of continuation
    let current = this.root;
    for (const tokenId of prefixTokens) {
      const next = current.children.get(tokenId);
      if (!next) {
        this.metrics.cacheMissCount++;
        return null;
      }
      current = next;
    }

    this.metrics.cacheHitCount++;

    // Greedily find most probable branch up to current dynamic draft length
    const draftTokens: TokenLogprob[] = [];
    const searchDepth = this.currentDraftLength;

    for (let step = 0; step < searchDepth; step++) {
      if (current.children.size === 0) break;

      let bestChild: SpeculativeTrieNode | null = null;
      let highestProb = -1;

      for (const child of current.children.values()) {
        const score = child.frequency * child.probability;
        if (score > highestProb) {
          highestProb = score;
          bestChild = child;
        }
      }

      if (!bestChild) break;

      draftTokens.push({
        tokenId: bestChild.tokenId,
        tokenText: bestChild.tokenText,
        prob: Math.max(0.01, Math.min(1.0, bestChild.probability))
      });
      current = bestChild;
    }

    if (draftTokens.length === 0) return null;

    return {
      prefixTokens,
      draftTokens,
      source: 'trie_cache',
      estimatedAcceptanceRate: this.movingAcceptanceRate
    };
  }

  // ==========================================
  // Verification Engine & Rejection Sampling
  // ==========================================

  /**
   * Calculate Shannon entropy of a probability distribution in bits.
   * H(P) = -sum(p * log2(p))
   */
  public calculateEntropy(probs: number[]): number {
    let entropy = 0;
    for (const p of probs) {
      if (p > 1e-9) {
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }

  /**
   * Verify speculative draft tokens against target model distribution logits.
   * Follows standard Leviathan et al. speculative sampling algorithm.
   */
  public verifyDraft(
    draftTokens: TokenLogprob[],
    targetDistributions: Map<number, number>[], // Array of token probability maps per draft position
    fallbackTokens: TokenLogprob[]              // Candidate recovery tokens per position
  ): VerificationResult {
    const accepted: TokenLogprob[] = [];
    let rejectedAt: number | null = null;
    let recoveryToken: TokenLogprob | null = null;

    const evalSteps = Math.min(draftTokens.length, targetDistributions.length);

    for (let i = 0; i < evalSteps; i++) {
      const draft = draftTokens[i];
      const targetMap = targetDistributions[i];
      const pTarget = targetMap.get(draft.tokenId) ?? 0.0001;
      const pDraft = Math.max(1e-5, draft.prob);

      // Acceptance criterion
      let isAccepted = false;
      if (pTarget >= pDraft) {
        isAccepted = true;
      } else {
        const acceptProb = pTarget / pDraft;
        const roll = Math.random();
        isAccepted = roll < acceptProb;
      }

      if (isAccepted) {
        accepted.push({
          tokenId: draft.tokenId,
          tokenText: draft.tokenText,
          prob: pTarget
        });
      } else {
        // First rejection: stop speculative verification
        rejectedAt = i;
        recoveryToken = fallbackTokens[i] ?? {
          tokenId: 0,
          tokenText: '<RECOVERY>',
          prob: 0.5
        };
        break;
      }
    }

    const totalAccepted = accepted.length;
    const batchAcceptanceRate = draftTokens.length > 0 ? totalAccepted / draftTokens.length : 0;

    // Update telemetry
    this.updateMetrics(draftTokens.length, totalAccepted);
    this.adaptDraftLength(batchAcceptanceRate);

    return {
      acceptedTokens: accepted,
      rejectedAt,
      recoveryToken,
      totalAccepted,
      acceptanceRate: batchAcceptanceRate,
      targetEvaluations: totalAccepted + 1
    };
  }

  // ==========================================
  // Dynamic Adaptation & Metrics
  // ==========================================

  /**
   * Dynamically adjust speculative draft length based on empirical acceptance rate.
   */
  private adaptDraftLength(recentRate: number): void {
    // Update EMA
    this.movingAcceptanceRate =
      (1 - this.alphaDecayRate) * this.movingAcceptanceRate + this.alphaDecayRate * recentRate;

    if (this.movingAcceptanceRate > 0.8 && this.currentDraftLength < this.maxDraftLength) {
      this.currentDraftLength++;
    } else if (this.movingAcceptanceRate < 0.5 && this.currentDraftLength > this.minDraftLength) {
      this.currentDraftLength--;
    }
  }

  private updateMetrics(proposed: number, accepted: number): void {
    this.metrics.totalDraftTokensProposed += proposed;
    this.metrics.totalDraftTokensAccepted += accepted;
    this.metrics.totalTargetSteps++;

    if (this.metrics.totalDraftTokensProposed > 0) {
      this.metrics.overallAcceptanceRate =
        this.metrics.totalDraftTokensAccepted / this.metrics.totalDraftTokensProposed;
    }

    // Effective speedup: S = (accepted + 1) / (1 + (proposed * targetDraftRatio))
    const alpha = this.metrics.overallAcceptanceRate;
    const gamma = this.currentDraftLength;
    const r = this.targetDraftRatio;
    const speedup = (alpha * gamma + 1) / (1 + gamma * r);
    this.metrics.effectiveSpeedupFactor = Math.max(1.0, speedup);
  }

  public getMetrics(): SpeculativeMetrics {
    return { ...this.metrics };
  }

  public getCurrentDraftLength(): number {
    return this.currentDraftLength;
  }

  public getNodeCount(): number {
    return this.nodeCount;
  }

  /**
   * Prune least-recently-used leaf nodes when capacity is exceeded
   */
  private pruneLruNodes(): void {
    // Simple subtree prune on root children with lowest frequency
    let minKey: number | null = null;
    let minFreq = Infinity;

    for (const [key, node] of this.root.children.entries()) {
      if (node.frequency < minFreq) {
        minFreq = node.frequency;
        minKey = key;
      }
    }

    if (minKey !== null) {
      const removed = this.root.children.get(minKey);
      if (removed) {
        this.nodeCount -= 1 + removed.children.size;
        this.root.children.delete(minKey);
      }
    }
  }
}
