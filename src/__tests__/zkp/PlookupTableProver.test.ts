import { PlookupTableProver } from '../../core/zkp/PlookupTableProver';

describe('PlookupTableProver', () => {
  it('proves and verifies witness membership in a public lookup table', () => {
    const table = [10n, 20n, 30n, 40n, 50n, 60n];
    const prover = new PlookupTableProver(table);
    const witness = [50n, 10n, 30n, 30n, 60n, 10n];

    const proof = prover.prove(witness);
    const verification = prover.verify(proof);

    expect(verification.isValid).toBe(true);
    expect(verification.finalAccumulator).toBe(1n);
    expect(verification.witnessLength).toBe(6);
  });

  it('rejects witness containing out-of-table elements', () => {
    const prover = new PlookupTableProver([1n, 2n, 3n, 4n]);
    expect(() => prover.prove([1n, 99n, 3n])).toThrow();
  });

  it('rejects tampered sorted vector or forged accumulator trace', () => {
    const prover = new PlookupTableProver([2n, 4n, 6n, 8n]);
    const proof = prover.prove([6n, 2n, 6n]);

    const badAcc = prover.verify({
      ...proof,
      accumulatorTrace: [...proof.accumulatorTrace.slice(0, -1), 2n],
    });
    expect(badAcc.isValid).toBe(false);

    const badSorted = prover.verify({
      ...proof,
      sortedValues: [99n, ...proof.sortedValues.slice(1)],
    });
    expect(badSorted.isValid).toBe(false);
  });
});
