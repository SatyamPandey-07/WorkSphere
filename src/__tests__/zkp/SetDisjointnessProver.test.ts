import { describe, it, expect } from 'vitest';
import {
  SetDisjointnessProver,
  DisjointPolyMath,
} from '../../core/zkp/SetDisjointnessProver';

describe('SetDisjointnessProver', () => {
  const prover = new SetDisjointnessProver(32, 123457n);

  it('proves and verifies disjointness for two sets sharing zero elements', () => {
    const userCredentials = [101n, 202n, 303n];
    const revokedList = [404n, 505n, 606n, 707n];

    const { commitmentA, commitmentB, proof } = prover.proveDisjointness(
      userCredentials,
      revokedList
    );

    const res = prover.verifyDisjointness(commitmentA, commitmentB, proof);
    expect(res.isValid).toBe(true);
    expect(res.bezoutEvaluation).toBe(1n);
  });

  it('throws when attempting to prove disjointness for overlapping sets', () => {
    const setA = [10n, 20n, 30n];
    const setB = [30n, 40n, 50n]; // shares 30n!

    expect(() => {
      prover.proveDisjointness(setA, setB);
    }).toThrow('Sets are NOT disjoint');
  });

  it('rejects tampered Bézout witness evaluations', () => {
    const { commitmentA, commitmentB, proof } = prover.proveDisjointness(
      [1n, 2n, 3n],
      [4n, 5n, 6n]
    );

    const tamperedProof = {
      ...proof,
      openingU: {
        ...proof.openingU,
        evalValue: DisjointPolyMath.add(proof.openingU.evalValue, 1n),
      },
    };

    expect(prover.verifyDisjointness(commitmentA, commitmentB, tamperedProof).isValid).toBe(false);
  });
});
