import { describe, it, expect } from 'vitest';
import { VerifiableAppendOnlyLogAuditProver, SUBGROUP_Q } from '../../core/zkp/VerifiableAppendOnlyLogAuditProver';

describe('VerifiableAppendOnlyLogAuditProver', () => {
  it('signs STHs, verifies entry inclusion and gossip consistency, and proves split-view equivocation', () => {
    const log = new VerifiableAppendOnlyLogAuditProver('ct-log-2026');
    const sth1 = log.appendAndSignHead(['cert-0', 'cert-1', 'cert-2'], 1700000001000);
    const sth2 = log.appendAndSignHead(['cert-3', 'cert-4', 'cert-5', 'cert-6'], 1700000002000);
    const sth3 = log.appendAndSignHead(['cert-7', 'cert-8', 'cert-9'], 1700000003000);

    expect(log.verifySTH(sth1)).toBe(true);
    expect(log.verifySTH(sth2)).toBe(true);
    expect(log.verifySTH(sth3)).toBe(true);
    expect(log.verifySTH({ ...sth3, sigS: (sth3.sigS + 1n) % SUBGROUP_Q })).toBe(false);

    // Entry inclusion proofs against sth2 and sth3
    const inc = log.proveEntryInclusion(4, sth2);
    expect(log.verifyEntryInclusion(inc)).toBe(true);
    expect(log.verifyEntryInclusion({ ...inc, leafData: 'forged-cert' })).toBe(false);

    // Gossip consistency between independent STH observations
    const g12 = log.proveGossipConsistency(sth1, sth2);
    const g23 = log.proveGossipConsistency(sth2, sth3);
    const g13 = log.proveGossipConsistency(sth1, sth3);
    expect(log.verifyGossipConsistency(g12)).toBe(true);
    expect(log.verifyGossipConsistency(g23)).toBe(true);
    expect(log.verifyGossipConsistency(g13)).toBe(true);
    expect(log.verifyGossipConsistency({ ...g13, consistencyPath: [] })).toBe(false);

    // Operator signing a conflicting root at the SAME treeSize=7 is provable equivocation!
    const evilSTH2 = log.signTreeHead(7, 1700000002500, 'aa'.repeat(32));
    expect(
      log.verifySplitViewEquivocation({
        logId: log.getLogId(),
        treeSize: 7,
        sthA: sth2,
        sthB: evilSTH2,
      }),
    ).toBe(true);
    expect(
      log.verifySplitViewEquivocation({
        logId: log.getLogId(),
        treeSize: 7,
        sthA: sth2,
        sthB: sth2,
      }),
    ).toBe(false);

    const json = JSON.parse(log.serializeSTH(sth3)) as { logId: string; treeSize: number };
    expect(json.logId).toBe('ct-log-2026');
    expect(json.treeSize).toBe(10);
  });

  it('verifies power-of-2 and equal-size STH consistency, rejects rogue operator keys and invalid bounds', () => {
    expect(() => new VerifiableAppendOnlyLogAuditProver('bad', 0n)).toThrow();
    const log = new VerifiableAppendOnlyLogAuditProver('gossip-log-v2', 777888999n);
    const otherLog = new VerifiableAppendOnlyLogAuditProver('gossip-log-v2', 111222333n);

    expect(() => log.appendAndSignHead([])).toThrow();
    const sth4 = log.appendAndSignHead(['e0', 'e1', 'e2', 'e3'], 1000);
    const sth8 = log.appendAndSignHead(['e4', 'e5', 'e6', 'e7'], 2000);
    const sth12 = log.appendAndSignHead(['e8', 'e9', 'e10', 'e11'], 3000);

    // Equal-size consistency succeeds with empty path
    const sameSize = log.proveGossipConsistency(sth4, sth4);
    expect(sameSize.consistencyPath).toEqual([]);
    expect(log.verifyGossipConsistency(sameSize)).toBe(true);

    // Power-of-2 boundary transitions 4 -> 8 -> 12
    expect(log.verifyGossipConsistency(log.proveGossipConsistency(sth4, sth8))).toBe(true);
    expect(log.verifyGossipConsistency(log.proveGossipConsistency(sth8, sth12))).toBe(true);
    expect(log.verifyGossipConsistency(log.proveGossipConsistency(sth4, sth12))).toBe(true);

    // Wrong operator public key fails STH verification
    expect(log.verifySTH(sth8, otherLog.getPublicKey())).toBe(false);
    expect(otherLog.verifySTH(sth8)).toBe(false);

    // Every leaf inclusion against sth12 passes
    for (let i = 0; i < 12; i++) {
      expect(log.verifyEntryInclusion(log.proveEntryInclusion(i, sth12))).toBe(true);
    }

    expect(() => log.proveEntryInclusion(-1, sth12)).toThrow();
    expect(() => log.proveEntryInclusion(12, sth12)).toThrow();
    expect(() => log.proveGossipConsistency(sth12, sth4)).toThrow();
  });
});
