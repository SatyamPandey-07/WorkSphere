import { describe, it, expect } from 'vitest';
import { VerifiableProxyReencryptionProver } from '../../core/zkp/VerifiableProxyReencryptionProver';

describe('VerifiableProxyReencryptionProver', () => {
  it('delegates ciphertexts from Alice to Bob via verifiable proxy re-encryption without revealing plaintext', () => {
    const pre = new VerifiableProxyReencryptionProver();
    const alice = pre.generateKeyPair('alice', 111222333n);
    const bob = pre.generateKeyPair('bob', 444555666n);

    const rkBundle = pre.generateReEncryptionKey('del-a-to-b', alice, bob);
    expect(pre.verifyReEncryptionKey(rkBundle)).toBe(true);

    const msg = pre.encodeMessage(7777n);
    const ctA = pre.encrypt('doc-001', alice, msg);
    expect(pre.decrypt(alice, ctA)).toBe(msg);

    const transformProof = pre.proxyReEncrypt(rkBundle, ctA);
    expect(pre.verifyProxyTransform(transformProof, alice.publicKey, bob.publicKey).valid).toBe(true);
    expect(pre.decrypt(bob, transformProof.transformedCiphertext)).toBe(msg);

    // Tampered proxy transform must fail DLEQ audit
    expect(
      pre.verifyProxyTransform(
        { ...transformProof, response: transformProof.response + 1n },
        alice.publicKey,
        bob.publicKey
      ).valid
    ).toBe(false);
  });

  it('enforces delegation revocation and batch-verifies multiple proxy transforms', () => {
    const pre = new VerifiableProxyReencryptionProver();
    const alice = pre.generateKeyPair('alice');
    const bob = pre.generateKeyPair('bob');
    const rk = pre.generateReEncryptionKey('del-rev', alice, bob);

    const p1 = pre.proxyReEncrypt(rk, pre.encrypt('d1', alice, pre.encodeMessage(10n)));
    const p2 = pre.proxyReEncrypt(rk, pre.encrypt('d2', alice, pre.encodeMessage(20n)));
    expect(pre.batchVerifyTransforms([p1, p2], alice.publicKey, bob.publicKey).allValid).toBe(true);

    const json = pre.serializeTransformProof(p1);
    const restored = pre.deserializeTransformProof(json);
    expect(restored).toEqual(p1);
    expect(pre.verifyProxyTransform(restored, alice.publicKey, bob.publicKey).valid).toBe(true);

    pre.revokeDelegation('del-rev');
    expect(pre.isDelegationRevoked('del-rev')).toBe(true);
    expect(pre.verifyReEncryptionKey(rk)).toBe(false);
    expect(pre.verifyProxyTransform(p1, alice.publicKey, bob.publicKey).valid).toBe(false);
    expect(() => pre.proxyReEncrypt(rk, pre.encrypt('d3', alice, pre.encodeMessage(30n)))).toThrow();
  });
});
