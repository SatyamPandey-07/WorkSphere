import { describe, it, expect } from 'vitest';
import { ThresholdDecryptionShareProver } from '../../core/zkp/ThresholdDecryptionShareProver';

describe('ThresholdDecryptionShareProver', () => {
  const prover = new ThresholdDecryptionShareProver();

  it('encrypts a message element and threshold-decrypts with any t-of-n honest shareholders', () => {
    const setup = prover.setupThresholdKeys(3, 5);
    const encoded = prover.encodeMessage(4242n);
    const ct = prover.encryptElement('ct-vault-1', setup.groupPublicKey, encoded);

    const sharesSubsetA = [setup.shares[0], setup.shares[2], setup.shares[4]].map((s) =>
      prover.computeDecryptionShare(ct, s)
    );
    for (const proof of sharesSubsetA) {
      expect(prover.verifyDecryptionShare(ct, proof)).toBe(true);
    }

    const resA = prover.recombineDecryption(ct, sharesSubsetA, 3);
    expect(resA.recoveredElement).toBe(encoded);
    expect(resA.usedParticipants).toEqual([1, 3, 5]);
    expect(resA.auditDigest).toHaveLength(64);

    // Different 3-of-5 subset must recover the exact same plaintext element
    const sharesSubsetB = [setup.shares[1], setup.shares[3], setup.shares[4]].map((s) =>
      prover.computeDecryptionShare(ct, s)
    );
    const resB = prover.recombineDecryption(ct, sharesSubsetB, 3);
    expect(resB.recoveredElement).toBe(encoded);
  });

  it('filters out malicious decryption shares while still succeeding if quorum of honest shares exists', () => {
    const setup = prover.setupThresholdKeys(2, 4);
    const encoded = prover.encodeMessage(9001n);
    const ct = prover.encryptElement('ct-fault-test', setup.groupPublicKey, encoded);

    const p1 = prover.computeDecryptionShare(ct, setup.shares[0]);
    const p2Bad = {
      ...prover.computeDecryptionShare(ct, setup.shares[1]),
      partialDecryption: 12345n,
    };
    const p3 = prover.computeDecryptionShare(ct, setup.shares[2]);

    const audit = prover.auditDecryptionShares(ct, [p1, p2Bad, p3], 2);
    expect(audit.quorumReached).toBe(true);
    expect(audit.faultyParticipantIds).toEqual([2]);
    expect(audit.validShares).toHaveLength(2);

    const recovered = prover.recombineDecryption(ct, [p1, p2Bad, p3], 2);
    expect(recovered.recoveredElement).toBe(encoded);
    expect(recovered.usedParticipants).toEqual([1, 3]);

    // Fails when fewer than threshold valid shares remain
    expect(() => prover.recombineDecryption(ct, [p1, p2Bad], 2)).toThrow();
  });

  it('batch-verifies decryption shares and round-trips JSON serialization', () => {
    const setup = prover.setupThresholdKeys(3, 4);
    const encoded = prover.encodeMessage(777n);
    const ct = prover.encryptElement('ct-batch-1', setup.groupPublicKey, encoded);
    const proofs = setup.shares.map((s) => prover.computeDecryptionShare(ct, s));

    expect(prover.batchVerifyShares(ct, proofs)).toBe(true);
    expect(prover.batchVerifyShares(ct, [])).toBe(false);

    const tampered = [
      proofs[0],
      { ...proofs[1], response: proofs[1].response + 1n },
      proofs[2],
    ];
    expect(prover.batchVerifyShares(ct, tampered)).toBe(false);

    const encodedJson = prover.serializeShareProof(proofs[0]);
    const decoded = prover.deserializeShareProof(encodedJson);
    expect(decoded).toEqual(proofs[0]);
    expect(prover.verifyDecryptionShare(ct, decoded)).toBe(true);
  });
});
