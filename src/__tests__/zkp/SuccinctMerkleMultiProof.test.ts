import { describe, it, expect } from 'vitest';
import { SuccinctMerkleMultiProof } from '../../core/zkp/SuccinctMerkleMultiProof';

describe('SuccinctMerkleMultiProof', () => {
  const leaves = Array.from({ length: 16 }, (_, i) => `tx_record_${i}`);
  const tree = new SuccinctMerkleMultiProof(leaves);
  const root = tree.getRoot();

  it('builds a depth-4 tree for 16 leaves', () => {
    expect(tree.getDepth()).toBe(4);
    expect(tree.getLeafCount()).toBe(16);
    expect(root).toHaveLength(64);
  });

  it('generates and verifies succinct multi-proof for arbitrary disjoint subset', () => {
    const indices = [1, 4, 5, 11, 14];
    const proof = tree.generateMultiProof(indices);
    const subsetLeaves = indices.map((idx) => ({ index: idx, value: leaves[idx] }));

    const res = SuccinctMerkleMultiProof.verifyMultiProof(root, subsetLeaves, proof);
    expect(res.isValid).toBe(true);
    expect(res.computedRoot).toBe(root);
    expect(res.verifiedLeafCount).toBe(5);

    // Naive individual proofs would need 5 * 4 = 20 hashes; multi-proof uses far fewer!
    const stats = tree.computeCompressionStats(indices);
    expect(stats.naiveHashCount).toBe(20);
    expect(stats.multiProofHashCount).toBeLessThan(stats.naiveHashCount);
    expect(stats.hashesSaved).toBeGreaterThan(0);
  });

  it('verifies full-tree multi-proof with zero auxiliary proof hashes', () => {
    const allIndices = Array.from({ length: 16 }, (_, i) => i);
    const proof = tree.generateMultiProof(allIndices);
    expect(proof.proofHashes.length).toBe(0);

    const allLeaves = allIndices.map((idx) => ({ index: idx, value: leaves[idx] }));
    const res = SuccinctMerkleMultiProof.verifyMultiProof(root, allLeaves, proof);
    expect(res.isValid).toBe(true);
    expect(res.verifiedLeafCount).toBe(16);
  });

  it('rejects tampered leaf values or modified proof hashes', () => {
    const indices = [2, 3, 9];
    const proof = tree.generateMultiProof(indices);
    const tamperedLeaves = [
      { index: 2, value: leaves[2] },
      { index: 3, value: 'FORGED_TX_DATA' },
      { index: 9, value: leaves[9] },
    ];

    const res = SuccinctMerkleMultiProof.verifyMultiProof(root, tamperedLeaves, proof);
    expect(res.isValid).toBe(false);
  });
});
