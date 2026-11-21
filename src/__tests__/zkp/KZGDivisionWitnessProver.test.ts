import { KZGDivisionWitnessProver } from '../../core/zkp/KZGDivisionWitnessProver';

describe('KZGDivisionWitnessProver', () => {
  it('proves and verifies multi-point KZG polynomial division witnesses', () => {
    const prover = new KZGDivisionWitnessProver(32);
    const poly = [7n, 3n, 11n, 5n, 2n, 19n, 13n];
    const points = [2n, 5n, 9n, 17n];

    const proof = prover.proveMultiPoint(poly, points);
    const result = prover.verifyMultiPoint(proof);

    expect(result.isValid).toBe(true);
    expect(result.verifiedPoints).toBe(4);
    expect(result.commitmentEquationValid).toBe(true);
    expect(result.challengeEquationValid).toBe(true);
  });

  it('rejects false claimed evaluations and tampered quotient witnesses', () => {
    const prover = new KZGDivisionWitnessProver(16);
    const poly = [4n, 8n, 12n, 16n, 20n];
    const proof = prover.proveMultiPoint(poly, [1n, 3n, 7n]);

    const badClaims = proof.claims.map((c, i) => (i === 1 ? { ...c, value: c.value + 1n } : c));
    expect(prover.verifyMultiPoint({ ...proof, claims: badClaims }).isValid).toBe(false);

    const badQ = [proof.quotientCoeffs[0] + 1n, ...proof.quotientCoeffs.slice(1)];
    expect(prover.verifyMultiPoint({ ...proof, quotientCoeffs: badQ }).isValid).toBe(false);
  });
});
