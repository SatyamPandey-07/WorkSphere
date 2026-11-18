import { Halo2AccumulatorProver } from '../../core/zkp/Halo2AccumulatorProver';

describe('Halo2AccumulatorProver', () => {
  it('accumulates and verifies multiple polynomial opening instances', () => {
    const prover = new Halo2AccumulatorProver(16);
    const e1 = prover.createOpeningInstance([3n, 7n, 11n, 5n], 19n, 101n);
    const e2 = prover.createOpeningInstance([2n, 0n, 17n], 43n, 202n);
    const e3 = prover.createOpeningInstance([9n, 13n, 4n, 8n, 1n], 71n, 303n);

    const state = prover.accumulate([e1, e2, e3]);
    const result = prover.verifyAccumulator([e1.instance, e2.instance, e3.instance], state);

    expect(result.isValid).toBe(true);
    expect(result.verifiedSteps).toBe(3);
    expect(result.recomputedCommitment).toBe(state.accumulatedCommitment);
  });

  it('rejects tampered folded coefficients', () => {
    const prover = new Halo2AccumulatorProver(16);
    const e1 = prover.createOpeningInstance([4n, 9n, 2n], 11n, 77n);
    const e2 = prover.createOpeningInstance([6n, 1n, 5n], 29n, 88n);

    const state = prover.accumulate([e1, e2]);
    const tampered = {
      ...state,
      foldedCoefficients: [state.foldedCoefficients[0] + 1n, ...state.foldedCoefficients.slice(1)],
    };

    const result = prover.verifyAccumulator([e1.instance, e2.instance], tampered);
    expect(result.isValid).toBe(false);
  });

  it('rejects tampered transcript digest or mismatched instance list', () => {
    const prover = new Halo2AccumulatorProver(16);
    const e1 = prover.createOpeningInstance([5n, 3n], 13n, 55n);
    const state = prover.accumulate([e1]);

    const badDigest = prover.verifyAccumulator([e1.instance], {
      ...state,
      transcriptDigest: '0'.repeat(64),
    });
    expect(badDigest.isValid).toBe(false);

    const badCount = prover.verifyAccumulator([], state);
    expect(badCount.isValid).toBe(false);
  });
});
