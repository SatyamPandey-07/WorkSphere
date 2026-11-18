import { describe, it, expect } from 'vitest';
import {
  CompressedPolyEvalArgument,
  CompressedPolyFieldMath,
  COMPRESSED_EVAL_PRIME,
} from '../../core/zkp/CompressedPolyEvalArgument';

describe('CompressedPolyEvalArgument', () => {
  const engine = new CompressedPolyEvalArgument(32);

  it('performs accurate modular arithmetic', () => {
    const a = 123456789n;
    const invA = CompressedPolyFieldMath.inv(a);
    expect(CompressedPolyFieldMath.mul(a, invA)).toBe(1n);
  });

  it('correctly evaluates polynomials and generates succinct logarithmic proofs', () => {
    // Polynomial: P(X) = 3 + 5X + 7X^2 + 11X^3
    const poly = [3n, 5n, 7n, 11n];
    const z = 2n;
    // Expected P(2) = 3 + 10 + 28 + 88 = 129
    const expectedVal = engine.evaluate(poly, z);
    expect(expectedVal).toBe(129n);

    const comm = engine.commit(poly);
    const proof = engine.proveEvaluation(poly, z);

    // For degree 3 (padded to 4), rounds = log2(4) = 2
    expect(proof.lCommitments.length).toBe(2);
    expect(proof.rCommitments.length).toBe(2);

    const statement = {
      commitment: comm,
      evaluationPoint: z,
      claimedValue: expectedVal,
      degree: 3,
    };

    const result = engine.verifyEvaluation(statement, proof);
    expect(result.isValid).toBe(true);
    expect(result.evaluatedValue).toBe(129n);
  });

  it('rejects tampered evaluation values', () => {
    const poly = [10n, 20n, 30n, 40n];
    const z = 3n;
    const val = engine.evaluate(poly, z);
    const comm = engine.commit(poly);
    const proof = engine.proveEvaluation(poly, z);

    const statement = {
      commitment: comm,
      evaluationPoint: z,
      claimedValue: CompressedPolyFieldMath.add(val, 1n), // tampered
      degree: 3,
    };

    const result = engine.verifyEvaluation(statement, proof);
    expect(result.isValid).toBe(false);
  });

  it('handles higher-degree polynomials (degree 7 padded to 8)', () => {
    const poly = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
    const z = 3n;
    const val = engine.evaluate(poly, z);
    const comm = engine.commit(poly);
    const proof = engine.proveEvaluation(poly, z);

    expect(proof.lCommitments.length).toBe(3); // log2(8) = 3 rounds

    const statement = {
      commitment: comm,
      evaluationPoint: z,
      claimedValue: val,
      degree: 7,
    };

    const result = engine.verifyEvaluation(statement, proof);
    expect(result.isValid).toBe(true);
  });
});
