import { describe, it, expect } from 'vitest';
import { VerifiableThresholdECDSASignatureSim } from '../../core/zkp/VerifiableThresholdECDSASignatureSim';

describe('VerifiableThresholdECDSASignatureSim', () => {
  const gov = new VerifiableThresholdECDSASignatureSim();

  it('sets up weighted governance quorums and verifies threshold decisions under invariant group key', () => {
    const setup = gov.setupWeightedGovernance(
      'epoch-2026-q4',
      [
        { memberId: 'cto', weight: 3 },
        { memberId: 'vp-sec', weight: 2 },
        { memberId: 'lead-eng', weight: 2 },
        { memberId: 'ops-mgr', weight: 1 },
      ],
      5 // Needs weight >= 5
    );

    for (const alloc of setup.allocations) {
      expect(gov.verifyMemberAllocation(alloc, setup.commitments)).toBe(true);
    }

    // cto (3) + vp-sec (2) = 5 -> meets quorum!
    const runA = gov.executeWeightedSigning(setup, 'prop-1', 'upgrade-core-v5', ['cto', 'vp-sec']);
    expect(gov.verifyDecision(runA.decision)).toBe(true);
    expect(
      gov.auditPartialContributions(
        setup.epochId,
        'prop-1',
        'upgrade-core-v5',
        setup.groupPublicKey,
        runA.decision.combinedR,
        runA.activeSlots,
        runA.partials
      ).allValid
    ).toBe(true);

    // vp-sec (2) + lead-eng (2) + ops-mgr (1) = 5 -> different quorum, same groupPublicKey!
    const runB = gov.executeWeightedSigning(setup, 'prop-2', 'rotate-keys', ['vp-sec', 'lead-eng', 'ops-mgr']);
    expect(gov.verifyDecision(runB.decision)).toBe(true);
    expect(gov.batchVerifyDecisions([runA.decision, runB.decision])).toBe(true);

    // Insufficient weight (vp-sec + ops-mgr = 3 < 5) must throw
    expect(() => gov.executeWeightedSigning(setup, 'prop-fail', 'nope', ['vp-sec', 'ops-mgr'])).toThrow();

    const json = gov.serializeDecision(runA.decision);
    const restored = gov.deserializeDecision(json);
    expect(restored).toEqual(runA.decision);
    expect(gov.verifyDecision(restored)).toBe(true);
  });
});
