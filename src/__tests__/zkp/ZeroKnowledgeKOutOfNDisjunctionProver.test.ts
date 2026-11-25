import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeKOutOfNDisjunctionProver } from '../../core/zkp/ZeroKnowledgeKOutOfNDisjunctionProver';

describe('ZeroKnowledgeKOutOfNDisjunctionProver', () => {
  const cds = new ZeroKnowledgeKOutOfNDisjunctionProver();

  it('proves knowledge of 3-out-of-5 witnesses without revealing which 3 witnesses are known', () => {
    const keys = [0, 1, 2, 3, 4].map(() => cds.generateKeyPair());
    const pubKeys = keys.map((k) => k.publicKey);

    const proof = cds.proveKOutOfN('cds-3-of-5', 'authorize-vault-release', pubKeys, 3, [
      { index: 0, secretKey: keys[0].secretKey },
      { index: 2, secretKey: keys[2].secretKey },
      { index: 4, secretKey: keys[4].secretKey },
    ]);

    expect(proof.polynomialCoeffs.length).toBeLessThanOrEqual(5 - 3 + 1);
    expect(cds.verifyKOutOfN(proof).valid).toBe(true);

    // Tampered branch response or inflated threshold k must fail
    expect(cds.verifyKOutOfN({ ...proof, thresholdK: 4 }).valid).toBe(false);
    expect(
      cds.verifyKOutOfN({
        ...proof,
        branches: [
          { ...proof.branches[0], responseZ: proof.branches[0].responseZ + 1n },
          ...proof.branches.slice(1),
        ],
      }).valid
    ).toBe(false);
  });

  it('handles 1-of-4 OR proofs, 4-of-4 AND proofs, batch verification, and JSON serialization', () => {
    const keys = [0, 1, 2, 3].map(() => cds.generateKeyPair());
    const pubKeys = keys.map((k) => k.publicKey);

    const orProof = cds.proveKOutOfN('cds-or', 'any-1', pubKeys, 1, [
      { index: 2, secretKey: keys[2].secretKey },
    ]);
    const andProof = cds.proveKOutOfN(
      'cds-and',
      'all-4',
      pubKeys,
      4,
      keys.map((k, index) => ({ index, secretKey: k.secretKey }))
    );

    const batch = cds.batchVerify([orProof, andProof]);
    expect(batch.allValid).toBe(true);
    expect(batch.validCount).toBe(2);

    expect(() =>
      cds.proveKOutOfN('bad-witness', 'x', pubKeys, 2, [{ index: 0, secretKey: keys[0].secretKey }])
    ).toThrow();

    const json = cds.serializeProof(orProof);
    const restored = cds.deserializeProof(json);
    expect(restored).toEqual(orProof);
    expect(cds.verifyKOutOfN(restored).valid).toBe(true);
  });
});
