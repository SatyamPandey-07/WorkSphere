import { describe, it, expect } from 'vitest';
import { ThresholdSignatureKeyRefreshProver } from '../../core/zkp/ThresholdSignatureKeyRefreshProver';

describe('ThresholdSignatureKeyRefreshProver', () => {
  const prover = new ThresholdSignatureKeyRefreshProver();

  it('refreshes (3, 5) committee shares with zero key drift and continuous threshold signing', () => {
    const epoch1 = prover.initCommittee(3, [1, 2, 3, 4, 5]);
    const sigBefore = prover.signWithEpochShares(epoch1, [1, 3, 5], 'release-v1');
    expect(prover.verifyEpochSignature(epoch1.groupPublicKey, sigBefore)).toBe(true);

    const pkgs = epoch1.nodeIds.map((id) => prover.createZeroSumRefreshPackage(epoch1, id));
    const report = prover.applyProactiveRefresh(epoch1, pkgs, 3);

    expect(report.zeroDriftVerified).toBe(true);
    expect(report.groupKeyUnchanged).toBe(true);
    expect(report.acceptedContributors).toEqual([1, 2, 3, 4, 5]);
    expect(report.rejectedContributors).toEqual([]);
    expect(report.refreshedState.groupPublicKey).toBe(epoch1.groupPublicKey);

    // Every single member's secret share must have rotated
    for (let i = 0; i < epoch1.shares.length; i++) {
      expect(report.refreshedState.shares[i].secretShare).not.toBe(epoch1.shares[i].secretShare);
    }

    // Refreshed shares produce valid signatures under the exact same groupPublicKey
    const sigAfter = prover.signWithEpochShares(report.refreshedState, [2, 4, 5], 'release-v2');
    expect(prover.verifyEpochSignature(epoch1.groupPublicKey, sigAfter)).toBe(true);
  });

  it('blocks key-drift attacks (non-zero constant term) and corrupted Feldman delta shares', () => {
    const epoch1 = prover.initCommittee(2, [1, 2, 3, 4]);
    const pkgs = epoch1.nodeIds.map((id) => prover.createZeroSumRefreshPackage(epoch1, id));

    // Drift attack by node 2: alter constant commitment commitments[0] != 1n
    pkgs[1] = { ...pkgs[1], commitments: [4n, ...pkgs[1].commitments.slice(1)] };
    // Corrupted delta share by node 4
    pkgs[3].deltaShares.set(1, (pkgs[3].deltaShares.get(1) ?? 0n) + 19n);

    const report = prover.applyProactiveRefresh(epoch1, pkgs, 2);
    expect(report.zeroDriftVerified).toBe(true);
    expect(report.groupKeyUnchanged).toBe(true);
    expect(report.acceptedContributors).toEqual([1, 3]);
    expect(report.rejectedContributors).toEqual([2, 4]);
    expect(prover.verifyGroupKeyInvariance(report.refreshedState, [2, 4])).toBe(true);
  });

  it('prevents cross-epoch share mixing and serializes audit reports', () => {
    const epoch1 = prover.initCommittee(2, [1, 2, 3]);
    const pkgs = epoch1.nodeIds.map((id) => prover.createZeroSumRefreshPackage(epoch1, id));
    const report = prover.applyProactiveRefresh(epoch1, pkgs, 2);

    // Mixing 1 old share from Epoch 1 with 1 refreshed share from Epoch 2 breaks interpolation
    const mixedState = {
      ...report.refreshedState,
      shares: [epoch1.shares[0], report.refreshedState.shares[1], report.refreshedState.shares[2]],
    };
    expect(prover.verifyGroupKeyInvariance(mixedState, [1, 2])).toBe(false);

    const parsed = JSON.parse(prover.serializeAuditReport(report)) as {
      fromEpoch: number;
      toEpoch: number;
      zeroDriftVerified: boolean;
      auditDigest: string;
    };
    expect(parsed.fromEpoch).toBe(1);
    expect(parsed.toEpoch).toBe(2);
    expect(parsed.zeroDriftVerified).toBe(true);
    expect(parsed.auditDigest).toBe(report.auditDigest);
  });
});
