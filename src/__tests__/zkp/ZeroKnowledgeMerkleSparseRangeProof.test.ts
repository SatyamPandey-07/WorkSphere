import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleSparseRangeProof } from '../../core/zkp/ZeroKnowledgeMerkleSparseRangeProof';

describe('ZeroKnowledgeMerkleSparseRangeProof', () => {
  it('proves complete range queries and empty-range exclusions while catching omitted records', () => {
    const db = new ZeroKnowledgeMerkleSparseRangeProof('ledger-kv-2026');
    db.loadRecords([
      { key: 'acct:010', value: '100' },
      { key: 'acct:025', value: '250' },
      { key: 'acct:040', value: '400' },
      { key: 'acct:055', value: '550' },
      { key: 'acct:090', value: '900' },
    ]);

    // Interior range query [acct:020, acct:060] -> matches 025, 040, 055 with guards 010 and 090
    const qMid = db.proveCompleteRange('acct:020', 'acct:060');
    expect(qMid.matchedRecords.map((m) => m.key)).toEqual(['acct:025', 'acct:040', 'acct:055']);
    expect(qMid.leftBoundaryGuard?.key).toBe('acct:010');
    expect(qMid.rightBoundaryGuard?.key).toBe('acct:090');
    expect(db.verifyCompleteRange(qMid)).toBe(true);

    // Dishonest server omitting acct:040 breaks strict index contiguity check!
    const omitted = { ...qMid, matchedRecords: [qMid.matchedRecords[0], qMid.matchedRecords[2]] };
    expect(db.verifyCompleteRange(omitted)).toBe(false);

    // Dishonest server omitting right boundary guard (pretending acct:055 is last key) fails!
    expect(db.verifyCompleteRange({ ...qMid, rightBoundaryGuard: null })).toBe(false);

    // Empty range exclusion [acct:060, acct:085] -> 0 matches, guarded by adjacent 055 & 090
    const qEmpty = db.proveCompleteRange('acct:060', 'acct:085');
    expect(qEmpty.matchedRecords.length).toBe(0);
    expect(qEmpty.leftBoundaryGuard?.key).toBe('acct:055');
    expect(qEmpty.rightBoundaryGuard?.key).toBe('acct:090');
    expect(db.verifyCompleteRange(qEmpty)).toBe(true);

    // Boundary ranges covering below-min, above-max, and full table
    const qBelow = db.proveCompleteRange('acct:000', 'acct:005');
    expect(qBelow.matchedRecords.length).toBe(0);
    expect(qBelow.leftBoundaryGuard).toBeNull();
    expect(qBelow.rightBoundaryGuard?.index).toBe(0);
    expect(db.verifyCompleteRange(qBelow)).toBe(true);

    const qAbove = db.proveCompleteRange('acct:095', 'acct:999');
    expect(qAbove.matchedRecords.length).toBe(0);
    expect(qAbove.leftBoundaryGuard?.index).toBe(4);
    expect(qAbove.rightBoundaryGuard).toBeNull();
    expect(db.verifyCompleteRange(qAbove)).toBe(true);

    const qAll = db.proveCompleteRange('acct:000', 'acct:999');
    expect(qAll.matchedRecords.length).toBe(5);
    expect(db.verifyCompleteRange(qAll)).toBe(true);

    const json = JSON.parse(db.serializeProof(qMid)) as { matchedCount: number; hasLeftGuard: boolean };
    expect(json.matchedCount).toBe(3);
    expect(json.hasLeftGuard).toBe(true);
  });

  it('rejects duplicate keys, inverted ranges, and tampered witnesses', () => {
    const db = new ZeroKnowledgeMerkleSparseRangeProof('strict-sr');
    expect(() => db.loadRecords([])).toThrow();
    expect(() => db.loadRecords([{ key: 'a', value: '1' }, { key: 'a', value: '2' }])).toThrow();

    db.loadRecords([{ key: 'k1', value: '1' }, { key: 'k2', value: '2' }, { key: 'k3', value: '3' }]);
    expect(() => db.proveCompleteRange('k3', 'k1')).toThrow();
    const p = db.proveCompleteRange('k1', 'k2');
    expect(db.verifyCompleteRange(p)).toBe(true);
    expect(db.verifyCompleteRange({ ...p, root: '00'.repeat(32) })).toBe(false);
    expect(db.verifyCompleteRange({ ...p, rangeEnd: 'k1' })).toBe(false);
    expect(
      db.verifyCompleteRange({
        ...p,
        matchedRecords: p.matchedRecords.map((m, i) => (i === 0 ? { ...m, value: 'tampered' } : m)),
      }),
    ).toBe(false);
  });

  it('scales cleanly to 25-record sorted tables verifying single-point, multi-point, and empty-gap ranges', () => {
    const db = new ZeroKnowledgeMerkleSparseRangeProof('scale-25');
    const records = Array.from({ length: 25 }, (_, i) => ({
      key: `item:${(i * 10).toString().padStart(4, '0')}`,
      value: `payload-${i}`,
    }));
    const { root, totalSize } = db.loadRecords(records);
    expect(totalSize).toBe(25);
    expect(db.getRoot()).toBe(root);

    // Exact single-key match [item:0050, item:0050]
    const single = db.proveCompleteRange('item:0050', 'item:0050');
    expect(single.matchedRecords.length).toBe(1);
    expect(single.matchedRecords[0].key).toBe('item:0050');
    expect(single.leftBoundaryGuard?.key).toBe('item:0040');
    expect(single.rightBoundaryGuard?.key).toBe('item:0060');
    expect(db.verifyCompleteRange(single)).toBe(true);

    // Empty gap between adjacent entries [item:0051, item:0059]
    const emptyGap = db.proveCompleteRange('item:0051', 'item:0059');
    expect(emptyGap.matchedRecords.length).toBe(0);
    expect(emptyGap.leftBoundaryGuard?.key).toBe('item:0050');
    expect(emptyGap.rightBoundaryGuard?.key).toBe('item:0060');
    expect(db.verifyCompleteRange(emptyGap)).toBe(true);

    // Wide interior range [item:0030, item:0200]
    const wide = db.proveCompleteRange('item:0030', 'item:0200');
    expect(wide.matchedRecords.length).toBe(18);
    expect(db.verifyCompleteRange(wide)).toBe(true);

    // Tampering with leftBoundaryGuard key or dropping left guard fails
    expect(db.verifyCompleteRange({ ...wide, leftBoundaryGuard: null })).toBe(false);
    expect(
      db.verifyCompleteRange({
        ...wide,
        leftBoundaryGuard: { ...wide.leftBoundaryGuard!, index: 0 },
      }),
    ).toBe(false);

    // Out-of-order matchedRecords fails strict monotonicity check
    const swapped = [...wide.matchedRecords];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(db.verifyCompleteRange({ ...wide, matchedRecords: swapped })).toBe(false);

    // Cross-table verifier rejects proofs from a different tableId
    const otherDb = new ZeroKnowledgeMerkleSparseRangeProof('other-table');
    expect(otherDb.verifyCompleteRange(wide)).toBe(false);
    expect(() => otherDb.getRoot()).toThrow();
    expect(() => otherDb.proveCompleteRange('a', 'z')).toThrow();
  });

  it('handles single-record tables across exact match, below-min, and above-max queries', () => {
    const db = new ZeroKnowledgeMerkleSparseRangeProof('singleton-table');
    const { root, totalSize } = db.loadRecords([{ key: 'only:key', value: 'solo-val' }]);
    expect(totalSize).toBe(1);
    expect(root.length).toBe(64);

    const exact = db.proveCompleteRange('only:key', 'only:key');
    expect(exact.matchedRecords.length).toBe(1);
    expect(exact.leftBoundaryGuard).toBeNull();
    expect(exact.rightBoundaryGuard).toBeNull();
    expect(db.verifyCompleteRange(exact)).toBe(true);

    const before = db.proveCompleteRange('a', 'm');
    expect(before.matchedRecords.length).toBe(0);
    expect(before.leftBoundaryGuard).toBeNull();
    expect(before.rightBoundaryGuard?.key).toBe('only:key');
    expect(db.verifyCompleteRange(before)).toBe(true);

    const after = db.proveCompleteRange('p', 'z');
    expect(after.matchedRecords.length).toBe(0);
    expect(after.leftBoundaryGuard?.key).toBe('only:key');
    expect(after.rightBoundaryGuard).toBeNull();
    expect(db.verifyCompleteRange(after)).toBe(true);
  });
});
