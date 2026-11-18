import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePolynomialDivisibilityBatch, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePolynomialDivisibilityBatch';

describe('ZeroKnowledgePolynomialDivisibilityBatch', () => {
  const prover = new ZeroKnowledgePolynomialDivisibilityBatch();

  it('proves exact divisibility of hidden committed polynomials P(x) = Q(x) * D(x) without exposing coefficients', () => {
    const divisorCoeffs = [2n, 3n, 1n];       // (x + 1)(x + 2)
    const quotientCoeffs = [5n, 1n, 4n];      // 5 + x + 4x^2
    const dividendCoeffs = prover.multiplyPolys(divisorCoeffs, quotientCoeffs);

    const pComm = prover.commitPolynomial('P', dividendCoeffs);
    const dComm = prover.commitPolynomial('D', divisorCoeffs);

    const proof = prover.proveDivisibility(pComm, dComm, 'plonk-vanishing-check');
    expect(prover.verifyDivisibility(proof)).toBe(true);
    expect(prover.verifyBatch([proof])).toEqual({ allValid: true, failedIndices: [] });

    // Non-divisible polynomial (add +1 remainder) MUST throw on prove
    const nonDiv = [...dividendCoeffs];
    nonDiv[0] += 1n;
    expect(() => prover.proveDivisibility(prover.commitPolynomial('P_bad', nonDiv), dComm)).toThrow();
    expect(() => prover.dividePolys([1n, 2n], [0n])).toThrow();

    // Tampered proof fields MUST fail verification
    expect(prover.verifyDivisibility({ ...proof, context: 'other' })).toBe(false);
    expect(prover.verifyDivisibility({ ...proof, respDz: (proof.respDz + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyDivisibility({ ...proof, respRDelta: (proof.respRDelta + 1n) % SUBGROUP_Q })).toBe(false);
    const badQ = [(proof.quotientCommitments[0] * 4n) % SAFE_PRIME_P, ...proof.quotientCommitments.slice(1)];
    expect(prover.verifyDivisibility({ ...proof, quotientCommitments: badQ })).toBe(false);
    expect(prover.verifyBatch([proof, { ...proof, quotientCommitments: badQ }])).toEqual({ allValid: false, failedIndices: [1] });

    const json = JSON.parse(prover.serializeProof(proof)) as { dividendDegree: number; divisorDegree: number; quotientDegree: number };
    expect(json).toEqual({ dividendDegree: 4, divisorDegree: 2, quotientDegree: 2, context: 'plonk-vanishing-check' });
  });

  it('handles linear vanishing factors, constant divisors, zero dividends, and full tamper checks', () => {
    // Vanishing divisor D(x) = (x - 5)(x - 9) = 45 - 14x + x^2
    const dLinear = prover.multiplyPolys([-5n, 1n], [-9n, 1n]);
    const qPoly = [3n, 7n, 2n, 1n];
    const pPoly = prover.multiplyPolys(dLinear, qPoly);

    const { quotient, remainder } = prover.dividePolys(pPoly, dLinear);
    expect(quotient).toEqual(qPoly);
    expect(remainder).toEqual([0n]);

    const proof1 = prover.proveDivisibility(
      prover.commitPolynomial('P1', pPoly),
      prover.commitPolynomial('D1', dLinear),
      'vanish-2-roots',
    );
    expect(prover.verifyDivisibility(proof1)).toBe(true);

    // Constant non-zero divisor D(x) = 7
    const proofConst = prover.proveDivisibility(
      prover.commitPolynomial('P2', [14n, 21n, 35n]),
      prover.commitPolynomial('D2', [7n]),
      'const-div',
    );
    expect(prover.verifyDivisibility(proofConst)).toBe(true);
    expect(prover.verifyBatch([proof1, proofConst])).toEqual({ allValid: true, failedIndices: [] });

    expect(prover.verifyDivisibility({ ...proof1, evalChallengeZ: (proof1.evalChallengeZ + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyDivisibility({ ...proof1, sigmaChallenge: (proof1.sigmaChallenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyDivisibility({ ...proof1, respRd: (proof1.respRd + 1n) % SUBGROUP_Q })).toBe(false);
    expect(prover.verifyDivisibility({ ...proof1, divisorCommitments: [] })).toBe(false);
    expect(() => prover.commitPolynomial('empty', [])).toThrow();
  });
});
