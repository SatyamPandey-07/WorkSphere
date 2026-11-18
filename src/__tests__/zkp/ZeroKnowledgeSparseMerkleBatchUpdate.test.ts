import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeSparseMerkleBatchUpdate } from '../../core/zkp/ZeroKnowledgeSparseMerkleBatchUpdate';

describe('ZeroKnowledgeSparseMerkleBatchUpdate', () => {
  it('verifies inclusion, non-inclusion, and atomic multi-key batch state transitions', () => {
    const smt = new ZeroKnowledgeSparseMerkleBatchUpdate(20);
    const emptyRoot = smt.getRoot();
    const emptyProof = smt.prove('alice');
    expect(emptyProof.value).toBeNull();
    expect(smt.verifyProof(emptyProof)).toBe(true);

    const batch1 = smt.applyBatchUpdates([
      { key: 'alice', value: 'bal:100' },
      { key: 'bob', value: 'bal:250' },
      { key: 'charlie', value: 'bal:500' },
    ]);
    expect(batch1.initialRoot).toBe(emptyRoot);
    expect(smt.verifyBatchUpdateProof(batch1)).toBe(true);

    const aliceProof = smt.prove('alice');
    expect(aliceProof.value).toBe('bal:100');
    expect(smt.verifyProof(aliceProof)).toBe(true);
    expect(smt.verifyProof({ ...aliceProof, value: 'bal:999' })).toBe(false);

    const daveProof = smt.prove('dave');
    expect(daveProof.value).toBeNull();
    expect(smt.verifyProof(daveProof)).toBe(true);

    const batch2 = smt.applyBatchUpdates([
      { key: 'alice', value: 'bal:175' },
      { key: 'bob', value: null },
      { key: 'dave', value: 'bal:80' },
    ]);
    expect(batch2.initialRoot).toBe(batch1.finalRoot);
    expect(smt.verifyBatchUpdateProof(batch2)).toBe(true);
    expect(smt.verifyProof(smt.prove('bob'))).toBe(true);
    expect(smt.prove('bob').value).toBeNull();

    const json = JSON.parse(smt.serializeBatchProof(batch2)) as { stepCount: number; depth: number };
    expect(json.stepCount).toBe(3);
    expect(json.depth).toBe(20);
  });

  it('restores exact empty root when all inserted keys are deleted', () => {
    const smt = new ZeroKnowledgeSparseMerkleBatchUpdate(16);
    const genesisRoot = smt.getRoot();

    const ins = smt.applyBatchUpdates([
      { key: 'k1', value: 'v1' },
      { key: 'k2', value: 'v2' },
      { key: 'k3', value: 'v3' },
    ]);
    expect(ins.finalRoot).not.toBe(genesisRoot);
    expect(smt.verifyBatchUpdateProof(ins)).toBe(true);

    const delAll = smt.applyBatchUpdates([
      { key: 'k2', value: null },
      { key: 'k1', value: null },
      { key: 'k3', value: null },
    ]);
    expect(smt.verifyBatchUpdateProof(delAll)).toBe(true);
    expect(delAll.finalRoot).toBe(genesisRoot);
    expect(smt.get('k1')).toBeNull();
    expect(smt.get('k2')).toBeNull();
    expect(smt.get('k3')).toBeNull();
  });

  it('produces order-independent final state root for disjoint keys across separate SMT instances', () => {
    const smtA = new ZeroKnowledgeSparseMerkleBatchUpdate(18);
    const smtB = new ZeroKnowledgeSparseMerkleBatchUpdate(18);

    const pA = smtA.applyBatchUpdates([
      { key: 'acct-1', value: '10' },
      { key: 'acct-2', value: '20' },
      { key: 'acct-3', value: '30' },
      { key: 'acct-4', value: '40' },
    ]);
    const pB = smtB.applyBatchUpdates([
      { key: 'acct-4', value: '40' },
      { key: 'acct-2', value: '20' },
      { key: 'acct-1', value: '10' },
      { key: 'acct-3', value: '30' },
    ]);

    expect(pA.finalRoot).toBe(pB.finalRoot);
    expect(smtA.verifyBatchUpdateProof(pB)).toBe(true);
    expect(smtB.verifyBatchUpdateProof(pA)).toBe(true);
  });

  it('rejects out-of-range depths, empty batches, broken step chains, and tampered siblings', () => {
    expect(() => new ZeroKnowledgeSparseMerkleBatchUpdate(3)).toThrow();
    expect(() => new ZeroKnowledgeSparseMerkleBatchUpdate(65)).toThrow();

    const smt = new ZeroKnowledgeSparseMerkleBatchUpdate(12);
    expect(() => smt.applyBatchUpdates([])).toThrow();
    expect(() => smt.computeRootFromSiblings('x', 'v', ['short'])).toThrow();

    const batch = smt.applyBatchUpdates([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    expect(smt.verifyBatchUpdateProof(batch)).toBe(true);

    expect(smt.verifyBatchUpdateProof({ ...batch, finalRoot: batch.initialRoot })).toBe(false);
    expect(smt.verifyBatchUpdateProof({ ...batch, depth: 16 })).toBe(false);
    expect(smt.verifyBatchUpdateProof({ ...batch, batchDigest: '00'.repeat(32) })).toBe(false);
    expect(smt.verifyBatchUpdateProof({ ...batch, steps: [] })).toBe(false);

    // Tamper proof siblings and keyHashBits
    const p = smt.prove('a');
    expect(smt.verifyProof({ ...p, depth: 10 })).toBe(false);
    expect(smt.verifyProof({ ...p, siblings: p.siblings.slice(1) })).toBe(false);
    expect(smt.verifyProof({ ...p, keyHashBits: '0'.repeat(12) })).toBe(false);
    const badSibs = [...p.siblings];
    badSibs[0] = 'ff'.repeat(32);
    expect(smt.verifyProof({ ...p, siblings: badSibs })).toBe(false);

    // Same-key update multiple times in one batch
    const multiUpdate = smt.applyBatchUpdates([
      { key: 'a', value: '10' },
      { key: 'a', value: '20' },
      { key: 'a', value: '30' },
    ]);
    expect(smt.verifyBatchUpdateProof(multiUpdate)).toBe(true);
    expect(smt.get('a')).toBe('30');
    expect(smt.verifyProof(smt.prove('a'))).toBe(true);
  });
});
