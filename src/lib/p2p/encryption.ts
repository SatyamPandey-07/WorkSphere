/**
 * End-to-End Encryption Module for P2P File Sharing
 *
 * Uses Web Crypto API with AES-GCM 256-bit keys for authenticated encryption.
 * Keys are derived via ECDH P-256 key exchange through PartyKit signaling.
 */

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface EncryptedChunk {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  index: number;
}

const CHUNK_SIZE = 16384; // 16KB

/**
 * Generate an ECDH P-256 key pair for key exchange.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey", "deriveBits"],
  );
  return keyPair;
}

/**
 * Export public key to raw bytes for signaling.
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

/**
 * Import a peer's public key from raw bytes.
 */
export async function importPublicKey(rawBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

/**
 * Derive a shared AES-GCM 256-bit key from ECDH key exchange.
 */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: peerPublicKey,
    },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a single chunk with AES-GCM 256-bit.
 */
export async function encryptChunk(
  data: Uint8Array,
  key: CryptoKey,
  index: number,
): Promise<EncryptedChunk> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    data,
  );

  return {
    iv,
    ciphertext: new Uint8Array(ciphertext),
    index,
  };
}

/**
 * Decrypt a single chunk with AES-GCM 256-bit.
 */
export async function decryptChunk(
  encrypted: EncryptedChunk,
  key: CryptoKey,
): Promise<Uint8Array> {
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encrypted.iv, tagLength: 128 },
    key,
    encrypted.ciphertext,
  );
  return new Uint8Array(plainBuffer);
}

/**
 * Compute SHA-256 checksum of a file for integrity verification.
 */
export async function computeSHA256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Split a file into encrypted chunks.
 */
export async function encryptFile(
  file: File,
  key: CryptoKey,
): Promise<{ chunks: EncryptedChunk[]; checksum: string; totalChunks: number }> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const checksum = await computeSHA256(data);
  const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
  const chunks: EncryptedChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, data.length);
    const chunk = data.slice(start, end);
    const encrypted = await encryptChunk(chunk, key, i);
    chunks.push(encrypted);
  }

  return { chunks, checksum, totalChunks };
}

/**
 * Reassemble decrypted chunks into a complete file.
 */
export async function decryptFile(
  chunks: EncryptedChunk[],
  key: CryptoKey,
  expectedChecksum: string,
  mimeType: string,
): Promise<File> {
  const decryptedChunks: Uint8Array[] = [];

  for (const chunk of chunks) {
    const decrypted = await decryptChunk(chunk, key);
    decryptedChunks.push(decrypted);
  }

  const totalLength = decryptedChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of decryptedChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  const actualChecksum = await computeSHA256(result);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
    );
  }

  return new File([result], `received-${Date.now()}`, { type: mimeType });
}

export { CHUNK_SIZE };
