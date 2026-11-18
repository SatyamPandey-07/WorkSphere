import { describe, it, expect } from 'vitest';
import {
  NonInteractiveVectorCommitment,
  NIVCFieldMath,
  NIVC_PRIME,
} from '../../core/zkp/NonInteractiveVectorCommitment';

describe('NonInteractiveVectorCommitment', () => {
  const nivc = new NonInteractiveVectorCommitment(32);

  it('performs accurate modular arithmetic', () => {
    const a = 123456789n;
    const invA = NIVCFieldMath.inv(a);
    expect(NIVCFieldMath.mul(a, invA)).toBe(1n);
  });

  it('commits to vector, creates single opening proof, and verifies in O(1)', () => {
    const vector = [10n, 25n, 40n, 55n, 70n];
    const commitment = nivc.commit(vector);
    expect(commitment).toBeDefined();

    // Open index 2 (value 40)
    const proof = nivc.createOpeningProof(vector, 2);
    expect(proof.index).toBe(2);
    expect(proof.value).toBe(40n);

    const result = nivc.verifyOpening(commitment, 2, 40n, proof);
    expect(result.isValid).toBe(true);
  });

  it('rejects openings with tampered values', () => {
    const vector = [10n, 20n, 30n];
    const commitment = nivc.commit(vector);
    const proof = nivc.createOpeningProof(vector, 1);

    const result = nivc.verifyOpening(commitment, 1, 999n, { ...proof, value: 999n });
    expect(result.isValid).toBe(false);
  });

  it('performs dynamic O(1) commitment and witness updates', () => {
    const vector = [100n, 200n, 300n, 400n];
    let commitment = nivc.commit(vector);

    // Opening for index 0 and index 2
    let proof0 = nivc.createOpeningProof(vector, 0);
    let proof2 = nivc.createOpeningProof(vector, 2);

    expect(nivc.verifyOpening(commitment, 0, 100n, proof0).isValid).toBe(true);
    expect(nivc.verifyOpening(commitment, 2, 300n, proof2).isValid).toBe(true);

    // Update coordinate at index 0 by +50 (100 -> 150)
    const delta = 50n;
    vector[0] += delta;

    // Update proof0
    const update0 = nivc.updateCommitmentAndProof(commitment, proof0, 0, delta);
    commitment = update0.updatedCommitment;
    proof0 = update0.updatedProof;

    // Update proof2 for modification at index 0
    const update2 = nivc.updateCommitmentAndProof(commitment, proof2, 0, delta);
    proof2 = update2.updatedProof;

    // Both updated proofs must verify under the updated commitment!
    expect(nivc.verifyOpening(commitment, 0, 150n, proof0).isValid).toBe(true);
    expect(nivc.verifyOpening(commitment, 2, 300n, proof2).isValid).toBe(true);
  });

  it('aggregates multiple opening proofs into a single batch proof', () => {
    const vector = [5n, 15n, 25n, 35n, 45n, 55n];
    const commitment = nivc.commit(vector);

    const indices = [1, 3, 5];
    const values = [15n, 35n, 55n];
    const proofs = indices.map((idx) => nivc.createOpeningProof(vector, idx));

    const batchProof = nivc.aggregateOpenings(commitment, indices, values, proofs);
    expect(batchProof.indices).toEqual(indices);

    const result = nivc.verifyBatchOpening(commitment, batchProof);
    expect(result.isValid).toBe(true);
  });
});
