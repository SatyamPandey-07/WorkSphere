import { describe, it, expect } from 'vitest';
import { VerifiableThresholdQuorumProofProver, SUBGROUP_Q } from '../../core/zkp/VerifiableThresholdQuorumProofProver';

describe('VerifiableThresholdQuorumProofProver', () => {
  it('enforces multi-tier role-weighted governance policies and isolates invalid or dissenting votes', () => {
    const gov = new VerifiableThresholdQuorumProofProver();
    const exec1 = gov.registerMember('ceo', 'exec', 30n);
    const sec1 = gov.registerMember('ciso', 'security', 20n);
    const sec2 = gov.registerMember('sec-eng', 'security', 15n);
    const aud1 = gov.registerMember('auditor-1', 'audit', 15n);
    const aud2 = gov.registerMember('auditor-2', 'audit', 10n);

    const policy = {
      policyId: 'prod-deploy-tier3',
      minTotalWeight: 70n,
      minTotalSigners: 4,
      tierRequirements: [
        { role: 'exec', minSigners: 1, minWeight: 25n },
        { role: 'security', minSigners: 2, minWeight: 30n },
        { role: 'audit', minSigners: 1, minWeight: 10n },
      ],
    };

    const digest = gov.computeProposalDigest(policy.policyId, 'prop-99', 'upgrade-zk-verifier-v2');

    // Missing security quorum (only sec1) fails with unmet tier ROLE:security
    const partial = gov.assembleQuorumProof(policy, 'prop-99', digest, [
      gov.signApproval(exec1, policy.policyId, 'prop-99', digest),
      gov.signApproval(sec1, policy.policyId, 'prop-99', digest),
      gov.signApproval(aud1, policy.policyId, 'prop-99', digest),
    ]);
    expect(partial.bundle).toBeNull();
    expect(partial.unmetTiers).toContain('ROLE:security');

    // Valid quorum with 1 REJECT vote + 1 forged vote cleanly isolated
    const rejectVote = gov.signApproval(aud2, policy.policyId, 'prop-99', digest, 'REJECT');
    const forgedSec = { ...gov.signApproval(sec2, policy.policyId, 'prop-99', digest), sigS: 12345n };
    const goodSec2 = gov.signApproval(sec2, policy.policyId, 'prop-99', digest);

    const res = gov.assembleQuorumProof(policy, 'prop-99', digest, [
      gov.signApproval(exec1, policy.policyId, 'prop-99', digest),
      gov.signApproval(sec1, policy.policyId, 'prop-99', digest),
      forgedSec,
      goodSec2,
      gov.signApproval(aud1, policy.policyId, 'prop-99', digest),
      rejectVote,
    ]);

    expect(res.bundle).not.toBeNull();
    expect(res.rejectedMemberIds).toEqual(['sec-eng', 'auditor-2']);
    expect(res.bundle!.totalApprovedWeight).toBe(80n);
    expect(gov.verifyQuorumProof(policy, res.bundle!)).toBe(true);

    // Tampered approval signature or total weight fails verification
    expect(gov.verifyQuorumProof(policy, { ...res.bundle!, totalApprovedWeight: 81n })).toBe(false);
    expect(
      gov.verifyQuorumProof(policy, {
        ...res.bundle!,
        approvals: [{ ...res.bundle!.approvals[0], sigS: (res.bundle!.approvals[0].sigS + 1n) % SUBGROUP_Q }, ...res.bundle!.approvals.slice(1)],
      }),
    ).toBe(false);

    const json = JSON.parse(gov.serializeBundle(res.bundle!)) as { totalApprovedWeight: string };
    expect(json.totalApprovedWeight).toBe('80');
  });

  it('rejects duplicate signers, role spoofing, wrong proposals, and tampered bundle digests', () => {
    const gov = new VerifiableThresholdQuorumProofProver();
    const m1 = gov.registerMember('m1', 'ops', 40n);
    const m2 = gov.registerMember('m2', 'ops', 35n);
    const m3 = gov.registerMember('m3', 'legal', 25n);

    expect(() => gov.registerMember('m1', 'ops', 10n)).toThrow();
    expect(() => gov.registerMember('m4', 'ops', 0n)).toThrow();

    const policy = {
      policyId: 'release-gate',
      minTotalWeight: 60n,
      minTotalSigners: 2,
      tierRequirements: [
        { role: 'ops', minSigners: 1, minWeight: 35n },
        { role: 'legal', minSigners: 1, minWeight: 20n },
      ],
    };

    const d1 = gov.computeProposalDigest(policy.policyId, 'p1', 'release-1');
    const a1 = gov.signApproval(m1, policy.policyId, 'p1', d1);
    const a3 = gov.signApproval(m3, policy.policyId, 'p1', d1);

    // Role spoofing fails verification
    expect(gov.verifyApproval(policy.policyId, d1, { ...a1, role: 'legal' })).toBe(false);
    expect(gov.verifyApproval(policy.policyId, d1, { ...a1, memberId: 'ghost' })).toBe(false);

    // Duplicate m1 submissions do not double-count
    const dupRes = gov.assembleQuorumProof(policy, 'p1', d1, [a1, a1]);
    expect(dupRes.bundle).toBeNull();
    expect(dupRes.rejectedMemberIds).toEqual(['m1']);
    expect(dupRes.unmetTiers).toContain('ROLE:legal');

    const okRes = gov.assembleQuorumProof(policy, 'p1', d1, [a1, a3]);
    expect(okRes.bundle).not.toBeNull();
    expect(gov.verifyQuorumProof(policy, okRes.bundle!)).toBe(true);
    expect(gov.verifyQuorumProof(policy, { ...okRes.bundle!, bundleDigest: '00'.repeat(32) })).toBe(false);
    expect(gov.verifyQuorumProof({ ...policy, policyId: 'other' }, okRes.bundle!)).toBe(false);
    expect(gov.verifyQuorumProof(policy, { ...okRes.bundle!, approvals: [a1, gov.signApproval(m2, policy.policyId, 'p1', d1)] })).toBe(false);
  });
});
