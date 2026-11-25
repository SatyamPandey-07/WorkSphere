import { describe, it, expect } from 'vitest';
import { VerifiableProxyDelegationRevoker, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/VerifiableProxyDelegationRevoker';

describe('VerifiableProxyDelegationRevoker', () => {
  it('delegates epoch-scoped proxy re-encryption with DLEQ honesty proofs and instant revocation', () => {
    const pre = new VerifiableProxyDelegationRevoker();
    const alice = pre.generateKeyPair('alice');
    const bob = pre.generateKeyPair('bob');
    const carol = pre.generateKeyPair('carol');

    const ctEp1 = pre.encryptForEpoch(alice.userId, alice.publicKey, '2026-W46', 777n);
    const ctEp2 = pre.encryptForEpoch(alice.userId, alice.publicKey, '2026-W47', 888n);
    expect(pre.decryptAsOwner(alice, ctEp1)).toBe(777n);
    expect(pre.decryptAsOwner(alice, ctEp2)).toBe(888n);

    const grant = pre.issueReEncryptionGrant('grant-ep1-bob', alice, bob, '2026-W46');
    expect(pre.verifyGrant(grant)).toBe(true);

    // Proxy re-encrypts epoch 1 ciphertext for Bob; cannot misuse grant for epoch 2!
    const capsule = pre.proxyReEncrypt(grant, ctEp1);
    expect(pre.verifyReEncryptedCapsule(grant, capsule)).toBe(true);
    expect(() => pre.proxyReEncrypt(grant, ctEp2)).toThrow();

    // Bob decrypts exact plaintext; Carol cannot decrypt
    expect(pre.decryptAsDelegatee(bob, grant, capsule)).toBe(777n);
    expect(pre.decryptAsDelegatee(carol, grant, capsule)).toBeNull();

    // Tampered proxy capsule fails DLEQ verification
    expect(pre.verifyReEncryptedCapsule(grant, { ...capsule, transformedC1: (capsule.transformedC1 * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(pre.verifyReEncryptedCapsule(grant, { ...capsule, responseReKey: (capsule.responseReKey + 1n) % SUBGROUP_Q })).toBe(false);

    // Revoking grant immediately blocks future proxy re-encryption AND invalidates capsule verification
    pre.revokeGrant('grant-ep1-bob');
    expect(pre.isGrantRevoked('grant-ep1-bob')).toBe(true);
    expect(pre.verifyGrant(grant)).toBe(false);
    expect(() => pre.proxyReEncrypt(grant, ctEp1)).toThrow();
    expect(pre.decryptAsDelegatee(bob, grant, capsule)).toBeNull();

    const json = JSON.parse(pre.serializeCapsule(capsule)) as { grantId: string; epochId: string };
    expect(json.grantId).toBe('grant-ep1-bob');
    expect(json.epochId).toBe('2026-W46');
  });

  it('supports multiple concurrent delegatees in the same epoch and rejects forged grants and invalid inputs', () => {
    const pre = new VerifiableProxyDelegationRevoker();
    expect(() => pre.generateKeyPair('zero', 0n)).toThrow();
    const owner = pre.generateKeyPair('owner', 999111n);
    const d1 = pre.generateKeyPair('del-1', 222333n);
    const d2 = pre.generateKeyPair('del-2', 444555n);

    expect(() => pre.encryptForEpoch(owner.userId, owner.publicKey, 'ep-x', -1n)).toThrow();
    const ct = pre.encryptForEpoch(owner.userId, owner.publicKey, 'ep-x', 0n);
    expect(pre.decryptAsOwner(owner, ct)).toBe(0n);

    const g1 = pre.issueReEncryptionGrant('g-1', owner, d1, 'ep-x');
    const g2 = pre.issueReEncryptionGrant('g-2', owner, d2, 'ep-x');
    const cap1 = pre.proxyReEncrypt(g1, ct);
    const cap2 = pre.proxyReEncrypt(g2, ct);

    expect(pre.decryptAsDelegatee(d1, g1, cap1)).toBe(0n);
    expect(pre.decryptAsDelegatee(d2, g2, cap2)).toBe(0n);
    expect(pre.verifyGrant({ ...g1, ownerSigS: (g1.ownerSigS + 1n) % SUBGROUP_Q })).toBe(false);
    expect(pre.verifyGrant({ ...g1, reKeyScalar: (g1.reKeyScalar + 1n) % SUBGROUP_Q })).toBe(false);
  });
});
