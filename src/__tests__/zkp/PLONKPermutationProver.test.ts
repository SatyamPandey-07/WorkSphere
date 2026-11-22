import { PLONKPermutationProver, WireCell } from '../../core/zkp/PLONKPermutationProver';

describe('PLONKPermutationProver', () => {
  it('proves and verifies 3-column PLONK copy constraints via grand-product accumulator', () => {
    // Wire equivalence cycles across columns (A=0, B=1, C=2)
    const cycles: WireCell[][] = [
      [{ col: 2, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 2 }], // all equal to 15
      [{ col: 0, row: 0 }, { col: 1, row: 1 }], // both equal to 3
      [{ col: 2, row: 1 }, { col: 0, row: 3 }], // both equal to 45
    ];

    const prover = new PLONKPermutationProver(4, cycles);
    const witness = {
      colA: [3n, 15n, 7n, 45n],
      colB: [5n, 3n, 15n, 2n],
      colC: [15n, 45n, 22n, 90n],
    };

    const proof = prover.prove(witness);
    const res = prover.verify(witness, proof);

    expect(res.isValid).toBe(true);
    expect(res.verifiedRows).toBe(4);
    expect(res.finalAccumulator).toBe(1n);
  });

  it('rejects violated copy constraints and tampered accumulator traces', () => {
    const cycles: WireCell[][] = [
      [{ col: 2, row: 0 }, { col: 0, row: 1 }],
    ];
    const prover = new PLONKPermutationProver(4, cycles);

    // Violated copy constraint: colC[0]=15 != colA[1]=16
    expect(() =>
      prover.prove({
        colA: [3n, 16n, 7n, 9n],
        colB: [5n, 2n, 4n, 1n],
        colC: [15n, 32n, 11n, 9n],
      })
    ).toThrow();

    const validWitness = {
      colA: [3n, 15n, 7n, 9n],
      colB: [5n, 2n, 4n, 1n],
      colC: [15n, 30n, 11n, 9n],
    };
    const proof = prover.prove(validWitness);
    const badTrace = [...proof.accumulatorTrace];
    badTrace[2] = badTrace[2] + 1n;
    expect(prover.verify(validWitness, { ...proof, accumulatorTrace: badTrace }).isValid).toBe(false);
  });
});
