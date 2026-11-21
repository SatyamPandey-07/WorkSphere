import { NovaIVCStepVerifier, R1CSShape } from '../../core/zkp/NovaIVCStepVerifier';

/**
 * R1CS for cubic relation: y = x^3 + x + 5
 * Full vector Z = [w0=x, w1=x^2, w2=x^3, u=1, pub0=y]
 * Constraint 0: x * x = x^2
 * Constraint 1: x^2 * x = x^3
 * Constraint 2: (x^3 + x + 5*u) * u = y
 */
const CUBIC_SHAPE: R1CSShape = {
  numConstraints: 3,
  numWitnessVars: 3,
  numPublicInputs: 1,
  matrixA: [
    { row: 0, col: 0, value: 1n },
    { row: 1, col: 1, value: 1n },
    { row: 2, col: 2, value: 1n },
    { row: 2, col: 0, value: 1n },
    { row: 2, col: 3, value: 5n },
  ],
  matrixB: [
    { row: 0, col: 0, value: 1n },
    { row: 1, col: 0, value: 1n },
    { row: 2, col: 3, value: 1n },
  ],
  matrixC: [
    { row: 0, col: 1, value: 1n },
    { row: 1, col: 2, value: 1n },
    { row: 2, col: 4, value: 1n },
  ],
};

describe('NovaIVCStepVerifier', () => {
  it('chains multi-step Nova Relaxed R1CS folding and verifies satisfaction', () => {
    const nova = new NovaIVCStepVerifier(CUBIC_SHAPE);

    // Step 1: x = 3 -> y = 35
    const s1 = nova.createStrictInstance([3n, 9n, 27n], [35n], 101n);
    // Step 2: x = 5 -> y = 135
    const s2 = nova.createStrictInstance([5n, 25n, 125n], [135n], 202n);
    // Step 3: x = 7 -> y = 355
    const s3 = nova.createStrictInstance([7n, 49n, 343n], [355n], 303n);

    const fold1 = nova.fold(s1.instance, s1.witness, s2.instance, s2.witness, 404n);
    const v1 = nova.verifyFoldingStep(s1.instance, s2.instance, fold1.proof, fold1.foldedWitness);
    expect(v1.isValid).toBe(true);

    // Recursive IVC step: fold accumulated (fold1) with s3
    const fold2 = nova.fold(fold1.proof.foldedInstance, fold1.foldedWitness, s3.instance, s3.witness, 505n);
    const v2 = nova.verifyFoldingStep(
      fold1.proof.foldedInstance,
      s3.instance,
      fold2.proof,
      fold2.foldedWitness
    );
    expect(v2.isValid).toBe(true);
    expect(v2.relaxedR1CSSatisfied).toBe(true);
  });

  it('rejects tampered cross-term commitments or unsatisfied folded witnesses', () => {
    const nova = new NovaIVCStepVerifier(CUBIC_SHAPE);
    const s1 = nova.createStrictInstance([2n, 4n, 8n], [15n], 11n);
    const s2 = nova.createStrictInstance([4n, 16n, 64n], [73n], 22n);

    const fold = nova.fold(s1.instance, s1.witness, s2.instance, s2.witness, 33n);

    expect(
      nova.verifyFoldingStep(s1.instance, s2.instance, { ...fold.proof, commitT: fold.proof.commitT + 1n }).isValid
    ).toBe(false);

    const badWitness = {
      ...fold.foldedWitness,
      errorVector: [fold.foldedWitness.errorVector[0] + 1n, ...fold.foldedWitness.errorVector.slice(1)],
    };
    expect(nova.verifyFoldingStep(s1.instance, s2.instance, fold.proof, badWitness).isValid).toBe(false);
  });
});
