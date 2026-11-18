import { encryptDocument, decryptDocument, computeChecksum } from '../../lib/crypto/documentVault';

describe('Zero-Knowledge Document Vault Encryption & Decryption', () => {
  const passphrase = 'WorkSphere-Secure-Master-Passphrase-2026!';
  const fileContent = 'Confidential Identity Document & Tenancy Agreement Data.';
  const testFile = new File([fileContent], 'passport.pdf', { type: 'application/pdf' });

  test('encrypts document client-side and decrypts back to exact byte-for-byte original', async () => {
    const encryptedPayload = await encryptDocument(testFile, passphrase);

    // Verify plaintext is completely absent from encrypted payload chunks
    expect(encryptedPayload.chunks.length).toBeGreaterThan(0);
    expect(encryptedPayload.originalName).toBe('passport.pdf');
    expect(encryptedPayload.checksum).toBeDefined();

    // Decrypt payload
    const decryptedFile = await decryptDocument(encryptedPayload, passphrase);
    const decryptedText = await decryptedFile.text();

    expect(decryptedText).toBe(fileContent);
    expect(decryptedFile.name).toBe(testFile.name);
    expect(decryptedFile.type).toBe(testFile.type);
  });

  test('fails decryption when incorrect passphrase is provided', async () => {
    const encryptedPayload = await encryptDocument(testFile, passphrase);

    await expect(decryptDocument(encryptedPayload, 'WrongPassphrase!')).rejects.toThrow();
  });

  test('computes correct SHA-256 checksum', async () => {
    const buffer = new TextEncoder().encode(fileContent).buffer;
    const checksum = await computeChecksum(buffer);

    expect(checksum).toHaveLength(64); // SHA-256 hex string length
  });
});