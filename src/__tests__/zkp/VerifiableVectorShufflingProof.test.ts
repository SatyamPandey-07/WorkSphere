import { describe, it, expect } from 'vitest';
import {
  VerifiableVectorShufflingProof,
  ShuffleFieldMath,
  SHUFFLE_PRIME,
} from '../../core/zkp/VerifiableVectorShufflingProof';

describe('VerifiableVectorShufflingProof', () => {
  const engine = new VerifiableVectorShufflingProof(32);

  it('performs accurate field arithmetic', () => {
    const a = 987654321n;
    const invA = ShuffleFieldMath.inv(a);
    expect(ShuffleFieldMath.mul(a, invA)).toBe(1n);
  });

  it('generates and verifies valid permutation proofs for arbitrary shuffles', () => {
    const inputVector = [11n, 22n, 33n, 44n, 55n];
    // Permutation: 0->3, 1->0, 2->4, 3->1, 4->2
    const permutation = [3, 0, 4, 1, 2];

    const proof = engine.generatePermutationProof(inputVector, permutation);
    expect(proof.boundaryProof.z0).toBe(1n);
    expect(proof.boundaryProof.zn).toBe(1n);
    expect(proof.transitionEvaluationProof).toBe(0n);

    const statement = {
      inputCommitment: proof.inputCommitment,
      outputCommitment: proof.outputCommitment,
      vectorLength: inputVector.length,
    };

    const result = engine.verifyPermutationProof(statement, proof);
    expect(result.isValid).toBe(true);
    expect(result.vectorLength).toBe(5);
  });

  it('verifies identity shuffles', () => {
    const inputVector = [100n, 200n, 300n];
    const identityPerm = [0, 1, 2];

    const proof = engine.generatePermutationProof(inputVector, identityPerm);
    const statement = {
      inputCommitment: proof.inputCommitment,
      outputCommitment: proof.outputCommitment,
      vectorLength: 3,
    };

    const result = engine.verifyPermutationProof(statement, proof);
    expect(result.isValid).toBe(true);
  });

  it('rejects non-permutations where elements are altered', () => {
    const inputVector = [10n, 20n, 30n];
    // Attempting to prove with invalid permutation index should throw
    expect(() => {
      engine.generatePermutationProof(inputVector, [0, 1, 1]); // duplicate index
    }).toThrow('Invalid permutation mapping');
  });

  it('rejects tampered boundary proofs or transition proofs', () => {
    const inputVector = [5n, 15n, 25n, 35n];
    const permutation = [2, 3, 0, 1];

    const proof = engine.generatePermutationProof(inputVector, permutation);

    // Tamper with zn
    const tamperedProof = {
      ...proof,
      boundaryProof: {
        z0: 1n,
        zn: 2n,
      },
    };

    const statement = {
      inputCommitment: proof.inputCommitment,
      outputCommitment: proof.outputCommitment,
      vectorLength: 4,
    };

    const result = engine.verifyPermutationProof(statement, tamperedProof);
    expect(result.isValid).toBe(false);
  });
});
