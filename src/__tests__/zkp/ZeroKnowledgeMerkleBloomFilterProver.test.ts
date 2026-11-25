import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeMerkleBloomFilterProver } from '../../core/zkp/ZeroKnowledgeMerkleBloomFilterProver';

describe('ZeroKnowledgeMerkleBloomFilterProver', () => {
  it('commits a Bloom filter into a Merkle tree and verifies both positive and definite negative queries', () => {
    const bf = new ZeroKnowledgeMerkleBloomFilterProver({
      filterId: 'revoked-tokens-2026',
      numBits: 1024,
      numHashes: 5,
      chunkBits: 64,
    });

    const root = bf.insertBatch(['tok-101', 'tok-202', 'tok-303', 'tok-404']);
    expect(bf.mightContain('tok-202')).toBe(true);
    expect(bf.estimateFalsePositiveRate()).toBeLessThan(0.01);

    const posProof = bf.generateQueryProof('tok-202');
    expect(posProof.possiblyPresent).toBe(true);
    expect(bf.verifyQueryProof(posProof, root).valid).toBe(true);

    const negProof = bf.generateQueryProof('tok-definitely-not-revoked-9999');
    expect(negProof.possiblyPresent).toBe(false);
    expect(bf.verifyQueryProof(negProof, root).valid).toBe(true);

    // Forging possiblyPresent flag must fail verification
    expect(bf.verifyQueryProof({ ...negProof, possiblyPresent: true }, root).valid).toBe(false);

    const batch = bf.batchVerifyQueries([posProof, negProof], root);
    expect(batch.allValid).toBe(true);
    expect(batch.presentKeys).toEqual(['tok-202']);
    expect(batch.definitelyAbsentKeys).toEqual(['tok-definitely-not-revoked-9999']);

    const json = bf.serializeProof(posProof);
    const restored = bf.deserializeProof(json);
    expect(restored).toEqual(posProof);
    expect(bf.verifyQueryProof(restored, root).valid).toBe(true);
  });
});
