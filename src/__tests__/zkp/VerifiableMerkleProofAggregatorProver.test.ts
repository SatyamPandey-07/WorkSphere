import { describe, it, expect } from 'vitest';
import { VerifiableMerkleProofAggregatorProver } from '../../core/zkp/VerifiableMerkleProofAggregatorProver';

describe('VerifiableMerkleProofAggregatorProver', () => {
  it('generates deduplicated compressed Merkle multi-proofs with strict savings over naive paths', () => {
    const agg = new VerifiableMerkleProofAggregatorProver('ws-state-tree');
    const leaves = Array.from({ length: 16 }, (_, i) => `record-${i}`);
    const { rootHash } = agg.buildTree(leaves);

    // Querying 6 leaves out of 16 compresses heavily vs 6 * 4 = 24 naive sibling hashes!
    const multiProof = agg.generateMultiProof([0, 1, 2, 5, 10, 11]);
    expect(multiProof.compressedHashCount).toBeLessThan(multiProof.naiveHashCount);
    expect(agg.verifyMultiProof(multiProof, rootHash).valid).toBe(true);

    // Tampered leaf payload must fail verification
    const badProof = {
      ...multiProof,
      queriedLeaves: [
        { ...multiProof.queriedLeaves[0], payload: 'record-0-tampered' },
        ...multiProof.queriedLeaves.slice(1),
      ],
    };
    expect(agg.verifyMultiProof(badProof, rootHash).valid).toBe(false);

    const json = agg.serializeMultiProof(multiProof);
    const restored = agg.deserializeMultiProof(json);
    expect(restored).toEqual(multiProof);
    expect(agg.verifyMultiProof(restored, rootHash).valid).toBe(true);
  });
});
