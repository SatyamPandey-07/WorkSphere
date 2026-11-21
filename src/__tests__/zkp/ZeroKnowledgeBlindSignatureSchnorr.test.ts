import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeBlindSignatureSchnorr } from '../../core/zkp/ZeroKnowledgeBlindSignatureSchnorr';

describe('ZeroKnowledgeBlindSignatureSchnorr', () => {
  it('issues unlinkable blind Schnorr signatures that verify under standard Schnorr verification', () => {
    const blind = new ZeroKnowledgeBlindSignatureSchnorr();
    const issuer = blind.generateIssuerKey('ws-ca-2026', 99887766n);

    const { publicNonceR } = blind.initSignerSession('sess-1', issuer.issuerId);
    const userState = blind.createBlindedChallenge('sess-1', issuer.publicKey, publicNonceR, 'anon-pass:tier-gold');
    const signerResp = blind.signBlindedChallenge(issuer, 'sess-1', userState.blindedChallengeE);
    const sig = blind.unblindSignature(issuer.issuerId, issuer.publicKey, userState, signerResp);

    expect(blind.verifySignature(issuer.publicKey, sig)).toBe(true);
    expect(blind.verifySignature(issuer.publicKey, { ...sig, message: 'tampered' })).toBe(false);

    const unlink = blind.verifyUnlinkabilitySeparation(
      publicNonceR,
      userState.blindedChallengeE,
      signerResp.blindedS,
      sig,
      issuer.publicKey
    );
    expect(unlink.signatureValid).toBe(true);
    expect(unlink.nonceBlinded).toBe(true);
    expect(unlink.challengeBlinded).toBe(true);
    expect(unlink.responseBlinded).toBe(true);
  });

  it('blocks nonce-reuse replay attacks, batch-verifies signatures, and round-trips serialization', () => {
    const blind = new ZeroKnowledgeBlindSignatureSchnorr();
    const issuer = blind.generateIssuerKey('ws-ca-batch');

    const { publicNonceR } = blind.initSignerSession('once', issuer.issuerId);
    const st = blind.createBlindedChallenge('once', issuer.publicKey, publicNonceR, 'msg-once');
    blind.signBlindedChallenge(issuer, 'once', st.blindedChallengeE);
    // Second sign on same nonce session MUST throw to prevent secret key extraction
    expect(() => blind.signBlindedChallenge(issuer, 'once', st.blindedChallengeE + 1n)).toThrow();

    const sigs = ['tok-a', 'tok-b', 'tok-c'].map((msg, i) => {
      const { publicNonceR: r } = blind.initSignerSession(`b-${i}`, issuer.issuerId);
      const u = blind.createBlindedChallenge(`b-${i}`, issuer.publicKey, r, msg);
      const resp = blind.signBlindedChallenge(issuer, `b-${i}`, u.blindedChallengeE);
      return blind.unblindSignature(issuer.issuerId, issuer.publicKey, u, resp);
    });

    expect(blind.batchVerifySignatures(issuer.publicKey, sigs)).toBe(true);
    expect(
      blind.batchVerifySignatures(issuer.publicKey, [sigs[0], { ...sigs[1], s: sigs[1].s + 1n }, sigs[2]])
    ).toBe(false);

    const json = blind.serializeSignature(sigs[0]);
    const restored = blind.deserializeSignature(json);
    expect(restored).toEqual(sigs[0]);
    expect(blind.verifySignature(issuer.publicKey, restored)).toBe(true);
  });
});
