import { webcrypto } from 'crypto';

// Browser & Node.js isomorphic Web Crypto API compatibility
const subtle = (typeof window !== 'undefined' && window.crypto?.subtle) 
  ? window.crypto.subtle 
  : (webcrypto as unknown as Crypto).subtle;

const cryptoObj = (typeof window !== 'undefined' && window.crypto) 
  ? window.crypto 
  : webcrypto;

export class E2EEChatSession {
  private localKeyPair: CryptoKeyPair | null = null;
  private sharedKey: CryptoKey | null = null;

  /**
   * Generates an ephemeral ECDH P-256 keypair for the nomad chat session.
   */
  async generateLocalKeypair(): Promise<JsonWebKey> {
    this.localKeyPair = await subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    );

    // Export public key as JWK to share with peer participants
    return await subtle.exportKey('jwk', this.localKeyPair.publicKey);
  }

  /**
   * Derives a shared AES-GCM 256-bit session key using peer's public JWK.
   */
  async deriveSharedSecret(peerPublicJwk: JsonWebKey): Promise<void> {
    if (!this.localKeyPair) {
      throw new Error('Local keypair has not been generated yet.');
    }

    const peerPublicKey = await subtle.importKey(
      'jwk',
      peerPublicJwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      []
    );

    this.sharedKey = await subtle.deriveKey(
      {
        name: 'ECDH',
        public: peerPublicKey,
      },
      this.localKeyPair.privateKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts a plaintext message using AES-GCM 256-bit with a unique random IV per message.
   */
  async encryptMessage(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
    if (!this.sharedKey) {
      throw new Error('Shared session key has not been established.');
    }

    const iv = cryptoObj.getRandomValues(new Uint8Array(12)); // 12 bytes IV recommended for AES-GCM
    const encoded = new TextEncoder().encode(plaintext);

    const encryptedBuffer = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      this.sharedKey,
      encoded
    );

    return {
      ciphertext: Buffer.from(encryptedBuffer).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
    };
  }

  /**
   * Decrypts an encrypted message ciphertext using the shared AES-GCM session key and IV.
   */
  async decryptMessage(ciphertextBase64: string, ivBase64: string): Promise<string> {
    if (!this.sharedKey) {
      throw new Error('Shared session key has not been established.');
    }

    const iv = Buffer.from(ivBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');

    const decryptedBuffer = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      this.sharedKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBuffer);
  }
}

export default E2EEChatSession;
