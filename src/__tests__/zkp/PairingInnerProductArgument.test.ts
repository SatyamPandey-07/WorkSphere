import { describe, it, expect } from 'vitest';
import {
  PairingInnerProductArgument,
  TIPPFieldMath,
} from '../../core/zkp/PairingInnerProductArgument';

describe('PairingInnerProductArgument', () => {
  const tipp = new PairingInnerProductArgument(32);

  it('proves and verifies inner-product pairing argument for 8-element vectors in 3 rounds', () => {
    const vecA = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n];
    const vecB = [1n, 4n, 9n, 16n, 25n, 36n, 49n, 64n];

    const { statement, proof } = tipp.provePairingInnerProduct(vecA, vecB);
    expect(proof.rounds.length).toBe(3); // log2(8) = 3
    expect(statement.targetPairing).toBe(tipp.computeTargetPairing(vecA, vecB));

    const res = tipp.verifyPairingInnerProduct(statement, proof);
    expect(res.isValid).toBe(true);
    expect(res.roundCount).toBe(3);
  });

  it('pads non-power-of-2 vectors automatically and verifies accurately', () => {
    const vecA = [10n, 20n, 30n, 40n, 50n];
    const vecB = [5n, 4n, 3n, 2n, 1n];

    const { statement, proof } = tipp.provePairingInnerProduct(vecA, vecB);
    expect(statement.dimension).toBe(8);
    expect(statement.targetPairing).toBe(350n); // 50+80+90+80+50 = 350

    const res = tipp.verifyPairingInnerProduct(statement, proof);
    expect(res.isValid).toBe(true);
  });

  it('rejects forged target pairings or tampered final scalars', () => {
    const vecA = [10n, 20n, 30n, 40n];
    const vecB = [2n, 2n, 2n, 2n];

    const { statement, proof } = tipp.provePairingInnerProduct(vecA, vecB);

    const forgedStatement = {
      ...statement,
      targetPairing: TIPPFieldMath.add(statement.targetPairing, 1n),
    };
    expect(tipp.verifyPairingInnerProduct(forgedStatement, proof).isValid).toBe(false);

    const tamperedProof = {
      ...proof,
      finalA: TIPPFieldMath.add(proof.finalA, 1n),
    };
    expect(tipp.verifyPairingInnerProduct(statement, tamperedProof).isValid).toBe(false);
  });
});
