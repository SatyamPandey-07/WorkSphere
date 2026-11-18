import { SparseVectorLookupProver } from '../../core/zkp/SparseVectorLookupProver';

describe('SparseVectorLookupProver', () => {
  it('proves and verifies sparse vector lookups via LogUp logarithmic-derivative identity', () => {
    const sparseTable = [101n, 205n, 309n, 417n, 523n, 631n, 743n, 859n];
    const prover = new SparseVectorLookupProver(sparseTable);
    const lookups = [523n, 101n, 523n, 859n, 101n, 101n, 309n];

    const proof = prover.prove(lookups);
    const res = prover.verify(proof);

    expect(res.isValid).toBe(true);
    expect(res.verifiedLookups).toBe(7);
    expect(res.finalPartialSum).toBe(0n);
  });

  it('rejects out-of-table lookups, forged multiplicities, and corrupted reciprocals', () => {
    const prover = new SparseVectorLookupProver([11n, 22n, 33n, 44n]);
    expect(() => prover.prove([11n, 99n, 22n])).toThrow();

    const proof = prover.prove([22n, 44n, 22n]);
    expect(
      prover.verify({
        ...proof,
        multiplicities: [1n, 2n, 0n, 1n],
      }).isValid
    ).toBe(false);

    expect(
      prover.verify({
        ...proof,
        lookupReciprocals: [proof.lookupReciprocals[0] + 1n, ...proof.lookupReciprocals.slice(1)],
      }).isValid
    ).toBe(false);
  });
});
