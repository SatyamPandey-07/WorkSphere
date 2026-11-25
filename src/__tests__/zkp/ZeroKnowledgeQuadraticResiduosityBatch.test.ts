import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeQuadraticResiduosityBatch } from '../../core/zkp/ZeroKnowledgeQuadraticResiduosityBatch';

describe('ZeroKnowledgeQuadraticResiduosityBatch', () => {
  const ffs = new ZeroKnowledgeQuadraticResiduosityBatch();

  it('proves multi-round Feige-Fiat-Shamir quadratic residuosity knowledge with 80-bit soundness', () => {
    const kAlice = ffs.generateKeyPair('alice-ffs', 8, 44);
    const kBob = ffs.generateKeyPair('bob-ffs', 8, 44);

    const pAlice = ffs.prove(kAlice, 'authorize-session-2026', 10);
    const pBob = ffs.prove(kBob, 'authorize-session-2026', 10);

    expect(pAlice.soundnessBits).toBe(80);
    expect(ffs.verify(pAlice)).toBe(true);
    expect(ffs.verify(pBob)).toBe(true);
    expect(ffs.verifyBatch([pAlice, pBob])).toEqual({ allValid: true, failedIdentityIds: [] });

    // Tampered message, response, or challenge bit fails verification
    expect(ffs.verify({ ...pAlice, message: 'tampered-session' })).toBe(false);
    expect(ffs.verify({ ...pAlice, soundnessBits: 79 })).toBe(false);
    const badRounds = pAlice.rounds.map((r, i) => (i === 4 ? { ...r, responseY: (r.responseY + 1n) % pAlice.modulusN } : r));
    expect(ffs.verify({ ...pAlice, rounds: badRounds })).toBe(false);

    // Zero trivial response injection (0^2 == 0) rejected
    const zeroRound = pAlice.rounds.map((r, i) => (i === 0 ? { ...r, commitmentX: 0n, responseY: 0n } : r));
    expect(ffs.verify({ ...pAlice, rounds: zeroRound })).toBe(false);

    expect(ffs.verifyBatch([pAlice, { ...pBob, message: 'bad' }])).toEqual({
      allValid: false,
      failedIdentityIds: ['bob-ffs'],
    });

    expect(() => ffs.generateKeyPair('too-few', 1)).toThrow();
    expect(() => ffs.prove(kAlice, 'msg', 0)).toThrow();

    const json = JSON.parse(ffs.serializeProof(pAlice)) as { identityId: string; soundnessBits: number };
    expect(json.identityId).toBe('alice-ffs');
    expect(json.soundnessBits).toBe(80);
  });

  it('supports high-soundness 16x12 proofs and rejects swapped public square vectors', () => {
    const kp = ffs.generateKeyPair('high-sec', 16, 44);
    const proof = ffs.prove(kp, 'wire-transfer-991', 12);
    expect(proof.soundnessBits).toBe(192);
    expect(ffs.verify(proof)).toBe(true);
    expect(ffs.verify({ ...proof, publicSquares: [...proof.publicSquares].reverse() })).toBe(false);
    expect(ffs.verify({ ...proof, identityId: 'other-id' })).toBe(false);
  });

  it('rejects tampered challenge bits, wrong round indices, invalid moduli, and cross-key verification', () => {
    const k1 = ffs.generateKeyPair('id-one', 6, 42);
    const k2 = ffs.generateKeyPair('id-two', 6, 42);
    const p1 = ffs.prove(k1, 'doc-hash-xyz', 8);
    expect(ffs.verify(p1)).toBe(true);
    expect(p1.soundnessBits).toBe(48);

    // Cross-key publicSquares mismatch fails
    expect(ffs.verify({ ...p1, publicSquares: k2.publicSquares })).toBe(false);
    expect(ffs.verify({ ...p1, modulusN: k2.modulusN })).toBe(false);
    expect(ffs.verify({ ...p1, modulusN: 10n })).toBe(false);

    // Flipped challenge bit in round 2 fails
    const flipped = p1.rounds.map((r, i) =>
      i === 2 ? { ...r, challengeBits: r.challengeBits.map((b, j) => (j === 0 ? (b ^ 1) : b)) } : r,
    );
    expect(ffs.verify({ ...p1, rounds: flipped })).toBe(false);

    // Swapped round index fails
    const badOrder = p1.rounds.map((r, i) => (i === 0 ? { ...r, round: 99 } : r));
    expect(ffs.verify({ ...p1, rounds: badOrder })).toBe(false);

    // Truncated rounds fails
    expect(ffs.verify({ ...p1, rounds: p1.rounds.slice(0, 7) })).toBe(false);
    expect(ffs.verify({ ...p1, publicSquares: [p1.publicSquares[0]] })).toBe(false);

    // Out-of-bounds generator/round parameters throw
    expect(() => ffs.generateKeyPair('too-many', 33)).toThrow();
    expect(() => ffs.prove(k1, 'm', 33)).toThrow();

    // Independent proofs of same message use fresh nonces (randomized commitments)
    const p1b = ffs.prove(k1, 'doc-hash-xyz', 8);
    expect(ffs.verify(p1b)).toBe(true);
    expect(p1.rounds[0].commitmentX).not.toBe(p1b.rounds[0].commitmentX);
  });
});
