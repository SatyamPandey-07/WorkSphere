export interface EncryptedChunk {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

export interface EncryptedVaultPayload {
  salt: Uint8Array;
  chunks: EncryptedChunk[];
  originalName: string;
  originalSize: number;
  mimeType: string;
  checksum: string; // SHA-256 hex string
}

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

/**
 * Computes SHA-256 checksum of raw data buffer.
 */
export async function computeChecksum(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derives a 256-bit AES-GCM encryption key from master passphrase using PBKDF2.
 */
export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a File into chunked 1MB encrypted payloads with unique IVs.
 */
export async function encryptDocument(file: File, passphrase: string): Promise<EncryptedVaultPayload> {
  const arrayBuffer = await file.arrayBuffer();
  const checksum = await computeChecksum(arrayBuffer);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const chunks: EncryptedChunk[] = [];

  for (let offset = 0; offset < arrayBuffer.byteLength; offset += CHUNK_SIZE) {
    const chunkSlice = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      chunkSlice
    );

    chunks.push({ ciphertext, iv });
  }

  return {
    salt,
    chunks,
    originalName: file.name,
    originalSize: file.size,
    mimeType: file.type,
    checksum,
  };
}

/**
 * Decrypts encrypted vault payload and verifies byte-for-byte SHA-256 checksum.
 */
export async function decryptDocument(payload: EncryptedVaultPayload, passphrase: string): Promise<File> {
  const key = await deriveKeyFromPassphrase(passphrase, payload.salt);
  const decryptedChunks: ArrayBuffer[] = [];

  for (const chunk of payload.chunks) {
    const decryptedChunk = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: chunk.iv,
      },
      key,
      chunk.ciphertext
    );
    decryptedChunks.push(decryptedChunk);
  }

  // Combine chunks back into single ArrayBuffer
  const totalLength = decryptedChunks.reduce((acc, curr) => acc + curr.byteLength, 0);
  const combinedBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of decryptedChunks) {
    combinedBuffer.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  const decryptedChecksum = await computeChecksum(combinedBuffer.buffer);
  if (decryptedChecksum !== payload.checksum) {
    throw new Error('Security Error: Decrypted file checksum mismatch! File may be corrupted or passphrase incorrect.');
  }

  return new File([combinedBuffer], payload.originalName, { type: payload.mimeType });
}