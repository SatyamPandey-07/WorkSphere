import { describe, it, expect } from 'vitest';
import { VerifiableMultiPartyCoinFlipProver, SUBGROUP_Q } from '../../core/zkp/VerifiableMultiPartyCoinFlipProver';

describe('VerifiableMultiPartyCoinFlipProver', () => {
  const engine = new VerifiableMultiPartyCoinFlipProver();

  it('finalizes honest multi-party coin flips, derives unbiased permutations, and verifies transcripts', () => {
    const p1 = engine.createCommitment('flip-2026-1', 'alice');
    const p2 = engine.createCommitment('flip-2026-1', 'bob');
    const p3 = engine.createCommitment('flip-2026-1', 'carol');

    expect(engine.verifyCommitment(p1.commitment)).toBe(true);
    expect(engine.verifyCommitment(p2.commitment)).toBe(true);
    expect(engine.verifyCommitment(p3.commitment)).toBe(true);

    // Arrival order independence
    const tA = engine.finalizeSession('flip-2026-1', [p1.commitment, p2.commitment, p3.commitment], [p3.reveal, p1.reveal, p2.reveal]);
    const tB = engine.finalizeSession('flip-2026-1', [p2.commitment, p3.commitment, p1.commitment], [p1.reveal, p2.reveal, p3.reveal]);

    expect(tA.status).toBe('FINALIZED');
    expect(tA.combinedEntropyHex).toBe(tB.combinedEntropyHex);
    expect(tA.coinBit).toBe(tB.coinBit);
    expect(engine.verifyTranscript(tA)).toBe(true);

    const roll = engine.deriveUniformRange(tA, 6);
    expect(roll).toBeGreaterThanOrEqual(0);
    expect(roll).toBeLessThan(6);

    const deck = ['A', 'B', 'C', 'D', 'E', 'F'];
    const shuffled = engine.deriveUnbiasedPermutation(tA, deck);
    expect([...shuffled].sort()).toEqual(deck);

    const json = JSON.parse(engine.serializeTranscript(tA)) as { status: string; participantCount: number };
    expect(json.status).toBe('FINALIZED');
    expect(json.participantCount).toBe(3);
  });

  it('indicts aborting and cheating participants in verifiable ABORTED transcripts', () => {
    const p1 = engine.createCommitment('flip-abort', 'alice');
    const p2 = engine.createCommitment('flip-abort', 'bob');
    const p3 = engine.createCommitment('flip-abort', 'mallory');

    // Bob aborts (no reveal); Mallory sends fake reveal
    const fakeReveal = { ...p3.reveal, entropyValue: (p3.reveal.entropyValue + 1n) % SUBGROUP_Q };
    const aborted = engine.finalizeSession('flip-abort', [p1.commitment, p2.commitment, p3.commitment], [p1.reveal, fakeReveal]);

    expect(aborted.status).toBe('ABORTED');
    expect(aborted.abortedParticipants).toEqual(['bob']);
    expect(aborted.invalidRevealParticipants).toEqual(['mallory']);
    expect(engine.verifyTranscript(aborted)).toBe(true);

    expect(() => engine.deriveUniformRange(aborted, 10)).toThrow();
    expect(() => engine.deriveUnbiasedPermutation(aborted, [1, 2, 3])).toThrow();
  });

  it('rejects tampered commitments, duplicate participants, and altered finalized transcripts', () => {
    const p1 = engine.createCommitment('flip-sec', 'alice', 111n);
    const p2 = engine.createCommitment('flip-sec', 'bob', 222n);

    expect(() => engine.finalizeSession('flip-sec', [p1.commitment], [p1.reveal])).toThrow();
    expect(() => engine.finalizeSession('flip-sec', [p1.commitment, p1.commitment], [p1.reveal])).toThrow();
    expect(engine.verifyCommitment({ ...p1.commitment, pokSVal: (p1.commitment.pokSVal + 1n) % SUBGROUP_Q })).toBe(false);

    const t = engine.finalizeSession('flip-sec', [p1.commitment, p2.commitment], [p1.reveal, p2.reveal]);
    expect(engine.verifyTranscript(t)).toBe(true);
    expect(engine.verifyTranscript({ ...t, coinBit: t.coinBit === 0 ? 1 : 0 })).toBe(false);
    expect(engine.verifyTranscript({ ...t, combinedEntropyHex: '00'.repeat(32) })).toBe(false);
    expect(() => engine.deriveUniformRange(t, 1)).toThrow();
  });
});
