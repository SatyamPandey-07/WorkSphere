import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeBlindVoteReceiptProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeBlindVoteReceiptProver';

describe('ZeroKnowledgeBlindVoteReceiptProver', () => {
  it('supports Benaloh cast-or-audit ballot challenges, prevents spoiled casting, and verifies Merkle cast receipts', () => {
    const booth = new ZeroKnowledgeBlindVoteReceiptProver('city-mayor-2026', 4);
    expect(booth.getPublicParams().candidateCount).toBe(4);

    // Voter audits b1 (spoiled) to confirm terminal honesty, then casts fresh b2, b3, b4
    const b1 = booth.prepareEncryptedBallot('bal-1', 2);
    const opening1 = booth.auditAndSpoilBallot('bal-1');
    expect(opening1.candidateIndex).toBe(2);
    expect(booth.verifyAuditedOpening(b1, opening1)).toBe(true);
    expect(booth.verifyAuditedOpening(b1, { ...opening1, candidateIndex: 1 })).toBe(false);

    // Spoiled ballot CANNOT be cast!
    expect(() => booth.castBallot('bal-1')).toThrow();

    const b2 = booth.prepareEncryptedBallot('bal-2', 2);
    const b3 = booth.prepareEncryptedBallot('bal-3', 0);
    const b4 = booth.prepareEncryptedBallot('bal-4', 3);

    const r2 = booth.castBallot(b2.ballotId);
    const r3 = booth.castBallot(b3.ballotId);
    const r4 = booth.castBallot(b4.ballotId);

    // Cast ballot CANNOT be audited afterwards (ballot secrecy preserved!)
    expect(() => booth.auditAndSpoilBallot(b2.ballotId)).toThrow();

    const snap = booth.publishBallotBoxSnapshot();
    expect(snap.castCount).toBe(3);
    expect(snap.spoiledAuditCount).toBe(1);

    expect(booth.verifyReceiptInSnapshot(r2, snap)).toBe(true);
    expect(booth.verifyReceiptInSnapshot(r3, snap)).toBe(true);
    expect(booth.verifyReceiptInSnapshot(r4, snap)).toBe(true);

    // Tampered signature or sequence fails verification
    expect(booth.verifyCastReceipt({ ...r2, boxSigS: (r2.boxSigS + 1n) % SUBGROUP_Q })).toBe(false);
    expect(booth.verifyReceiptInSnapshot({ ...r2, castSequence: 99 }, snap)).toBe(false);

    const json = JSON.parse(booth.serializeSnapshot(snap)) as { castCount: number; spoiledAuditCount: number };
    expect(json.castCount).toBe(3);
    expect(json.spoiledAuditCount).toBe(1);
  });

  it('handles empty ballot box snapshots, rejects invalid candidates/duplicates, and catches forged receipts', () => {
    expect(() => new ZeroKnowledgeBlindVoteReceiptProver('bad', 1)).toThrow();
    expect(() => new ZeroKnowledgeBlindVoteReceiptProver('bad', 65)).toThrow();

    const booth = new ZeroKnowledgeBlindVoteReceiptProver('board-vote-2026', 3);
    const emptySnap = booth.publishBallotBoxSnapshot();
    expect(emptySnap.castCount).toBe(0);
    expect(emptySnap.spoiledAuditCount).toBe(0);

    expect(() => booth.prepareEncryptedBallot('neg', -1)).toThrow();
    expect(() => booth.prepareEncryptedBallot('over', 3)).toThrow();

    const b1 = booth.prepareEncryptedBallot('v-1', 1);
    expect(() => booth.prepareEncryptedBallot('v-1', 0)).toThrow();
    expect(() => booth.auditAndSpoilBallot('missing')).toThrow();
    expect(() => booth.castBallot('missing')).toThrow();

    const r1 = booth.castBallot('v-1');
    const snap = booth.publishBallotBoxSnapshot();
    expect(booth.verifyReceiptInSnapshot(r1, snap)).toBe(true);
    expect(booth.verifyReceiptInSnapshot(r1, { ...snap, castTrackingMerkleRoot: '00'.repeat(32) })).toBe(false);
    expect(booth.verifyReceiptInSnapshot({ ...r1, trackingCode: 'ff'.repeat(32) }, snap)).toBe(false);
    expect(booth.verifyCastReceipt({ ...r1, electionId: 'other-election' })).toBe(false);
    expect(b1.status).toBe('PREPARED');
  });
});
