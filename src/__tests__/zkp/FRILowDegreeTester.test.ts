import { FRILowDegreeTester } from '../../core/zkp/FRILowDegreeTester';

describe('FRILowDegreeTester', () => {
  it('proves and verifies STARK FRI low-degree Reed-Solomon folding with Merkle queries', () => {
    const fri = new FRILowDegreeTester(8, 4, 6);
    const poly = [3n, 7n, 11n, 5n, 2n, 13n, 17n, 19n]; // degree 7 < 8

    const proof = fri.prove(poly);
    const res = fri.verify(proof);

    expect(res.isValid).toBe(true);
    expect(res.verifiedLayers).toBe(3);
    expect(res.verifiedQueries).toBe(6);
  });

  it('rejects polynomials exceeding degree bound, tampered Merkle leaves, or forged final constants', () => {
    const fri = new FRILowDegreeTester(4, 4, 4);
    expect(() => fri.prove([1n, 2n, 3n, 4n, 5n])).toThrow();

    const proof = fri.prove([10n, 20n, 30n, 40n]);
    expect(fri.verify({ ...proof, finalConstant: proof.finalConstant + 1n }).isValid).toBe(false);

    const badQueries = [...proof.queries];
    const badSteps = [...badQueries[0].steps];
    badSteps[0] = {
      ...badSteps[0],
      posPath: { ...badSteps[0].posPath, leafValue: badSteps[0].posPath.leafValue + 1n },
    };
    badQueries[0] = { ...badQueries[0], steps: badSteps };
    expect(fri.verify({ ...proof, queries: badQueries }).isValid).toBe(false);
  });
});
