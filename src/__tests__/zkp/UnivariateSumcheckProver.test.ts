import { UnivariateSumcheckProver } from '../../core/zkp/UnivariateSumcheckProver';

describe('UnivariateSumcheckProver', () => {
  it('proves and verifies the univariate sumcheck identity for high-degree polynomials', () => {
    const prover = new UnivariateSumcheckProver(8);
    // Degree 11 polynomial (exceeds domain size 8, requiring non-trivial quotient q(X))
    const poly = [5n, 3n, 7n, 11n, 2n, 9n, 4n, 6n, 13n, 17n, 19n, 23n];

    const proof = prover.prove(poly);
    const res = prover.verify(poly, proof);

    expect(res.isValid).toBe(true);
    expect(res.lhsValue).toBe(res.rhsValue);
    expect(proof.gDegree).toBeLessThan(7);
  });

  it('rejects tampered claimed sum or forged quotient polynomial', () => {
    const prover = new UnivariateSumcheckProver(4);
    const poly = [10n, 20n, 30n, 40n, 50n, 60n];
    const proof = prover.prove(poly);

    const badSum = prover.verify(poly, { ...proof, claimedSum: proof.claimedSum + 1n });
    expect(badSum.isValid).toBe(false);

    const badQ = prover.verify(poly, {
      ...proof,
      quotientCoeffs: [proof.quotientCoeffs[0] + 1n, ...proof.quotientCoeffs.slice(1)],
    });
    expect(badQ.isValid).toBe(false);
  });

  it('rejects degree violation on remainder polynomial g(X)', () => {
    const prover = new UnivariateSumcheckProver(4);
    const poly = [1n, 2n, 3n, 4n];
    const proof = prover.prove(poly);

    const badDeg = prover.verify(poly, {
      ...proof,
      remainderGCoeffs: [1n, 2n, 3n, 4n],
      gDegree: 3,
    });
    expect(badDeg.isValid).toBe(false);
  });
});
