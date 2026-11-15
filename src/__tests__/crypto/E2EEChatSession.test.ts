import { E2EEChatSession } from '@/lib/crypto/E2EEChatSession';

describe('E2EEChatSession (ECDH P-256 & AES-GCM 256)', () => {
  it('should successfully establish shared secret and encrypt/decrypt messages between two peers', async () => {
    const aliceSession = new E2EEChatSession();
    const bobSession = new E2EEChatSession();

    // 1. Generate keypairs for Alice and Bob
    const alicePublicJwk = await aliceSession.generateLocalKeypair();
    const bobPublicJwk = await bobSession.generateLocalKeypair();

    // 2. Derive shared secrets reciprocally
    await aliceSession.deriveSharedSecret(bobPublicJwk);
    await bobSession.deriveSharedSecret(alicePublicJwk);

    // 3. Alice encrypts message for Bob
    const plaintext = 'Hello Bob, this is a secure nomad focus chat message!';
    const encrypted = await aliceSession.encryptMessage(plaintext);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();

    // 4. Bob decrypts Alice's message
    const decrypted = await bobSession.decryptMessage(encrypted.ciphertext, encrypted.iv);
    expect(decrypted).toBe(plaintext);
  });

  it('should use unique IV per message resulting in different ciphertexts for identical plaintexts', async () => {
    const aliceSession = new E2EEChatSession();
    const bobSession = new E2EEChatSession();

    const alicePublicJwk = await aliceSession.generateLocalKeypair();
    const bobPublicJwk = await bobSession.generateLocalKeypair();

    await aliceSession.deriveSharedSecret(bobPublicJwk);
    await bobSession.deriveSharedSecret(alicePublicJwk);

    const plaintext = 'Repeat secret message';
    const msg1 = await aliceSession.encryptMessage(plaintext);
    const msg2 = await aliceSession.encryptMessage(plaintext);

    // IVs must be unique
    expect(msg1.iv).not.toBe(msg2.iv);
    expect(msg1.ciphertext).not.toBe(msg2.ciphertext);

    // Both messages decrypt successfully
    expect(await bobSession.decryptMessage(msg1.ciphertext, msg1.iv)).toBe(plaintext);
    expect(await bobSession.decryptMessage(msg2.ciphertext, msg2.iv)).toBe(plaintext);
  });
});
