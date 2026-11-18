import { InnerProductEqualityProver } from '../../core/zkp/InnerProductEqualityProver';

describe('InnerProductEqualityProver', () => {
  it('proves and verifies O(log n) Bulletproofs inner-product folding for length-8 vectors', () => {
    const prover = new InnerProductEqualityProver(8);
    const vecA = [3n, 7n, 11n, 5n, 2n, 13n, 17n, 19n];
    const vecB = [4n, 6n, 2n, 9n, 8n, 1n, 5n, 3n];

    const proof = prover.prove(vecA, vecB);
    const result = prover.verify(proof);

    expect(result.isValid).toBe(true);
    expect(result.verifiedRounds).toBe(3);
    expect(proof.rounds).toHaveLength(3);
    expect(result.foldedCommitment).toBe(result.recomputedFinalPoint);
  });

  it('rejects tampered final scalars, corrupted L/R commitments, or forged inner products', () => {
    const prover = new InnerProductEqualityProver(4);
    const proof = prover.prove([10n, 20n, 30n, 40n], [1n, 2n, 3n, 4n]);

    expect(prover.verify({ ...proof, finalScalarA: proof.finalScalarA + 1n }).isValid).toBe(false);
    expect(prover.verify({ ...proof, claimedInnerProduct: proof.claimedInnerProduct + 1n }).isValid).toBe(false);

    const badRounds = [...proof.rounds];
    badRounds[0] = { ...badRounds[0], leftCommitL: badRounds[0].leftCommitL + 1n };
    expect(prover.verify({ ...proof, rounds: badRounds }).isValid).toBe(false);
  });
});
