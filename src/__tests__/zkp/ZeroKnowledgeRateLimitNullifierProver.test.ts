import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeRateLimitNullifierProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeRateLimitNullifierProver';

describe('ZeroKnowledgeRateLimitNullifierProver', () => {
  it('keeps single-message senders anonymous per epoch while recovering & slashing double-message spammers', () => {
    const rln = new ZeroKnowledgeRateLimitNullifierProver('anon-chat-2026');
    const alice = rln.registerMember('alice');
    const bob = rln.registerMember('bob');
    const carol = rln.registerMember('carol');
    const dave = rln.registerMember('dave');

    // Alice sends 1 message in epoch-1 -> accepted anonymously
    const msg1 = rln.generateSignal(alice, 'epoch-1', 'hello world');
    expect(rln.verifySignal(msg1)).toBe(true);
    expect(rln.processSignalAndDetectSpam(msg1).spamDetected).toBe(false);

    // Alice sends 1 message in epoch-2 -> unlinkable new epoch nullifier, accepted cleanly!
    const msgEp2 = rln.generateSignal(alice, 'epoch-2', 'good morning');
    expect(msgEp2.epochNullifierA1).not.toBe(msg1.epochNullifierA1);
    expect(rln.processSignalAndDetectSpam(msgEp2).spamDetected).toBe(false);

    // Carol sends TWO distinct messages in epoch-1 -> RLN mathematically recovers Carol's secret key!
    const spam1 = rln.generateSignal(carol, 'epoch-1', 'buy tokens now');
    const spam2 = rln.generateSignal(carol, 'epoch-1', 'click this link');
    expect(spam1.epochNullifierA1).toBe(spam2.epochNullifierA1);
    expect(rln.processSignalAndDetectSpam(spam1).spamDetected).toBe(false);

    const slash = rln.processSignalAndDetectSpam(spam2);
    expect(slash.spamDetected).toBe(true);
    expect(slash.recoveredSecretA0).toBe(carol.secretA0);
    expect(slash.slashedPublicCommitmentY).toBe(carol.publicCommitmentY);
    expect(slash.slashedMemberId).toBe('carol');

    // Tampered signal fails verification
    expect(rln.verifySignal({ ...msg1, message: 'forged' })).toBe(false);
    expect(rln.verifySignal({ ...msg1, c0: (msg1.c0 + 1n) % SUBGROUP_Q })).toBe(false);
    expect(bob.publicCommitmentY).not.toBe(dave.publicCommitmentY);

    const json = JSON.parse(rln.serializeSignal(msg1)) as { epochId: string; ringSize: number };
    expect(json.epochId).toBe('epoch-1');
    expect(json.ringSize).toBe(4);
  });

  it('ignores duplicate identical messages without false slashing and rejects invalid group setups or tampered proofs', () => {
    const rln = new ZeroKnowledgeRateLimitNullifierProver('rln-strict');
    expect(() => rln.registerMember('zero-sec', 0n)).toThrow();
    const u1 = rln.registerMember('u1', 123456n);
    expect(() => rln.registerMember('u1')).toThrow();
    expect(() => rln.generateSignal(u1, 'ep-1', 'too-small-group')).toThrow();

    const u2 = rln.registerMember('u2', 654321n);
    const u3 = rln.registerMember('u3', 987654n);
    const outsider = { memberId: 'ghost', secretA0: 555n, publicCommitmentY: 4n };
    expect(() => rln.generateSignal(outsider, 'ep-1', 'hi')).toThrow();

    // Identical message retransmitted in same epoch is NOT distinct spam (no false slashing!)
    const sigA = rln.generateSignal(u2, 'ep-1', 'exact-same-payload');
    const sigARetransmit = rln.generateSignal(u2, 'ep-1', 'exact-same-payload');
    expect(rln.processSignalAndDetectSpam(sigA).spamDetected).toBe(false);
    expect(rln.processSignalAndDetectSpam(sigARetransmit).spamDetected).toBe(false);

    // Tampered proof fields rejected cleanly
    expect(rln.verifySignal({ ...sigA, appId: 'other-app' })).toBe(false);
    expect(rln.verifySignal({ ...sigA, responses: sigA.responses.slice(0, 2) })).toBe(false);
    expect(rln.verifySignal({ ...sigA, shareY: (sigA.shareY + 1n) % SUBGROUP_Q })).toBe(false);
    expect(rln.processSignalAndDetectSpam({ ...sigA, message: 'tampered' }).spamDetected).toBe(false);
    expect(u3.memberId).toBe('u3');
  });
});
