import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeLinearEquationSystemProver } from '../../core/zkp/ZeroKnowledgeLinearEquationSystemProver';

describe('ZeroKnowledgeLinearEquationSystemProver', () => {
  const prover = new ZeroKnowledgeLinearEquationSystemProver();

  it('proves and verifies knowledge of a hidden witness solving A * x = b mod q', () => {
    const matrixA = [
      [2n, 1n, 3n, 0n],
      [1n, 4n, 0n, 2n],
      [0n, 2n, 5n, 1n],
    ];
    const secretX = [7n, 3n, 4n, 9n];
    const targetB = prover.applyMatrix(matrixA, secretX);
    const spec = { systemId: 'flow-balance-2026', matrixA, targetB };

    expect(prover.verifyPlaintextSolution(spec, secretX)).toBe(true);
    const witness = prover.commitWitness('w-1', secretX);
    const proof = prover.proveSolution('ls-proof-1', spec, witness, 3);

    expect(prover.verifySolutionProof(spec, proof).valid).toBe(true);

    // Wrong target vector b must fail verification
    const wrongSpec = { ...spec, targetB: [targetB[0] + 1n, targetB[1], targetB[2]] };
    expect(prover.verifySolutionProof(wrongSpec, proof).valid).toBe(false);
  });

  it('rejects false witnesses, batch-verifies multiple systems, and round-trips serialization', () => {
    const matrixA = [
      [3n, 2n],
      [1n, 5n],
    ];
    const goodX = [10n, 20n];
    const spec = { systemId: 'sys-2x2', matrixA, targetB: prover.applyMatrix(matrixA, goodX) };

    const badWitness = prover.commitWitness('w-bad', [10n, 21n]);
    const forgedProof = prover.proveSolution('ls-bad', spec, badWitness, 2);
    expect(prover.verifySolutionProof(spec, forgedProof).valid).toBe(false);

    const goodWitness = prover.commitWitness('w-good', goodX);
    const validProof = prover.proveSolution('ls-good', spec, goodWitness, 2);

    const batch = prover.batchVerifySolutions([{ spec, proof: validProof }]);
    expect(batch.allValid).toBe(true);
    expect(batch.validCount).toBe(1);

    const json = prover.serializeProof(validProof);
    const restored = prover.deserializeProof(json);
    expect(restored).toEqual(validProof);
    expect(prover.verifySolutionProof(spec, restored).valid).toBe(true);
  });
});
