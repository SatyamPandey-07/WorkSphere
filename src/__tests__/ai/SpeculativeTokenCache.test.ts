/**
 * @file SpeculativeTokenCache.test.ts
 * @description Comprehensive unit test suite for SpeculativeTokenCache streaming speculative
 * LLM decoding engine, prefix trie lookup, rejection sampling, and entropy gating.
 */

import {
  SpeculativeTokenCache,
  type TokenLogprob,
  type VerificationResult
} from '../../core/ai/SpeculativeTokenCache';

describe('SpeculativeTokenCache & Streaming LLM Speculative Engine', () => {
  let cache: SpeculativeTokenCache;

  beforeEach(() => {
    cache = new SpeculativeTokenCache({
      maxDraftLength: 5,
      minDraftLength: 1,
      entropyThreshold: 2.0,
      targetDraftRatio: 0.1,
      trieCapacity: 50
    });
  });

  describe('Prefix Trie & Sequence Recording', () => {
    it('records token sequences and successfully proposes speculative continuation drafts', () => {
      const sequence: TokenLogprob[] = [
        { tokenId: 101, tokenText: 'The', prob: 0.95 },
        { tokenId: 102, tokenText: ' quarterly', prob: 0.90 },
        { tokenId: 103, tokenText: ' financial', prob: 0.85 },
        { tokenId: 104, tokenText: ' earnings', prob: 0.80 },
        { tokenId: 105, tokenText: ' report', prob: 0.92 }
      ];

      cache.recordSequence(sequence);
      expect(cache.getNodeCount()).toBeGreaterThan(0);

      // Query with prefix [101, 102] ('The quarterly')
      const draft = cache.proposeDraft([101, 102]);
      expect(draft).not.toBeNull();
      expect(draft?.source).toBe('trie_cache');
      expect(draft?.draftTokens.length).toBeGreaterThan(0);
      expect(draft?.draftTokens[0].tokenId).toBe(103); // 'financial'
      expect(draft?.draftTokens[1].tokenId).toBe(104); // 'earnings'
    });

    it('returns null and increments miss metric when prefix does not exist', () => {
      const draft = cache.proposeDraft([999, 888]);
      expect(draft).toBeNull();
      const metrics = cache.getMetrics();
      expect(metrics.cacheMissCount).toBe(1);
    });
  });

  describe('Shannon Entropy Gating', () => {
    it('calculates zero entropy for deterministic distributions and high entropy for uniform spread', () => {
      const deterministicProbs = [1.0, 0.0, 0.0];
      expect(cache.calculateEntropy(deterministicProbs)).toBeCloseTo(0.0, 5);

      const uniformProbs = [0.25, 0.25, 0.25, 0.25];
      // H = -4 * (0.25 * log2(0.25)) = -4 * (0.25 * -2) = 2.0 bits
      expect(cache.calculateEntropy(uniformProbs)).toBeCloseTo(2.0, 5);
    });

    it('gates speculative drafts when target distribution entropy exceeds threshold', () => {
      const sequence: TokenLogprob[] = [
        { tokenId: 1, tokenText: 'A', prob: 0.9 },
        { tokenId: 2, tokenText: 'B', prob: 0.9 }
      ];
      cache.recordSequence(sequence);

      // Propose draft with high entropy (3.5 bits > threshold 2.0)
      const draftGated = cache.proposeDraft([1], 3.5);
      expect(draftGated).toBeNull();
      expect(cache.getMetrics().entropyGatedSkips).toBe(1);

      // Propose draft with low entropy (0.5 bits <= threshold 2.0)
      const draftAccepted = cache.proposeDraft([1], 0.5);
      expect(draftAccepted).not.toBeNull();
      expect(draftAccepted?.draftTokens[0].tokenId).toBe(2);
    });
  });

  describe('Speculative Verification Engine', () => {
    it('accepts all draft tokens when target distribution supports draft probabilities', () => {
      const draftTokens: TokenLogprob[] = [
        { tokenId: 10, tokenText: 'meeting', prob: 0.7 },
        { tokenId: 11, tokenText: 'agenda', prob: 0.8 }
      ];

      // Target distribution with equal or higher probabilities
      const targetDistributions = [
        new Map<number, number>([[10, 0.85]]),
        new Map<number, number>([[11, 0.90]])
      ];

      const fallbackTokens: TokenLogprob[] = [
        { tokenId: 99, tokenText: '<FB1>', prob: 0.1 },
        { tokenId: 98, tokenText: '<FB2>', prob: 0.1 }
      ];

      const result = cache.verifyDraft(draftTokens, targetDistributions, fallbackTokens);

      expect(result.totalAccepted).toBe(2);
      expect(result.rejectedAt).toBeNull();
      expect(result.recoveryToken).toBeNull();
      expect(result.acceptanceRate).toBe(1.0);
    });

    it('rejects at early position and samples fallback recovery token', () => {
      const draftTokens: TokenLogprob[] = [
        { tokenId: 20, tokenText: 'alpha', prob: 0.8 },
        { tokenId: 21, tokenText: 'beta', prob: 0.8 }
      ];

      // Target assigns near-zero probability to draft token 20
      const targetDistributions = [
        new Map<number, number>([[20, 0.00001]]),
        new Map<number, number>([[21, 0.99]])
      ];

      const fallbackTokens: TokenLogprob[] = [
        { tokenId: 999, tokenText: 'gamma', prob: 0.95 }
      ];

      const result = cache.verifyDraft(draftTokens, targetDistributions, fallbackTokens);

      expect(result.totalAccepted).toBe(0);
      expect(result.rejectedAt).toBe(0);
      expect(result.recoveryToken?.tokenId).toBe(999);
      expect(result.recoveryToken?.tokenText).toBe('gamma');
    });
  });

  describe('Dynamic Draft Length Adaptation & Metrics', () => {
    it('adapts draft length dynamically and tracks effective speedup', () => {
      const initialLength = cache.getCurrentDraftLength();
      expect(initialLength).toBeGreaterThanOrEqual(1);

      // Simulate series of perfect verifications (acceptanceRate = 1.0)
      for (let i = 0; i < 5; i++) {
        const drafts: TokenLogprob[] = [{ tokenId: 1, tokenText: 'tok', prob: 0.8 }];
        const targets = [new Map<number, number>([[1, 0.9]])];
        cache.verifyDraft(drafts, targets, []);
      }

      const metrics = cache.getMetrics();
      expect(metrics.totalDraftTokensAccepted).toBe(5);
      expect(metrics.effectiveSpeedupFactor).toBeGreaterThan(1.0);
      expect(cache.getCurrentDraftLength()).toBeLessThanOrEqual(cache.maxDraftLength);
    });

    it('prunes least frequently used nodes when trie exceeds capacity', () => {
      const smallCache = new SpeculativeTokenCache({ trieCapacity: 5 });

      // Insert many distinct sequences
      for (let id = 1; id <= 15; id++) {
        smallCache.recordSequence([
          { tokenId: id, tokenText: `t_${id}`, prob: 0.5 }
        ]);
      }

      expect(smallCache.getNodeCount()).toBeLessThanOrEqual(10);
    });
  });
});
