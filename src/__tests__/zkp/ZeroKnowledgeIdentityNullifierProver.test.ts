import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeIdentityNullifierProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeIdentityNullifierProver';

describe('ZeroKnowledgeIdentityNullifierProver', () => {
  it('proves anonymous group membership with topic-scoped nullifiers preventing double signaling', () => {
    const group = new ZeroKnowledgeIdentityNullifierProver('dao-anon-ballot-2026');
    const ids = Array.from({ length: 6 }, () => group.createIdentity());
    const root = group.addMembers(ids.map((id) => id.identityCommitment));

    const p1 = group.generateSignalProof(ids[2], 'proposal-42', 'VOTE_YES');
    const p1Dup = group.generateSignalProof(ids[2], 'proposal-42', 'VOTE_NO');
    const p1OtherTopic = group.generateSignalProof(ids[2], 'proposal-43', 'VOTE_YES');
    const pOtherMember = group.generateSignalProof(ids[5], 'proposal-42', 'VOTE_NO');

    expect(group.verifySignalProof(p1, root)).toBe(true);
    expect(group.verifySignalProof(p1Dup, root)).toBe(true);
    expect(group.verifySignalProof(p1OtherTopic, root)).toBe(true);
    expect(group.verifySignalProof(pOtherMember, root)).toBe(true);

    // Same member + same externalNullifier => identical nullifierHash (even for different signal!)
    expect(p1.nullifierHash).toBe(p1Dup.nullifierHash);
    // Same member + different externalNullifier => completely unlinkable nullifierHash!
    expect(p1.nullifierHash).not.toBe(p1OtherTopic.nullifierHash);

    // Admission enforces 1-signal-per-member-per-topic
    expect(group.verifyAndRecordSignal(p1, root).admitted).toBe(true);
    const dupRes = group.verifyAndRecordSignal(p1Dup, root);
    expect(dupRes.admitted).toBe(false);
    expect(dupRes.duplicateNullifier).toBe(true);
    expect(group.verifyAndRecordSignal(p1OtherTopic, root).admitted).toBe(true);
    expect(group.verifyAndRecordSignal(pOtherMember, root).admitted).toBe(true);

    // Tampered signal, topic, or root fails verification
    expect(group.verifySignalProof({ ...p1, signal: 'VOTE_TAMPERED' }, root)).toBe(false);
    expect(group.verifySignalProof({ ...p1, externalNullifier: 'proposal-99' }, root)).toBe(false);
    expect(group.verifySignalProof({ ...p1, c0: (p1.c0 + 1n) % SUBGROUP_Q }, root)).toBe(false);
    expect(group.verifySignalProof(p1, '00'.repeat(32))).toBe(false);

    // Non-member cannot prove
    const outsider = group.createIdentity();
    expect(() => group.generateSignalProof(outsider, 'proposal-42', 'HACK')).toThrow();
    expect(() => group.addMember(ids[0].identityCommitment)).toThrow();
    expect(() => group.createIdentity(0n)).toThrow();

    const json = JSON.parse(group.serializeProof(p1)) as { memberCount: number; signal: string };
    expect(json.memberCount).toBe(6);
    expect(json.signal).toBe('VOTE_YES');
  });

  it('verifies every member index in an 8-member group including first (0) and last (7) positions', () => {
    const group = new ZeroKnowledgeIdentityNullifierProver('whistleblower-group');
    const members = Array.from({ length: 8 }, (_, i) => group.createIdentity(BigInt(10000 + i * 777)));
    const root = group.addMembers(members.map((m) => m.identityCommitment));

    const seenNullifiers = new Set<bigint>();
    for (let i = 0; i < members.length; i++) {
      const proof = group.generateSignalProof(members[i], 'report-2026-q4', `msg-from-anon-${i}`);
      expect(group.verifySignalProof(proof, root)).toBe(true);
      seenNullifiers.add(proof.nullifierHash);
      const adm = group.verifyAndRecordSignal(proof, root);
      expect(adm.admitted).toBe(true);
      expect(adm.duplicateNullifier).toBe(false);
    }
    expect(seenNullifiers.size).toBe(8);
  });

  it('rejects cross-group proofs, small groups, tampered responses, and invalid nullifiers', () => {
    const g1 = new ZeroKnowledgeIdentityNullifierProver('group-alpha');
    const g2 = new ZeroKnowledgeIdentityNullifierProver('group-beta');

    const solo = g1.createIdentity();
    g1.addMember(solo.identityCommitment);
    expect(() => g1.generateSignalProof(solo, 'topic', 'hi')).toThrow();

    const m2 = g1.createIdentity();
    const m3 = g1.createIdentity();
    g1.addMembers([m2.identityCommitment, m3.identityCommitment]);
    const root1 = g1.computeGroupRoot();

    const proof = g1.generateSignalProof(m2, 'topic-x', 'payload-1');
    expect(g1.verifySignalProof(proof, root1)).toBe(true);
    // Cross-group verification fails
    expect(g2.verifySignalProof(proof)).toBe(false);

    // Tampered response vector, nullifierHash, memberCommitments, or mismatched secret fails
    const badResp = proof.responses.map((r, i) => (i === 0 ? (r + 1n) % SUBGROUP_Q : r));
    expect(g1.verifySignalProof({ ...proof, responses: badResp })).toBe(false);
    expect(g1.verifySignalProof({ ...proof, responses: proof.responses.slice(0, 2) })).toBe(false);
    expect(g1.verifySignalProof({ ...proof, nullifierHash: 1n })).toBe(false);
    expect(g1.verifySignalProof({ ...proof, memberCommitments: [...proof.memberCommitments].reverse() })).toBe(false);

    // Mismatched secret for registered commitment throws on generateSignalProof
    expect(() =>
      g1.generateSignalProof({ identitySecret: m3.identitySecret, identityCommitment: m2.identityCommitment }, 't', 's'),
    ).toThrow();

    // Invalid proof does NOT consume nullifier slot
    const badAdm = g1.verifyAndRecordSignal({ ...proof, signal: 'tampered' }, root1);
    expect(badAdm.admitted).toBe(false);
    expect(badAdm.duplicateNullifier).toBe(false);
    expect(g1.verifyAndRecordSignal(proof, root1).admitted).toBe(true);
    expect(g1.computeGroupRoot([])).toHaveLength(64);
  });

  it('produces deterministic identity commitments for explicit secrets and rejects altered group roots', () => {
    const g = new ZeroKnowledgeIdentityNullifierProver('det-group');
    const a1 = g.createIdentity(424242n);
    const a2 = g.createIdentity(424242n);
    const b = g.createIdentity(999999n);
    expect(a1.identityCommitment).toBe(a2.identityCommitment);
    const r = g.addMembers([a1.identityCommitment, b.identityCommitment]);
    const sig = g.generateSignalProof(a1, 'topic-det', 'hello-zk');
    expect(g.verifySignalProof(sig, r)).toBe(true);
    expect(g.verifySignalProof({ ...sig, groupRoot: 'ff'.repeat(32) })).toBe(false);
  });
});
