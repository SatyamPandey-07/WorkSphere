import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerklePrefixRangeProof } from '../../core/zkp/ZeroKnowledgeMerklePrefixRangeProof';

describe('ZeroKnowledgeMerklePrefixRangeProof', () => {
  it('proves exact key inclusion and adjacent-leaf gap non-membership for all 3 boundary cases', () => {
    const idx = new ZeroKnowledgeMerklePrefixRangeProof();
    const summary = idx.buildIndex([
      { key: 'delta', value: '4' },
      { key: 'bravo', value: '2' },
      { key: 'foxtrot', value: '6' },
      { key: 'hotel', value: '8' },
      { key: 'juliet', value: '10' },
    ]);

    const inc = idx.proveInclusion('foxtrot');
    expect(idx.verifyInclusion(inc, summary.rootHash).valid).toBe(true);
    expect(idx.verifyInclusion({ ...inc, value: 'tampered' }, summary.rootHash).valid).toBe(false);

    // Case 1: before_first ('alpha' < 'bravo')
    const before = idx.proveNonMembership('alpha');
    expect(before.caseType).toBe('before_first');
    expect(idx.verifyNonMembership(before, summary.rootHash).valid).toBe(true);

    // Case 2: between_adjacent ('bravo' < 'charlie' < 'delta')
    const between = idx.proveNonMembership('charlie');
    expect(between.caseType).toBe('between_adjacent');
    expect(idx.verifyNonMembership(between, summary.rootHash).valid).toBe(true);

    // Case 3: after_last ('juliet' < 'zulu')
    const after = idx.proveNonMembership('zulu');
    expect(after.caseType).toBe('after_last');
    expect(idx.verifyNonMembership(after, summary.rootHash).valid).toBe(true);

    // Forging a non-membership proof for an existing key must fail
    expect(idx.verifyNonMembership({ ...between, targetKey: 'delta' }, summary.rootHash).valid).toBe(false);
  });

  it('proves complete lexicographic range slices and round-trips JSON serialization', () => {
    const idx = new ZeroKnowledgeMerklePrefixRangeProof();
    const { rootHash } = idx.buildIndex([
      { key: 'k01', value: 'a' },
      { key: 'k02', value: 'b' },
      { key: 'k03', value: 'c' },
      { key: 'k04', value: 'd' },
      { key: 'k05', value: 'e' },
    ]);

    const slice = idx.proveRangeSlice('k02', 'k04');
    expect(slice.entries.map((e) => e.key)).toEqual(['k02', 'k03', 'k04']);
    expect(idx.verifyRangeSlice(slice, rootHash).valid).toBe(true);

    const gap = idx.proveNonMembership('k025');
    const json = idx.serializeNonMembershipProof(gap);
    const restored = idx.deserializeNonMembershipProof(json);
    expect(restored).toEqual(gap);
    expect(idx.verifyNonMembership(restored, rootHash).valid).toBe(true);
  });
});
