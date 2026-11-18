import { describe, it, expect } from 'vitest';
import { VerifiableRandomSortitionCommittee, SUBGROUP_Q } from '../../core/zkp/VerifiableRandomSortitionCommittee';

describe('VerifiableRandomSortitionCommittee', () => {
  it('selects stake-weighted VRF committee seats via binomial sortition and elects deterministic leaders', () => {
    const sortition = new VerifiableRandomSortitionCommittee();
    const v1 = sortition.registerValidator('val-alpha', 40, 1001n);
    const v2 = sortition.registerValidator('val-beta', 30, 2002n);
    const v3 = sortition.registerValidator('val-gamma', 20, 3003n);
    const v4 = sortition.registerValidator('val-delta', 10, 4004n);
    expect(sortition.getTotalStake()).toBe(100);

    const p1 = sortition.runSortition(v1, 'block-seed-900', 'proposer', 25);
    const p2 = sortition.runSortition(v2, 'block-seed-900', 'proposer', 25);
    const p3 = sortition.runSortition(v3, 'block-seed-900', 'proposer', 25);
    const p4Bad = { ...sortition.runSortition(v4, 'block-seed-900', 'proposer', 25), claimedSeats: 99 };

    expect(sortition.verifySortitionProof(p1, 25)).toBe(true);
    expect(sortition.verifySortitionProof(p2, 25)).toBe(true);
    expect(sortition.verifySortitionProof(p3, 25)).toBe(true);
    expect(sortition.verifySortitionProof(p4Bad, 25)).toBe(false);

    // Full-committee threshold tau = totalStake guarantees every validator wins all its stake seats
    const fullP1 = sortition.runSortition(v1, 'block-seed-900', 'certifier', 100);
    expect(fullP1.claimedSeats).toBe(40);
    expect(sortition.verifySortitionProof(fullP1, 100)).toBe(true);

    const report = sortition.tallyCommittee('block-seed-900', 'proposer', 25, [p1, p2, p3, p4Bad, p1]);
    expect(report.rejectedValidatorIds).toEqual(['val-delta', 'val-alpha']);
    expect(report.totalSelectedSeats).toBe(p1.claimedSeats + p2.claimedSeats + p3.claimedSeats);
    if (report.totalSelectedSeats > 0) {
      expect(report.leaderValidatorId).toBe(report.selectedValidators[0].validatorId);
    }

    // Tampered response fails VRF DLEQ verification
    expect(sortition.verifySortitionProof({ ...p1, responseSk: (p1.responseSk + 1n) % SUBGROUP_Q }, 25)).toBe(false);
    expect(() => sortition.registerValidator('val-alpha', 5)).toThrow();
    expect(() => sortition.registerValidator('zero-stake', 0)).toThrow();

    const json = JSON.parse(sortition.serializeReport(report)) as { roundSeed: string; role: string };
    expect(json.roundSeed).toBe('block-seed-900');
    expect(json.role).toBe('proposer');
  });

  it('deterministically yields identical VRF outputs per (validator, seed, role) and rejects cross-round replays', () => {
    const s = new VerifiableRandomSortitionCommittee();
    const a = s.registerValidator('node-1', 60, 77777n);
    const b = s.registerValidator('node-2', 40, 88888n);

    const pA1 = s.runSortition(a, 'seed-42', 'soft-vote', 50);
    const pA2 = s.runSortition(a, 'seed-42', 'soft-vote', 50);
    const pADiffRole = s.runSortition(a, 'seed-42', 'cert-vote', 50);
    const pB = s.runSortition(b, 'seed-42', 'soft-vote', 50);

    expect(pA1.gamma).toBe(pA2.gamma);
    expect(pA1.vrfOutputHex).toBe(pA2.vrfOutputHex);
    expect(pA1.claimedSeats).toBe(pA2.claimedSeats);
    expect(pA1.gamma).not.toBe(pADiffRole.gamma);

    // Cross-role submission rejected in tallyCommittee
    const rep = s.tallyCommittee('seed-42', 'soft-vote', 50, [pA1, pADiffRole, pB]);
    expect(rep.rejectedValidatorIds).toEqual(['node-1']);

    // Tampered fields fail verifySortitionProof
    expect(s.verifySortitionProof({ ...pA1, vrfOutputHex: '00'.repeat(32) }, 50)).toBe(false);
    expect(s.verifySortitionProof({ ...pA1, validatorId: 'unknown' }, 50)).toBe(false);
    expect(s.verifySortitionProof({ ...pA1, challenge: (pA1.challenge + 1n) % SUBGROUP_Q }, 50)).toBe(false);
    expect(s.verifySortitionProof({ ...pA1, bestSeatPriorityHex: '00'.repeat(32) }, 50)).toBe(false);

    // Zero expected committee size yields 0 seats and null priority
    expect(s.computeBinomialSeats(pA1.vrfOutputHex, 60, 0, 100)).toBe(0);
    expect(s.computeBestSeatPriority(pA1.vrfOutputHex, 0)).toBeNull();
    expect(() => s.registerValidator('zero-sk', 10, 0n)).toThrow();
  });

  it('handles empty submissions and multi-round leader rotation cleanly', () => {
    const s = new VerifiableRandomSortitionCommittee();
    const vals = ['v1', 'v2', 'v3', 'v4'].map((id, i) => s.registerValidator(id, 25, BigInt(5000 + i)));
    const emptyTally = s.tallyCommittee('seed-empty', 'proposer', 20, []);
    expect(emptyTally.totalSelectedSeats).toBe(0);
    expect(emptyTally.leaderValidatorId).toBeNull();

    for (let r = 1; r <= 3; r++) {
      const proofs = vals.map((v) => s.runSortition(v, `round-${r}`, 'proposer', 60));
      const rep = s.tallyCommittee(`round-${r}`, 'proposer', 60, proofs);
      expect(rep.rejectedValidatorIds).toEqual([]);
      expect(rep.totalSelectedSeats).toBeGreaterThan(0);
    }
  });
});
