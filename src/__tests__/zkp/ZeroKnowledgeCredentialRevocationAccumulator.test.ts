import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeCredentialRevocationAccumulator } from '../../core/zkp/ZeroKnowledgeCredentialRevocationAccumulator';

describe('ZeroKnowledgeCredentialRevocationAccumulator', () => {
  it('issues and incrementally updates membership witnesses on additions', () => {
    const acc = new ZeroKnowledgeCredentialRevocationAccumulator();
    acc.addCredential('cred-alice');
    const aliceW = acc.createMembershipWitness('cred-alice');
    expect(acc.verifyMembership(aliceW)).toBe(true);

    acc.addCredential('cred-bob');
    expect(acc.verifyMembership(aliceW)).toBe(false);

    const updatedAliceW = acc.updateWitnessOnAdd(aliceW, 'cred-bob');
    expect(acc.verifyMembership(updatedAliceW)).toBe(true);
  });

  it('revokes credentials and proves non-membership via Bezout witnesses', () => {
    const acc = new ZeroKnowledgeCredentialRevocationAccumulator();
    acc.addCredential('cred-1');
    acc.addCredential('cred-2');
    acc.addCredential('cred-3');

    const w2 = acc.createMembershipWitness('cred-2');
    expect(acc.verifyMembership(w2)).toBe(true);

    acc.revokeCredential('cred-2');
    expect(acc.verifyMembership(w2)).toBe(false);

    const nonMemberW = acc.createNonMembershipWitness('cred-2');
    expect(acc.verifyNonMembership(nonMemberW)).toBe(true);
    expect(acc.verifyNonMembership({ ...nonMemberW, commitmentD: nonMemberW.commitmentD + 1n })).toBe(false);

    const freshW1 = acc.createMembershipWitness('cred-1');
    expect(acc.verifyMembership(freshW1)).toBe(true);
  });

  it('aggregates multiple membership witnesses into a single constant-size BBF batch proof', () => {
    const acc = new ZeroKnowledgeCredentialRevocationAccumulator();
    const { witnesses } = acc.batchAddCredentials(['badge-a', 'badge-b', 'badge-c', 'badge-d']);
    expect(witnesses).toHaveLength(4);

    const batch = acc.aggregateMembershipWitnesses([witnesses[0], witnesses[2], witnesses[3]]);
    expect(batch.credentialIds).toEqual(['badge-a', 'badge-c', 'badge-d']);
    expect(acc.verifyAggregatedMembership(batch)).toBe(true);

    const tamperedBatch = { ...batch, combinedWitness: batch.combinedWitness + 1n };
    expect(acc.verifyAggregatedMembership(tamperedBatch)).toBe(false);

    acc.revokeCredential('badge-c');
    expect(acc.verifyAggregatedMembership(batch)).toBe(false);
  });

  it('rejects duplicate credentials in aggregation and exports auditable serialized state', () => {
    const acc = new ZeroKnowledgeCredentialRevocationAccumulator();
    acc.addCredential('ops-lead');
    acc.addCredential('sec-lead');
    const w = acc.createMembershipWitness('ops-lead');

    expect(() => acc.aggregateMembershipWitnesses([])).toThrow();
    expect(() => acc.aggregateMembershipWitnesses([w, w])).toThrow();

    const digest1 = acc.computeAuditDigest();
    expect(digest1).toHaveLength(64);

    const exported = JSON.parse(acc.exportSerializedState()) as {
      epoch: number;
      activeCount: number;
      auditDigest: string;
      accumulatorHex: string;
    };
    expect(exported.activeCount).toBe(2);
    expect(exported.auditDigest).toBe(digest1);
    expect(exported.epoch).toBeGreaterThanOrEqual(2);

    acc.revokeCredential('sec-lead');
    expect(acc.computeAuditDigest()).not.toBe(digest1);
  });
});
