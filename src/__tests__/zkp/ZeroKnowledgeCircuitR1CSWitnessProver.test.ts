import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeCircuitR1CSWitnessProver } from '../../core/zkp/ZeroKnowledgeCircuitR1CSWitnessProver';

describe('ZeroKnowledgeCircuitR1CSWitnessProver', () => {
  const r1cs = new ZeroKnowledgeCircuitR1CSWitnessProver();

  // Circuit: prove knowledge of x such that x^3 + x + 5 == y (z = [1, x, v1=x^2, v2=x^3, y])
  const cubicCircuit = {
    circuitId: 'cubic-x3-plus-x-plus-5',
    numVariables: 5,
    numConstraints: 3,
    matrixA: [
      [0n, 1n, 0n, 0n, 0n], // x
      [0n, 0n, 1n, 0n, 0n], // v1
      [5n, 1n, 0n, 1n, 0n], // 5 + x + v2
    ],
    matrixB: [
      [0n, 1n, 0n, 0n, 0n], // x
      [0n, 1n, 0n, 0n, 0n], // x
      [1n, 0n, 0n, 0n, 0n], // 1
    ],
    matrixC: [
      [0n, 0n, 1n, 0n, 0n], // v1
      [0n, 0n, 0n, 1n, 0n], // v2
      [0n, 0n, 0n, 0n, 1n], // y
    ],
  };

  it('proves and verifies zero-knowledge R1CS satisfaction without disclosing witness wires', () => {
    const witness = [1n, 3n, 9n, 27n, 35n]; // 3^3 + 3 + 5 = 35
    expect(r1cs.checkR1CSSatisfaction(cubicCircuit, witness).satisfied).toBe(true);

    const proof = r1cs.proveR1CS('r1cs-proof-1', cubicCircuit, witness);
    expect(r1cs.verifyR1CS(cubicCircuit, proof).valid).toBe(true);

    // Tampered gate response must fail
    const badProof = {
      ...proof,
      gateProofs: [
        { ...proof.gateProofs[0], zA: proof.gateProofs[0].zA + 1n },
        ...proof.gateProofs.slice(1),
      ],
    };
    expect(r1cs.verifyR1CS(cubicCircuit, badProof).valid).toBe(false);
    expect(() => r1cs.proveR1CS('bad', cubicCircuit, [1n, 3n, 9n, 27n, 36n])).toThrow();
  });

  it('folds two Relaxed-R1CS instances via Nova folding while preserving relaxed satisfaction', () => {
    const inst1 = {
      instanceId: 'inst-x3',
      uScalar: 1n,
      witnessZ: [1n, 3n, 9n, 27n, 35n],
      errorE: [0n, 0n, 0n],
      witnessCommitment: r1cs.commit(3n, 11n),
      errorCommitment: r1cs.commit(0n, 13n),
    };
    const inst2 = {
      instanceId: 'inst-x4',
      uScalar: 1n,
      witnessZ: [1n, 4n, 16n, 64n, 73n], // 4^3 + 4 + 5 = 73
      errorE: [0n, 0n, 0n],
      witnessCommitment: r1cs.commit(4n, 17n),
      errorCommitment: r1cs.commit(0n, 19n),
    };

    const { folded } = r1cs.foldRelaxedInstances(cubicCircuit, inst1, inst2);
    expect(r1cs.verifyRelaxedSatisfaction(cubicCircuit, folded)).toBe(true);
    expect(
      r1cs.verifyRelaxedSatisfaction(cubicCircuit, { ...folded, errorE: [folded.errorE[0] + 1n, folded.errorE[1], folded.errorE[2]] })
    ).toBe(false);
  });
});
