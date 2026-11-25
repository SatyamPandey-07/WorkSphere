/**
 * clientEncryption.ts
 * Client-side Web Crypto AES-GCM 256-bit encryption utility for offline draft persistence.
 * Derives cryptographic keys via PBKDF2 from user session credentials.
 */

export interface EncryptedPayload {
  ciphertext: string; // Base64 encoded
  iv: string; // Base64 encoded (12 bytes)
  salt: string; // Base64 encoded (16 bytes)
  version?: number;
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

let activeSessionSecret: string | null = null;

/**
 * Configure the user session secret used for deriving offline storage encryption keys.
 */
export function setSessionEncryptionSecret(secret: string): void {
  activeSessionSecret = secret;
}

/**
 * Securely clears user session encryption keys from memory upon logout.
 */
export function clearSessionEncryptionKey(): void {
  activeSessionSecret = null;
}

/**
 * Gets the current active session secret, if configured.
 */
export function getSessionEncryptionSecret(): string | null {
  return activeSessionSecret;
}

/**
 * Derives an AES-GCM 256-bit CryptoKey using PBKDF2 with SHA-256 and 100,000 iterations.
 */
export async function deriveKey(
  secret: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export const DEFAULT_FALLBACK_SECRET = "WorkSphere-Offline-Draft-Default-Secret-2026";

/**
 * Encrypts an arbitrary object payload into AES-GCM 256-bit ciphertext.
 */
export async function encryptPayload<T = Record<string, unknown>>(
  data: T,
  customSecret?: string,
): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const secret = customSecret || activeSessionSecret || DEFAULT_FALLBACK_SECRET;
  const key = await deriveKey(secret, salt);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const jsonStr = JSON.stringify(data);
  const encoded = new TextEncoder().encode(jsonStr);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoded,
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
    version: 1,
  };
}

/**
 * Decrypts an AES-GCM 256-bit encrypted payload back into its original typed object.
 */
export async function decryptPayload<T = Record<string, unknown>>(
  encrypted: EncryptedPayload,
  customSecret?: string,
): Promise<T> {
  if (!encrypted || !encrypted.ciphertext || !encrypted.iv || !encrypted.salt) {
    throw new Error("Invalid encrypted payload structure");
  }

  try {
    const salt = base64ToArrayBuffer(encrypted.salt);
    const iv = base64ToArrayBuffer(encrypted.iv);
    const ciphertext = base64ToArrayBuffer(encrypted.ciphertext);

    const secret = customSecret || activeSessionSecret || DEFAULT_FALLBACK_SECRET;
    const key = await deriveKey(secret, salt);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
      },
      key,
      ciphertext as unknown as BufferSource,
    );

    const decodedStr = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decodedStr) as T;
  } catch (err: any) {
    throw new Error(
      `Failed to decrypt booking payload: ${err.message || "Corrupt ciphertext"}`,
    );
  }
}
