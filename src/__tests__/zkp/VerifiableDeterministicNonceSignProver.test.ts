import { describe, it, expect } from 'vitest';
import { VerifiableDeterministicNonceSignProver } from '../../core/zkp/VerifiableDeterministicNonceSignProver';

describe('VerifiableDeterministicNonceSignProver', () => {
  const det = new VerifiableDeterministicNonceSignProver();

  it('produces reproducible deterministic Schnorr signatures and passes cross-key batch verification', () => {
    const k1 = det.generateKeyPair('signer-1', 11223344n);
    const k2 = det.generateKeyPair('signer-2', 55667788n);

    const s1a = det.signDeterministic(k1, 'approve-release-9', 'ws-prod');
    const s1b = det.signDeterministic(k1, 'approve-release-9', 'ws-prod');
    const s1Diff = det.signDeterministic(k1, 'approve-release-10', 'ws-prod');
    const s2 = det.signDeterministic(k2, 'approve-release-9', 'ws-prod');

    expect(s1a).toEqual(s1b);
    expect(s1a.R).not.toBe(s1Diff.R);
    expect(det.verifySignature(s1a)).toBe(true);
    expect(det.verifySignature({ ...s1a, message: 'altered' })).toBe(false);

    expect(det.batchVerifyCrossKey([s1a, s1Diff, s2])).toBe(true);
    expect(det.batchVerifyCrossKey([s1a, { ...s2, s: s2.s + 1n }])).toBe(false);
  });

  it('detects catastrophic nonce reuse, recovers the exposed secret key, and serializes cleanly', () => {
    const victim = det.generateKeyPair('victim-key', 99118822n);
    const reusedNonce = 44556677n;

    const badA = det.signWithExplicitNonce(victim, 'tx-alpha', 'ctx', reusedNonce);
    const badB = det.signWithExplicitNonce(victim, 'tx-beta', 'ctx', reusedNonce);
    const safeSig = det.signDeterministic(victim, 'tx-safe', 'ctx');

    const safeReport = det.auditNonceReuse([badA, safeSig]);
    expect(safeReport.reuseDetected).toBe(false);

    const leakReport = det.auditNonceReuse([badA, badB, safeSig]);
    expect(leakReport.reuseDetected).toBe(true);
    expect(leakReport.collidingPairs).toHaveLength(1);
    expect(leakReport.collidingPairs[0].recoveredSecretKey).toBe(victim.secretKey);

    const json = det.serializeSignature(safeSig);
    const restored = det.deserializeSignature(json);
    expect(restored).toEqual(safeSig);
    expect(det.verifySignature(restored)).toBe(true);
  });
});
