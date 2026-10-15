/**
 * passkeyVaultPrf.ts
 * WebAuthn Pseudo-Random Function (PRF) extension implementation for biometric client-side vault encryption.
 * Evaluates PRF extension (extensions: { prf: { eval: { first: salt } } }) to deterministically derive
 * 256-bit AES-GCM symmetric keys using crypto.subtle.deriveKey for offline user notes and calendars.
 */

export const DEFAULT_VAULT_PRF_SALT = "WorkSphere-Passkey-Notes-PRF-Salt-v1";
export const VAULT_HKDF_INFO = "WorkSphere-Biometric-Vault-Encryption-v1";

export interface PrfExtensionEvalInput {
  first: Uint8Array;
  second?: Uint8Array;
}

export interface PrfAuthenticationExtensionInput {
  prf: {
    eval: PrfExtensionEvalInput;
  };
}

export interface PrfRegistrationExtensionInput {
  prf: Record<string, never>;
}

export interface PrfExtensionClientOutputs {
  enabled?: boolean;
  results?: {
    first?: ArrayBuffer;
    second?: ArrayBuffer;
  };
}

export interface EncryptedVaultPayload {
  ciphertext: string; // Base64
  iv: string; // Base64
  algorithm: "AES-GCM-256";
  keyDerivation: "WEBAUTHN-PRF";
}

/**
 * Normalizes or creates a 32-byte salt for WebAuthn PRF evaluation.
 */
export function createPrfSalt(salt?: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (salt instanceof Uint8Array) {
    if (salt.byteLength === 32) return salt;
    const buf = new Uint8Array(32);
    buf.set(salt.subarray(0, 32));
    return buf;
  }
  if (salt instanceof ArrayBuffer) {
    const view = new Uint8Array(salt);
    const buf = new Uint8Array(32);
    buf.set(view.subarray(0, 32));
    return buf;
  }
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(typeof salt === "string" ? salt : DEFAULT_VAULT_PRF_SALT);
  const buf = new Uint8Array(32);
  buf.set(rawBytes.subarray(0, 32));
  return buf;
}

/**
 * Builds the WebAuthn PRF registration extension input to request PRF capability.
 */
export function buildPrfRegistrationExtension(): PrfRegistrationExtensionInput {
  return {
    prf: {},
  };
}

/**
 * Builds the WebAuthn PRF authentication extension input with salt evaluation.
 */
export function buildPrfAuthenticationExtension(
  salt?: Uint8Array | ArrayBuffer | string,
  secondSalt?: Uint8Array | ArrayBuffer | string
): PrfAuthenticationExtensionInput {
  const first = createPrfSalt(salt);
  const evalInput: PrfExtensionEvalInput = { first };
  if (secondSalt) {
    evalInput.second = createPrfSalt(secondSalt);
  }
  return {
    prf: {
      eval: evalInput,
    },
  };
}

/**
 * Attaches the PRF extension input to PublicKeyCredentialCreationOptions for registration.
 */
export function attachPrfToRegistrationOptions(
  options: PublicKeyCredentialCreationOptions
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    extensions: {
      ...options.extensions,
      ...buildPrfRegistrationExtension(),
    },
  };
}

/**
 * Attaches the PRF extension input to PublicKeyCredentialRequestOptions for authentication.
 */
export function attachPrfToAuthenticationOptions(
  options: PublicKeyCredentialRequestOptions,
  salt?: Uint8Array | ArrayBuffer | string
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    extensions: {
      ...options.extensions,
      ...buildPrfAuthenticationExtension(salt),
    },
  };
}

/**
 * Extracts the PRF output ArrayBuffer from an authenticated PublicKeyCredential.
 */
export function extractPrfResultFromCredential(
  credential: PublicKeyCredential
): ArrayBuffer | null {
  if (typeof credential.getClientExtensionResults !== "function") return null;
  const extensions = credential.getClientExtensionResults() as {
    prf?: PrfExtensionClientOutputs;
  };
  return extensions.prf?.results?.first ?? null;
}

