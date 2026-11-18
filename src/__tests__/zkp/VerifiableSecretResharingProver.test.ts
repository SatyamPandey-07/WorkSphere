import { describe, it, expect } from 'vitest';
import { VerifiableSecretResharingProver } from '../../core/zkp/VerifiableSecretResharingProver';

describe('VerifiableSecretResharingProver', () => {
  const pvsr = new VerifiableSecretResharingProver();

  it('hands over a (2, 3) genesis committee to a new (3, 5) committee with invariant group public key', () => {
    const epoch1 = pvsr.initializeGenesisEpoch(2, [1, 2, 3]);
    expect(pvsr.verifyEpochGroupPublicKey(epoch1, [1, 2])).toBe(true);
    expect(pvsr.verifyEpochGroupPublicKey(epoch1, [2, 3])).toBe(true);

    const newMembers = [10, 20, 30, 40, 50];
    const pkgs = epoch1.shares.map((s) => pvsr.createResharingPackage(s, 3, newMembers, 2));

    const handover = pvsr.executeCommitteeHandover(epoch1, pkgs, 3, newMembers);
    expect(handover.groupPublicKeyInvariant).toBe(true);
    expect(handover.faultyOldDealers).toEqual([]);
    expect(handover.newEpochState.groupPublicKey).toBe(epoch1.groupPublicKey);

    // Any 3-of-5 subset of Epoch 2 must interpolate to the exact same groupPublicKey
    expect(pvsr.verifyEpochGroupPublicKey(handover.newEpochState, [10, 30, 50])).toBe(true);
    expect(pvsr.verifyEpochGroupPublicKey(handover.newEpochState, [20, 40, 50])).toBe(true);
    expect(pvsr.verifyEpochGroupPublicKey(handover.newEpochState, [10, 20])).toBe(false);
  });

  it('isolates malicious old dealers during handover and refreshes shares with forward secrecy', () => {
    const epoch1 = pvsr.initializeGenesisEpoch(2, [1, 2, 3, 4]);
    const sameMembers = [1, 2, 3, 4];
    const pkgs = epoch1.shares.map((s) => pvsr.createResharingPackage(s, 2, sameMembers, 2));

    // Corrupt dealer 2's sub-share for member 3
    pkgs[1].subShares.set(3, (pkgs[1].subShares.get(3) ?? 0n) + 77n);
    // Corrupt dealer 4's PoP
    pkgs[3] = {
      ...pkgs[3],
      dealerSchnorrProof: {
        ...pkgs[3].dealerSchnorrProof,
        response: pkgs[3].dealerSchnorrProof.response + 1n,
      },
    };

    const handover = pvsr.executeCommitteeHandover(epoch1, pkgs, 2, sameMembers);
    expect(handover.groupPublicKeyInvariant).toBe(true);
    expect(handover.validOldDealers).toEqual([1, 3]);
    expect(handover.faultyOldDealers).toEqual([2, 4]);

    const entropy = pvsr.verifyShareRefreshEntropy(epoch1, handover.newEpochState);
    expect(entropy.allRefreshed).toBe(true);
    expect(entropy.unchangedMemberIds).toEqual([]);
  });

  it('supports multi-epoch chained handovers and serializes public handover audit logs', () => {
    const e1 = pvsr.initializeGenesisEpoch(2, [1, 2, 3]);
    const pkgs1 = e1.shares.map((s) => pvsr.createResharingPackage(s, 3, [4, 5, 6, 7], 2));
    const h1 = pvsr.executeCommitteeHandover(e1, pkgs1, 3, [4, 5, 6, 7]);

    const pkgs2 = h1.newEpochState.shares.map((s) => pvsr.createResharingPackage(s, 2, [8, 9, 10], 3));
    const h2 = pvsr.executeCommitteeHandover(h1.newEpochState, pkgs2, 2, [8, 9, 10]);

    expect(h2.groupPublicKeyInvariant).toBe(true);
    expect(h2.newEpochState.groupPublicKey).toBe(e1.groupPublicKey);
    expect(pvsr.verifyEpochGroupPublicKey(h2.newEpochState, [8, 10])).toBe(true);

    const parsed = JSON.parse(pvsr.serializePublicAudit(h2)) as {
      fromEpoch: number;
      toEpoch: number;
      groupPublicKeyInvariant: boolean;
      handoverDigest: string;
    };
    expect(parsed.fromEpoch).toBe(2);
    expect(parsed.toEpoch).toBe(3);
    expect(parsed.groupPublicKeyInvariant).toBe(true);
    expect(parsed.handoverDigest).toBe(h2.handoverDigest);
  });
});
