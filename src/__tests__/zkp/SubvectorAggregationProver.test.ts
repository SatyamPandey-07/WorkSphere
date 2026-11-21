import { describe, it, expect } from 'vitest';
import {
  SubvectorAggregationProver,
  SubvectorFieldMath,
  SUBVECTOR_PRIME,
} from '../../core/zkp/SubvectorAggregationProver';

describe('SubvectorAggregationProver', () => {
  const prover = new SubvectorAggregationProver();

  it('performs accurate modular field arithmetic', () => {
    const a = 123456789n;
    const invA = SubvectorFieldMath.inv(a);
    expect(SubvectorFieldMath.mul(a, invA)).toBe(1n);
  });

  it('proves and verifies subvector aggregation arguments', () => {
    const vector = [10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n];
    const vectorComm = prover.commitVector(vector);

    // Pick indices 1, 3, 5 -> values [20, 40, 60]
    const indices = [1, 3, 5];
    const claimedValues = [20n, 40n, 60n];
    const weights = [2n, 3n, 4n];
    // Aggregate: 2*20 + 3*40 + 4*60 = 40 + 120 + 240 = 400
    const aggregateClaim = 400n;

    const proof = prover.proveSubvectorAggregation(vector, indices, weights);
    expect(proof.subvectorCommitment).toBeDefined();

    const statement = {
      vectorCommitment: vectorComm,
      indices,
      claimedValues,
      weights,
      aggregateClaim,
    };

    const result = prover.verifySubvectorAggregation(statement, proof);
    expect(result.isValid).toBe(true);
    expect(result.aggregateClaim).toBe(400n);
  });

  it('rejects falsified aggregate inner product claims', () => {
    const vector = [10n, 20n, 30n, 40n];
    const vectorComm = prover.commitVector(vector);
    const indices = [0, 2];
    const claimedValues = [10n, 30n];
    const weights = [1n, 1n];

    const proof = prover.proveSubvectorAggregation(vector, indices, weights);

    // Provide incorrect aggregate claim in statement
    const statement = {
      vectorCommitment: vectorComm,
      indices,
      claimedValues,
      weights,
      aggregateClaim: 999n, // wrong claim
    };

    const result = prover.verifySubvectorAggregation(statement, proof);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Claimed inner product does not match');
  });

  it('rejects tampered quotient proofs', () => {
    const vector = [100n, 200n, 300n, 400n];
    const vectorComm = prover.commitVector(vector);
    const indices = [1, 2];
    const claimedValues = [200n, 300n];
    const weights = [1n, 2n];
    const aggregateClaim = 800n;

    const proof = prover.proveSubvectorAggregation(vector, indices, weights);

    // Tamper with quotient proof
    const tamperedProof = {
      ...proof,
      quotientProof: SubvectorFieldMath.add(proof.quotientProof, 1n),
    };

    const statement = {
      vectorCommitment: vectorComm,
      indices,
      claimedValues,
      weights,
      aggregateClaim,
    };

    const result = prover.verifySubvectorAggregation(statement, tamperedProof);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Vector decomposition relation violated');
  });
});
