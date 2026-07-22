// Utility functions for converting between Base64, string, and Uint8Array
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class CryptoManager {
  /**
   * Derive a master AES-GCM CryptoKey using PBKDF2 from a password and salt.
   */
  static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password) as any,
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt as any,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Generates a new cryptographically secure salt.
   */
  static generateSalt(length = 16): Uint8Array {
    return window.crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Encrypt a Uint8Array payload using AES-GCM.
   * Returns base64 encoded strings for IV and Ciphertext.
   */
  static async encryptPayload(
    key: CryptoKey,
    payload: Uint8Array
  ): Promise<{ ciphertext: string; iv: string }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as any,
      },
      key,
      payload as any
    );

    return {
      ciphertext: bufferToBase64(encryptedBuffer),
      iv: bufferToBase64(iv),
    };
  }

  /**
   * Decrypt a base64 encoded AES-GCM ciphertext using the given IV.
   * Returns a Uint8Array payload.
   */
  static async decryptPayload(
    key: CryptoKey,
    ciphertextBase64: string,
    ivBase64: string
  ): Promise<Uint8Array> {
    const ciphertext = base64ToBuffer(ciphertextBase64);
    const iv = base64ToBuffer(ivBase64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as any,
      },
      key,
      ciphertext as any
    );

    return new Uint8Array(decryptedBuffer);
  }
}
