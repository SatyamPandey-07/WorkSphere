import { describe, it, expect } from 'vitest';
import {
  ThresholdSchnorrMuSig,
  MuSigFieldMath,
} from '../../core/crypto/ThresholdSchnorrMuSig';

describe('ThresholdSchnorrMuSig', () => {
  const musig = new ThresholdSchnorrMuSig();

  it('aggregates 4 signer keys, verifies individual partials, and produces valid single Schnorr signature', () => {
    const signers = ['alice', 'bob', 'carol', 'dave'].map((id) => musig.generateKeyPair(id));
    const aggKey = musig.aggregatePublicKeys(
      signers.map((s) => ({ signerId: s.signerId, publicKey: s.publicKey }))
    );

    const payload = 'BRIDGE_CHECKPOINT_EPOCH_42';

    // Round 1: dual nonces
    const nonceBundles = signers.map((s) => musig.generateNoncePair(s.signerId));
    const commitments = nonceBundles.map((n) => n.commitment);
    const aggNonce = musig.aggregateNonces(commitments, aggKey, payload);

    // Round 2: partial signatures
    const partials = signers.map((s, idx) =>
      musig.createPartialSignature(s, nonceBundles[idx].state, aggKey, aggNonce)
    );

    // Verify each partial individually
    for (let i = 0; i < signers.length; i++) {
      const ok = musig.verifyPartialSignature(
        partials[i],
        signers[i].publicKey,
        commitments[i],
        aggKey,
        aggNonce
      );
      expect(ok).toBe(true);
    }

    // Aggregate into single O(1) signature and verify
    const finalSig = musig.aggregateSignatures(partials, aggKey, aggNonce);
    expect(musig.verifyFinalSignature(finalSig, payload)).toBe(true);
    expect(musig.verifyFinalSignature(finalSig, 'ALTERED_MESSAGE')).toBe(false);
  });

  it('identifies faulty partial signatures prior to aggregation', () => {
    const signers = ['s1', 's2', 's3'].map((id) => musig.generateKeyPair(id));
    const aggKey = musig.aggregatePublicKeys(
      signers.map((s) => ({ signerId: s.signerId, publicKey: s.publicKey }))
    );
    const payload = 'ATTESTATION_99';
    const nonces = signers.map((s) => musig.generateNoncePair(s.signerId));
    const aggNonce = musig.aggregateNonces(
      nonces.map((n) => n.commitment),
      aggKey,
      payload
    );

    const partial = musig.createPartialSignature(signers[0], nonces[0].state, aggKey, aggNonce);
    const corrupted = {
      ...partial,
      partialS: MuSigFieldMath.add(partial.partialS, 1n),
    };

    expect(
      musig.verifyPartialSignature(corrupted, signers[0].publicKey, nonces[0].commitment, aggKey, aggNonce)
    ).toBe(false);
  });
});
