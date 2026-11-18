import { describe, it, expect } from 'vitest';
import { VerifiableTimedCommitmentProver } from '../../core/zkp/VerifiableTimedCommitmentProver';

describe('VerifiableTimedCommitmentProver', () => {
  const timed = new VerifiableTimedCommitmentProver();

  it('creates verifiable timed commitments that support both fast cooperative and forced time-lock opening', () => {
    const message = 'sealed-bid:worksphere-floor-9:amount=8750';
    const { proof, secret } = timed.commitTimed('tc-auction-001', message, 150);

    expect(timed.verifyCommitmentProof(proof).valid).toBe(true);

    // Fast cooperative O(1) opening
    const coop = timed.verifyCooperativeOpening(proof, {
      commitmentId: secret.commitmentId,
      secretMessage: secret.secretMessage,
      blindingScalar: secret.blindingScalar,
    });
    expect(coop.valid).toBe(true);

    // Forced sequential squaring opening recovers the exact message without secret
    const forced = timed.forceOpenBySequentialSquaring(proof);
    expect(forced.valid).toBe(true);
    expect(forced.recoveredMessage).toBe(message);
    expect(forced.computedKeyMask).toBe(secret.puzzleKeyMask);
  });

  it('rejects tampered Wesolowski puzzle proofs, forged cooperative openings, and invalid delays', () => {
    expect(() => timed.commitTimed('tc-small', 'hi', 5)).toThrow();

    const { proof, secret } = timed.commitTimed('tc-tamper', 'confidential-plan', 80);

    expect(timed.verifyCommitmentProof({ ...proof, wesolowskiPi: proof.wesolowskiPi + 1n }).valid).toBe(false);
    expect(timed.verifyCommitmentProof({ ...proof, puzzleHintY: proof.puzzleHintY + 1n }).valid).toBe(false);
    expect(
      timed.verifyCommitmentProof({
        ...proof,
        bindingProof: { ...proof.bindingProof, responseMsg: proof.bindingProof.responseMsg + 1n },
      }).valid
    ).toBe(false);

    expect(
      timed.verifyCooperativeOpening(proof, {
        commitmentId: secret.commitmentId,
        secretMessage: 'wrong-secret',
        blindingScalar: secret.blindingScalar,
      }).valid
    ).toBe(false);
  });

  it('serializes and deserializes timed commitment proofs cleanly', () => {
    const { proof } = timed.commitTimed('tc-ser-42', 'escrow-release-key-991', 60);
    const json = timed.serializeProof(proof);
    const restored = timed.deserializeProof(json);

    expect(restored).toEqual(proof);
    expect(timed.verifyCommitmentProof(restored).valid).toBe(true);
    expect(timed.forceOpenBySequentialSquaring(restored).recoveredMessage).toBe('escrow-release-key-991');
  });
});
