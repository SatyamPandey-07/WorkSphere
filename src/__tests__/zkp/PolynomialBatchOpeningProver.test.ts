import { describe, it, expect } from 'vitest';
import {
  PolynomialBatchOpeningProver,
  SHPlonkPolyMath,
} from '../../core/zkp/PolynomialBatchOpeningProver';

describe('PolynomialBatchOpeningProver', () => {
  const prover = new PolynomialBatchOpeningProver(32, 54321n);

  it('opens 3 distinct polynomials at distinct overlapping point subsets in one O(1) SHPlonk proof', () => {
    const p1 = [3n, 5n, 7n, 11n];
    const p2 = [2n, 4n, 6n, 8n, 10n];
    const p3 = [13n, 17n, 19n];

    const subsets = [
      [1n, 2n],
      [2n, 3n, 4n],
      [1n, 4n],
    ];

    const { queries, proof } = prover.proveMultiPointBatch([p1, p2, p3], subsets);
    const res = prover.verifyMultiPointBatch(queries, proof);

    expect(res.isValid).toBe(true);
    expect(res.polynomialCount).toBe(3);
    expect(res.totalPointsVerified).toBe(7);
  });

  it('rejects any forged evaluation value inside the batch', () => {
    const p1 = [1n, 2n, 3n];
    const p2 = [4n, 5n, 6n];
    const { queries, proof } = prover.proveMultiPointBatch([p1, p2], [[5n], [6n, 7n]]);

    const forgedQueries = queries.map((q, idx) =>
      idx === 1 ? { ...q, values: [SHPlonkPolyMath.add(q.values[0], 1n), q.values[1]] } : q
    );

    expect(prover.verifyMultiPointBatch(forgedQueries, proof).isValid).toBe(false);
  });
});
