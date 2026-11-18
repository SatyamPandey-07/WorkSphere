import { describe, it, expect } from 'vitest';
import {
  DistributedKeyRotationProtocol,
  DKRFieldMath,
  DKR_PRIME,
  DKR_GENERATOR,
} from '../../core/crypto/DistributedKeyRotationProtocol';

describe('DistributedKeyRotationProtocol', () => {
  const threshold = 3;
  const totalParties = 5;

  const dkr = new DistributedKeyRotationProtocol({
    threshold,
    totalParties,
  });

  it('performs accurate modular arithmetic', () => {
    const a = 987654321n;
    const invA = DKRFieldMath.inv(a);
    expect(DKRFieldMath.mul(a, invA)).toBe(1n);
  });

  it('rotates secret shares across epochs while strictly preserving the master secret', () => {
    // Master secret S = 7777777n
    const masterSecret = 7777777n;
    const a1 = 12345n;
    const a2 = 67890n;

    // Original polynomial f(X) = masterSecret + a1*X + a2*X^2 mod p
    const oldShares = new Map<number, bigint>();
    for (let i = 1; i <= totalParties; i++) {
      const x = BigInt(i);
      const s_i = DKRFieldMath.add(
        masterSecret,
        DKRFieldMath.add(
          DKRFieldMath.mul(a1, x, DKR_PRIME),
          DKRFieldMath.mul(a2, DKRFieldMath.mul(x, x, DKR_PRIME), DKR_PRIME),
          DKR_PRIME
        ),
        DKR_PRIME
      );
      oldShares.set(i, s_i);
    }

    // Verify original shares reconstruct masterSecret
    const origSubset = [1, 2, 3].map((i) => ({ partyIndex: i, share: oldShares.get(i)! }));
    expect(dkr.reconstructSecret(origSubset)).toBe(masterSecret);

    // Each party i generates a zero-sharing polynomial
    const subsharesForParty: { [toParty: number]: any[] } = {};
    for (let j = 1; j <= totalParties; j++) subsharesForParty[j] = [];

    for (let i = 1; i <= totalParties; i++) {
      const { commitment, subshares } = dkr.generateZeroSharing(i, 2);

      for (const sub of subshares) {
        expect(dkr.verifyZeroSubshare(sub, commitment)).toBe(true);
        subsharesForParty[sub.toParty].push(sub);
      }
    }

    // All parties apply rotation to get refreshed shares
    const rotatedShares: { partyIndex: number; share: bigint }[] = [];
    for (let j = 1; j <= totalParties; j++) {
      const oldShare = oldShares.get(j)!;
      const rotated = dkr.applyKeyRotation(j, oldShare, subsharesForParty[j], 2);

      // Refreshed share must be numerically different from old share!
      expect(rotated.newShare).not.toBe(oldShare);
      rotatedShares.push({ partyIndex: j, share: rotated.newShare });
    }

    // Reconstruct master secret from ANY threshold subset of rotated shares (e.g. parties 2, 4, 5)
    const newSubset = [rotatedShares[1], rotatedShares[3], rotatedShares[4]];
    const reconstructedSecret = dkr.reconstructSecret(newSubset);

    // The master secret is identical!
    expect(reconstructedSecret).toBe(masterSecret);
  });

  it('rejects tampered zero subshares', () => {
    const { commitment, subshares } = dkr.generateZeroSharing(1, 1);
    const validSub = subshares[0];
    const tamperedSub = {
      ...validSub,
      delta: DKRFieldMath.add(validSub.delta, 1n),
    };

    expect(dkr.verifyZeroSubshare(tamperedSub, commitment)).toBe(false);
  });
});
