import { describe, it, expect } from 'vitest';
import { VerifiableShuffleReencryptionProver } from '../../core/zkp/VerifiableShuffleReencryptionProver';

describe('VerifiableShuffleReencryptionProver', () => {
  const mix = new VerifiableShuffleReencryptionProver();

  it('shuffles and re-encrypts ElGamal ciphertexts while preserving the decrypted multiset', () => {
    const kp = mix.generateKeyPair();
    const plaintexts = [101n, 202n, 303n, 404n, 505n];
    const inputs = plaintexts.map((m) => mix.encrypt(kp.publicKey, m));

    const { proof } = mix.shuffleAndProve('mix-node-alpha', kp.publicKey, inputs);
    expect(mix.verifyShuffleProof(proof).valid).toBe(true);

    const decrypted = proof.outputCiphertexts.map((c) => mix.decrypt(kp.secretKey, c)).sort((a, b) => (a < b ? -1 : 1));
    expect(decrypted).toEqual(plaintexts);

    // Tampering with any output ciphertext must break product invariance
    const tampered = {
      ...proof,
      outputCiphertexts: [
        { ...proof.outputCiphertexts[0], c2: proof.outputCiphertexts[0].c2 + 1n },
        ...proof.outputCiphertexts.slice(1),
      ],
    };
    expect(mix.verifyShuffleProof(tampered).valid).toBe(false);
  });

  it('executes and verifies a multi-hop mixnet cascade and pinpoints faulty mix nodes', () => {
    const kp = mix.generateKeyPair();
    const plaintexts = [11n, 22n, 33n, 44n];
    const initial = plaintexts.map((m) => mix.encrypt(kp.publicKey, m));

    const cascade = mix.executeMixCascade('gov-mix-2026', kp.publicKey, initial, [
      'hop-1',
      'hop-2',
      'hop-3',
    ]);
    expect(cascade.nodeProofs).toHaveLength(3);
    expect(mix.verifyMixCascade(cascade).valid).toBe(true);

    const recovered = cascade.finalCiphertexts.map((c) => mix.decrypt(kp.secretKey, c)).sort((a, b) => (a < b ? -1 : 1));
    expect(recovered).toEqual(plaintexts);

    const broken = {
      ...cascade,
      nodeProofs: [
        cascade.nodeProofs[0],
        { ...cascade.nodeProofs[1], productResponseR: cascade.nodeProofs[1].productResponseR + 1n },
        cascade.nodeProofs[2],
      ],
    };
    const audit = mix.verifyMixCascade(broken);
    expect(audit.valid).toBe(false);
    expect(audit.faultyMixIds).toEqual(['gov-mix-2026:hop-2']);
  });

  it('rejects invalid permutations and round-trips JSON serialization', () => {
    const kp = mix.generateKeyPair();
    const inputs = [7n, 8n, 9n].map((m) => mix.encrypt(kp.publicKey, m));
    expect(() => mix.shuffleAndProve('bad-perm', kp.publicKey, inputs, [0, 0, 2])).toThrow();

    const { proof } = mix.shuffleAndProve('ser-node', kp.publicKey, inputs, [2, 0, 1]);
    const json = mix.serializeProof(proof);
    const restored = mix.deserializeProof(json);
    expect(restored).toEqual(proof);
    expect(mix.verifyShuffleProof(restored).valid).toBe(true);
  });
});
