import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleIndexOrderProver } from '../../core/zkp/ZeroKnowledgeMerkleIndexOrderProver';

describe('ZeroKnowledgeMerkleIndexOrderProver', () => {
  it('proves membership and all three non-membership cases (below min, interior gap, above max)', () => {
    const idx = new ZeroKnowledgeMerkleIndexOrderProver('dnssec-nsec-2026');
    const info = idx.buildIndex([
      { key: 'delta', value: '4' },
      { key: 'bravo', value: '2' },
      { key: 'hotel', value: '8' },
      { key: 'foxtrot', value: '6' },
      { key: 'juliet', value: '10' },
    ]);
    expect(info.size).toBe(5);
    expect(idx.getSize()).toBe(5);

    // Membership verification
    const memFox = idx.proveMembership('foxtrot');
    expect(memFox.index).toBe(2);
    expect(idx.verifyLeafProof(memFox)).toBe(true);
    expect(idx.verifyLeafProof({ ...memFox, value: '999' })).toBe(false);
    expect(idx.verifyLeafProof({ ...memFox, index: 3 })).toBe(false);

    // Non-membership Case 1: BELOW_MIN ('alpha' < 'bravo')
    const nmMin = idx.proveNonMembership('alpha');
    expect(nmMin.caseType).toBe('BELOW_MIN');
    expect(idx.verifyNonMembership(nmMin)).toBe(true);
    expect(idx.verifyNonMembership({ ...nmMin, queryKey: 'charlie' })).toBe(false);

    // Non-membership Case 2: INTERIOR_GAP ('delta' < 'echo' < 'foxtrot')
    const nmMid = idx.proveNonMembership('echo');
    expect(nmMid.caseType).toBe('INTERIOR_GAP');
    expect(nmMid.lowerNeighbor?.key).toBe('delta');
    expect(nmMid.upperNeighbor?.key).toBe('foxtrot');
    expect(idx.verifyNonMembership(nmMid)).toBe(true);

    // Non-adjacent pair cheating attempt (bravo & foxtrot skip delta!) MUST FAIL
    const nonAdjacentCheat = {
      ...nmMid,
      lowerNeighbor: idx.proveMembership('bravo'),
      upperNeighbor: idx.proveMembership('foxtrot'),
    };
    expect(idx.verifyNonMembership(nonAdjacentCheat)).toBe(false);

    // Non-membership Case 3: ABOVE_MAX ('juliet' < 'zulu')
    const nmMax = idx.proveNonMembership('zulu');
    expect(nmMax.caseType).toBe('ABOVE_MAX');
    expect(idx.verifyNonMembership(nmMax)).toBe(true);
    expect(idx.verifyNonMembership({ ...nmMax, queryKey: 'bravo' })).toBe(false);

    // Range ordering audit
    const ordered = idx.verifyRangeOrdering(0, 4);
    expect(ordered.ordered).toBe(true);
    expect(ordered.proofs.map((p) => p.key)).toEqual(['bravo', 'delta', 'foxtrot', 'hotel', 'juliet']);

    const json = JSON.parse(idx.serializeNonMembership(nmMid)) as { caseType: string; lowerKey: string; upperKey: string };
    expect(json.caseType).toBe('INTERIOR_GAP');
    expect(json.lowerKey).toBe('delta');
    expect(json.upperKey).toBe('foxtrot');
  });

  it('rejects duplicate keys, empty builds, present keys for non-membership, and cross-namespace proofs', () => {
    const idx = new ZeroKnowledgeMerkleIndexOrderProver('ns-A');
    const idxOther = new ZeroKnowledgeMerkleIndexOrderProver('ns-B');
    expect(() => idx.buildIndex([])).toThrow();
    expect(() => idx.getRoot()).toThrow();
    expect(() => idx.buildIndex([{ key: 'k', value: '1' }, { key: 'k', value: '2' }])).toThrow();

    idx.buildIndex([{ key: 'only', value: 'val' }]);
    expect(() => idx.proveMembership('absent')).toThrow();
    expect(() => idx.proveNonMembership('only')).toThrow();
    expect(() => idx.verifyRangeOrdering(-1, 0)).toThrow();

    const pSolo = idx.proveMembership('only');
    expect(idx.verifyLeafProof(pSolo)).toBe(true);
    expect(idxOther.verifyLeafProof(pSolo)).toBe(false);
    expect(idx.verifyNonMembership(idx.proveNonMembership('aaa'))).toBe(true);
    expect(idx.verifyNonMembership(idx.proveNonMembership('zzz'))).toBe(true);
  });

  it('scales cleanly to 32 sorted keys and verifies every single interior gap non-membership proof', () => {
    const big = new ZeroKnowledgeMerkleIndexOrderProver('scale-32');
    const entries = Array.from({ length: 32 }, (_, i) => ({
      key: `key-${(i * 2).toString().padStart(3, '0')}`,
      value: `val-${i}`,
    }));
    const { size } = big.buildIndex(entries);
    expect(size).toBe(32);

    // Every odd key key-001, key-003, ..., key-061 lies strictly inside an interior gap!
    for (let i = 0; i < 31; i++) {
      const gapKey = `key-${(i * 2 + 1).toString().padStart(3, '0')}`;
      const nm = big.proveNonMembership(gapKey);
      expect(nm.caseType).toBe('INTERIOR_GAP');
      expect(nm.lowerNeighbor?.index).toBe(i);
      expect(nm.upperNeighbor?.index).toBe(i + 1);
      expect(big.verifyNonMembership(nm)).toBe(true);
    }

    // Tampered neighbor root fails verification
    const sample = big.proveNonMembership('key-015');
    expect(big.verifyNonMembership({ ...sample, root: '00'.repeat(32) })).toBe(false);
    expect(big.verifyNonMembership({ ...sample, lowerNeighbor: undefined })).toBe(false);
    expect(big.verifyNonMembership({ ...sample, upperNeighbor: undefined })).toBe(false);
  });
});
