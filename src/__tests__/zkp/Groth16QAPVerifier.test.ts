import { Groth16QAPVerifier, R1CSCircuitSpec } from '../../core/zkp/Groth16QAPVerifier';

/**
 * Vitalik's classic cubic R1CS: out = x^3 + x + 5
 * Variables: [0: 1, 1: out (public), 2: x, 3: sym1=x^2, 4: y=x^3, 5: sym2=x^3+x]
 */
const CUBIC_R1CS: R1CSCircuitSpec = {
  numVariables: 6,
  numPublicInputs: 1,
  constraints: [
    // x * x = sym1
    { a: new Map([[2, 1n]]), b: new Map([[2, 1n]]), c: new Map([[3, 1n]]) },
    // sym1 * x = y
    { a: new Map([[3, 1n]]), b: new Map([[2, 1n]]), c: new Map([[4, 1n]]) },
    // (y + x) * 1 = sym2
    { a: new Map([[4, 1n], [2, 1n]]), b: new Map([[0, 1n]]), c: new Map([[5, 1n]]) },
    // (sym2 + 5) * 1 = out
    { a: new Map([[5, 1n], [0, 5n]]), b: new Map([[0, 1n]]), c: new Map([[1, 1n]]) },
  ],
};

describe('Groth16QAPVerifier', () => {
  it('compiles R1CS to QAP and proves/verifies randomized zero-knowledge Groth16 proofs', () => {
    const g16 = new Groth16QAPVerifier(CUBIC_R1CS);
    // x = 3 -> sym1 = 9, y = 27, sym2 = 30, out = 35
    const proof1 = g16.prove([1n, 35n, 3n, 9n, 27n, 30n], 'zk-rand-1');
    const proof2 = g16.prove([1n, 35n, 3n, 9n, 27n, 30n], 'zk-rand-2');

    expect(g16.verify(proof1).isValid).toBe(true);
    expect(g16.verify(proof2).isValid).toBe(true);
    // Randomized zero-knowledge blinding produces distinct proof commitments
    expect(proof1.commitA).not.toBe(proof2.commitA);
  });

  it('rejects unsatisfied R1CS witnesses, tampered public inputs, and forged proofs', () => {
    const g16 = new Groth16QAPVerifier(CUBIC_R1CS);
    expect(() => g16.prove([1n, 36n, 3n, 9n, 27n, 30n], 'bad-witness')).toThrow();

    const valid = g16.prove([1n, 35n, 3n, 9n, 27n, 30n], 'zk-ok');
    expect(g16.verify({ ...valid, publicInputs: [36n] }).isValid).toBe(false);
    expect(g16.verify({ ...valid, piC: valid.piC + 1n }).isValid).toBe(false);
  });
});
