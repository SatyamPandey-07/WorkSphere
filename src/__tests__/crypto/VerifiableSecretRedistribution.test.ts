import { describe, it, expect } from 'vitest';
import {
  VerifiableSecretRedistribution,
  VSRFieldMath,
  VSR_PRIME,
  VSR_GENERATOR,
} from '../../core/crypto/VerifiableSecretRedistribution';

describe('VerifiableSecretRedistribution', () => {
  const vsr = new VerifiableSecretRedistribution();

  it('performs accurate modular arithmetic', () => {
    const a = 123456789n;
    const invA = VSRFieldMath.inv(a);
    expect(VSRFieldMath.mul(a, invA)).toBe(1n);
  });

  it('redistributes a secret from a (2, 3) committee to a (3, 5) committee', () => {
    // Original master secret
    const masterSecret = 4242424242n;

    // Old committee: 3 parties, threshold t1 = 2
    // Polynomial f(X) = masterSecret + 12345 * X
    const oldParties = [1, 2, 3];
    const oldThreshold = 2;
    const oldShares = new Map<number, bigint>([
      [1, VSRFieldMath.add(masterSecret, 12345n * 1n, VSR_PRIME)],
      [2, VSRFieldMath.add(masterSecret, 12345n * 2n, VSR_PRIME)],
      [3, VSRFieldMath.add(masterSecret, 12345n * 3n, VSR_PRIME)],
    ]);

    // Active old parties to perform redistribution (need t1 = 2)
    const activeOldParties = [1, 2];

    // New committee: 5 parties, threshold t2 = 3
    const newParties = [10, 20, 30, 40, 50];
    const newThreshold = 3;

    // Each active old party generates subshares for new committee
    const allSubshares: { [toParty: number]: any[] } = {};
    for (const p of newParties) allSubshares[p] = [];

    for (const oldP of activeOldParties) {
      const { commitment, subshares } = vsr.generateSubshares(
        oldP,
        oldShares.get(oldP)!,
        newThreshold,
        newParties,
        2
      );

      // Verify each subshare against commitment
      for (const sub of subshares) {
        expect(vsr.verifySubshare(sub, commitment)).toBe(true);
        allSubshares[sub.toParty].push(sub);
      }
    }

    // Reconstruct new shares for new parties
    const newShares: { partyIndex: number; share: bigint }[] = [];
    for (const newP of newParties) {
      const reconstructed = vsr.reconstructNewShare(newP, allSubshares[newP], activeOldParties, 2);
      expect(reconstructed.partyIndex).toBe(newP);
      newShares.push({ partyIndex: newP, share: reconstructed.share });
    }

    // Reconstruct master secret using any threshold t2 = 3 new parties (e.g. 10, 30, 50)
    const subsetNew = [newShares[0], newShares[2], newShares[4]];
    const recoveredSecret = vsr.reconstructSecret(subsetNew, newThreshold);

    expect(recoveredSecret).toBe(masterSecret);
  });

  it('rejects tampered subshares', () => {
    const { commitment, subshares } = vsr.generateSubshares(1, 999n, 2, [5, 6], 1);
    const validSub = subshares[0];
    const tamperedSub = {
      ...validSub,
      subshare: VSRFieldMath.add(validSub.subshare, 1n),
    };

    expect(vsr.verifySubshare(tamperedSub, commitment)).toBe(false);
  });
});
