import crypto from "crypto";

export interface EncryptedNotePayload {
  ciphertext: string; // Base64 encoded ciphertext
  iv: string; // Base64 encoded 96-bit IV
  authTag: string; // Base64 encoded 128-bit authentication tag
  algorithm: "AES-GCM-256";
  keyDerivation: "WEBAUTHN-PRF" | "PBKDF2-FALLBACK";
  salt: string; // Base64 encoded salt used for HKDF / PBKDF2
}

export interface PrfVaultKeys {
  encryptionKey: Buffer;
  keyDerivation: "WEBAUTHN-PRF" | "PBKDF2-FALLBACK";
}

const HKDF_INFO_PREFIX = "WorkSphere-Notes-Encryption-Key";
const PBKDF2_ITERATIONS = 100_000;

/**
 * Derives a 256-bit AES-GCM key from the hardware-isolated WebAuthn PRF output using HKDF-SHA256.
 *
 * @param prfOutput The raw bytes returned by authenticator PRF extension (e.g. 32 bytes)
 * @param salt Optional domain/user salt (defaults to 32 random bytes or provided buffer)
 * @returns 32-byte encryption key buffer and the salt used
 */
export function deriveKeyFromPrf(
  prfOutput: Buffer | Uint8Array,
  salt?: Buffer | Uint8Array,
): { key: Buffer; salt: Buffer } {
  const ikm = Buffer.from(prfOutput);
  if (ikm.length < 16) {
    throw new Error("PRF output must be at least 16 bytes");
  }

  const saltBuffer = salt ? Buffer.from(salt) : crypto.randomBytes(32);
  const infoBuffer = Buffer.from(HKDF_INFO_PREFIX, "utf-8");

  // HKDF-SHA256: Extract then Expand to 32 bytes (256 bits)
  const key = crypto.hkdfSync("sha256", ikm, saltBuffer, infoBuffer, 32);

  return {
    key: Buffer.from(key),
    salt: saltBuffer,
  };
}

/**
 * Fallback key derivation using PBKDF2-SHA256 for authenticators lacking PRF support.
 *
 * @param passphrase User provided password or passphrase
 * @param salt Optional salt (defaults to 32 random bytes)
 * @returns 32-byte encryption key buffer and the salt used
 */
export function deriveKeyFromPassphrase(
  passphrase: string,
  salt?: Buffer | Uint8Array,
): { key: Buffer; salt: Buffer } {
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Passphrase must be at least 6 characters for vault fallback encryption");
  }

  const saltBuffer = salt ? Buffer.from(salt) : crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(
    passphrase,
    saltBuffer,
    PBKDF2_ITERATIONS,
    32,
    "sha256",
  );

  return {
    key,
    salt: saltBuffer,
  };
}

/**
 * Encrypts private note plaintext with 256-bit AES-GCM and a unique 96-bit IV.
 *
 * @param plaintext Note string (e.g., WiFi passwords, door codes)
 * @param key 256-bit (32 bytes) AES symmetric key
 * @param salt Salt buffer used in key derivation
 * @param keyDerivation Derivation method marker ("WEBAUTHN-PRF" | "PBKDF2-FALLBACK")
 * @returns Serialized EncryptedNotePayload
 */
export function encryptNote(
  plaintext: string,
  key: Buffer,
  salt: Buffer,
  keyDerivation: "WEBAUTHN-PRF" | "PBKDF2-FALLBACK" = "WEBAUTHN-PRF",
): EncryptedNotePayload {
  if (key.length !== 32) {
    throw new Error("AES-GCM-256 requires a 32-byte key");
  }

  // Generate unique 96-bit (12-byte) Initialization Vector
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertextBuffer = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertextBuffer.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    algorithm: "AES-GCM-256",
    keyDerivation,
    salt: salt.toString("base64"),
  };
}

/**
 * Decrypts an EncryptedNotePayload with 256-bit AES-GCM.
 * Validates authentication tag and detects tampering.
 *
 * @param payload EncryptedNotePayload containing ciphertext, iv, authTag
 * @param key 256-bit AES symmetric key
 * @returns Decrypted plaintext string
 */
export function decryptNote(payload: EncryptedNotePayload, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("AES-GCM-256 requires a 32-byte key");
  }

  if (payload.algorithm !== "AES-GCM-256") {
    throw new Error(`Unsupported encryption algorithm: ${payload.algorithm}`);
  }

  const iv = Buffer.from(payload.iv, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");

  if (iv.length !== 12) {
    throw new Error("Invalid IV length for AES-GCM (must be 12 bytes)");
  }

  if (authTag.length !== 16) {
    throw new Error("Invalid AuthTag length for AES-GCM (must be 16 bytes)");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decryptedBuffer = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decryptedBuffer.toString("utf-8");
  } catch (err) {
    throw new Error(
      `Decryption failed or auth tag mismatch (tamper detected): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Checks whether an incoming string is a serialized EncryptedNotePayload JSON string.
 */
export function isEncryptedNotePayload(data: unknown): data is EncryptedNotePayload {
  if (!data || typeof data !== "object") return false;
  const p = data as Partial<EncryptedNotePayload>;
  return (
    typeof p.ciphertext === "string" &&
    typeof p.iv === "string" &&
    typeof p.authTag === "string" &&
    p.algorithm === "AES-GCM-256" &&
    (p.keyDerivation === "WEBAUTHN-PRF" || p.keyDerivation === "PBKDF2-FALLBACK") &&
    typeof p.salt === "string"
  );
}

/**
 * Parses and validates an encrypted note JSON string or object.
 */
export function parseEncryptedNote(noteStringOrObj: string | object): EncryptedNotePayload | null {
  try {
    const obj =
      typeof noteStringOrObj === "string"
        ? JSON.parse(noteStringOrObj)
        : noteStringOrObj;
    if (isEncryptedNotePayload(obj)) {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}