/**
 * Checks whether PRF extension was acknowledged as enabled in registration results.
 */
export function isPrfEnabledInRegistration(
  credential: PublicKeyCredential
): boolean {
  if (typeof credential.getClientExtensionResults !== "function") return false;
  const extensions = credential.getClientExtensionResults() as {
    prf?: PrfExtensionClientOutputs;
  };
  return Boolean(extensions.prf?.enabled);
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from raw PRF output using crypto.subtle.deriveKey.
 */
export async function deriveAesGcmKeyFromPrf(
  prfOutput: ArrayBuffer | Uint8Array,
  salt?: ArrayBuffer | Uint8Array | string,
  info: string = VAULT_HKDF_INFO
): Promise<CryptoKey> {
  const prfBytes = prfOutput instanceof Uint8Array ? prfOutput : new Uint8Array(prfOutput);
  if (prfBytes.byteLength < 16) {
    throw new Error("PRF output must be at least 16 bytes");
  }

  const saltBuffer = createPrfSalt(salt);
  const infoBuffer = new TextEncoder().encode(info);

  const subtle =
    typeof crypto !== "undefined" && crypto.subtle
      ? crypto.subtle
      : (globalThis as unknown as { crypto: { subtle: SubtleCrypto } }).crypto.subtle;

  if (!subtle) {
    throw new Error("crypto.subtle is not available in the current environment");
  }

  // Import raw PRF output bytes as HKDF key material
  const hkdfKey = await subtle.importKey(
    "raw",
    prfBytes,
    "HKDF",
    false,
    ["deriveKey"]
  );

  // Derive 256-bit AES-GCM symmetric key deterministically
  const aesGcmKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBuffer,
      info: infoBuffer,
    },
    hkdfKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );

  return aesGcmKey;
}

/**
 * Encrypts arbitrary string content (offline notes, credentials) using the derived 256-bit AES-GCM key.
 */
export async function encryptVaultNote(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedVaultPayload> {
  const subtle =
    typeof crypto !== "undefined" && crypto.subtle
      ? crypto.subtle
      : (globalThis as unknown as { crypto: { subtle: SubtleCrypto } }).crypto.subtle;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoded
  );

  return {
    ciphertext: Buffer.from(ciphertextBuffer).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    algorithm: "AES-GCM-256",
    keyDerivation: "WEBAUTHN-PRF",
  };
}

/**
 * Decrypts an EncryptedVaultPayload using the derived 256-bit AES-GCM key.
 */
export async function decryptVaultNote(
  payload: EncryptedVaultPayload,
  key: CryptoKey
): Promise<string> {
  const subtle =
    typeof crypto !== "undefined" && crypto.subtle
      ? crypto.subtle
      : (globalThis as unknown as { crypto: { subtle: SubtleCrypto } }).crypto.subtle;

  const iv = Buffer.from(payload.iv, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const decryptedBuffer = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(iv),
    },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Executes a passkey authentication flow with PRF extension and directly derives the vault CryptoKey.
 */
export async function evaluatePrfAndDeriveVaultKey(
  options: PublicKeyCredentialRequestOptions,
  salt?: Uint8Array | ArrayBuffer | string
): Promise<{ key: CryptoKey; credential: PublicKeyCredential; prfOutput: ArrayBuffer }> {
  if (typeof navigator === "undefined" || !navigator.credentials) {
    throw new Error("WebAuthn is not supported in this environment");
  }

  const optionsWithPrf = attachPrfToAuthenticationOptions(options, salt);
  const credential = (await navigator.credentials.get({
    publicKey: optionsWithPrf,
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error("Passkey ceremony was cancelled or returned empty credential");
  }

  const prfOutput = extractPrfResultFromCredential(credential);
  if (!prfOutput) {
    throw new Error("Authenticator does not support or returned no PRF extension results");
  }

  const key = await deriveAesGcmKeyFromPrf(prfOutput, salt);

  return {
    key,
    credential,
    prfOutput,
  };
}
