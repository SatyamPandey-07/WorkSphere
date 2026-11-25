import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeAttributePolicyProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeAttributePolicyProver';

describe('ZeroKnowledgeAttributePolicyProver', () => {
  const engine = new ZeroKnowledgeAttributePolicyProver();

  it('verifies K-of-N CDS threshold attribute policy proofs across any K subset without revealing which attributes matched', () => {
    const attrs = ['kyc-verified', 'age-over-21', 'accredited', 'resident-eu', 'hardware-mfa'].map((id) =>
      engine.issueAttributeCredential(id),
    );
    const policy = engine.createPolicy('vault-tier-3', 3, attrs.map((a) => a.slot));

    // User A holds attributes {0, 2, 4}
    const proofA = engine.provePolicySatisfaction(policy, [attrs[0].witness, attrs[2].witness, attrs[4].witness], 'withdraw:tx-1');
    expect(proofA.challengePolyCoeffs.length).toBe(3); // degree N - K = 2 -> 3 coeffs
    expect(engine.verifyPolicyProof(policy, proofA)).toBe(true);

    // User B holds ALL 5 attributes (still produces valid 3-of-5 proof)
    const proofB = engine.provePolicySatisfaction(policy, attrs.map((a) => a.witness), 'withdraw:tx-2');
    expect(engine.verifyPolicyProof(policy, proofB)).toBe(true);

    // 1-of-5 (OR) and 5-of-5 (AND) edge thresholds
    const orPolicy = engine.createPolicy('any-1', 1, attrs.map((a) => a.slot));
    expect(engine.verifyPolicyProof(orPolicy, engine.provePolicySatisfaction(orPolicy, [attrs[3].witness], 'or-ctx'))).toBe(true);

    const andPolicy = engine.createPolicy('all-5', 5, attrs.map((a) => a.slot));
    expect(engine.verifyPolicyProof(andPolicy, engine.provePolicySatisfaction(andPolicy, attrs.map((a) => a.witness), 'and-ctx'))).toBe(true);

    const json = JSON.parse(engine.serializeProof(proofA)) as { thresholdK: number; totalSlots: number; polyDegree: number };
    expect(json).toEqual({ policyId: 'vault-tier-3', thresholdK: 3, totalSlots: 5, polyDegree: 2, resourceContext: 'withdraw:tx-1' });
  });

  it('rejects insufficient witnesses, forged secrets, and tampered policy proofs', () => {
    const attrs = ['a1', 'a2', 'a3', 'a4'].map((id) => engine.issueAttributeCredential(id));
    const policy = engine.createPolicy('strict-2-of-4', 2, attrs.map((a) => a.slot));

    expect(() => engine.issueAttributeCredential('zero', 0n)).toThrow();
    expect(() => engine.createPolicy('bad', 0, attrs.map((a) => a.slot))).toThrow();
    expect(() => engine.createPolicy('bad', 5, attrs.map((a) => a.slot))).toThrow();

    // Only 1 valid witness + 1 fake secret -> fails
    expect(() =>
      engine.provePolicySatisfaction(policy, [attrs[0].witness, { attributeId: 'a2', secretKey: 9999n }]),
    ).toThrow();

    const proof = engine.provePolicySatisfaction(policy, [attrs[1].witness, attrs[3].witness], 'ctx-sec');
    expect(engine.verifyPolicyProof(policy, proof)).toBe(true);

    expect(engine.verifyPolicyProof(policy, { ...proof, resourceContext: 'wrong-ctx' })).toBe(false);
    expect(engine.verifyPolicyProof(policy, { ...proof, thresholdK: 3 })).toBe(false);
    expect(
      engine.verifyPolicyProof(policy, {
        ...proof,
        challengePolyCoeffs: [...proof.challengePolyCoeffs, 1n], // degree tampering!
      }),
    ).toBe(false);
    const badBranches = proof.branches.map((b, i) => (i === 0 ? { ...b, response: (b.response + 1n) % SUBGROUP_Q } : b));
    expect(engine.verifyPolicyProof(policy, { ...proof, branches: badBranches })).toBe(false);
  });
});
