/**
 * src/lib/offline/deviceAttestation.ts
 *
 * Implements asymmetric WebCrypto ECDSA (P-256) device enrollment,
 * canonical check-in attestation signing, server-side signature verification,
 * and replay-resistant nonce consumption (#10165).
 */

export const ATTESTATION_PROTOCOL_VERSION = 2;
export const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

export interface CanonicalCheckinPayload {
  protocolVersion: number;
  userId: string;
  deviceId: string;
  venueId?: string;
  seatId: string;
  timestamp: number;
  clientNonce: string;
  idempotencyKey: string;
}

export interface DeviceRecord {
  deviceId: string;
  userId: string;
  publicKeySpkiHex: string;
  status: "active" | "revoked";
  registeredAt: number;
  revokedAt?: number;
}

export interface ConsumedNonceRecord {
  deviceId: string;
  nonce: string;
  idempotencyKey: string;
  payloadDigest: string;
  consumedAt: number;
}

// In-memory server/test registries (can be backed by DB/Prisma in persistent environments)
const registeredDevices = new Map<string, DeviceRecord>();
const consumedNonces = new Map<string, ConsumedNonceRecord>();

/**
 * Builds the canonical deterministic string representation of a check-in payload.
 * Canonical representation ensures seat, venue, timestamp, user, or device modification
 * invalidates the signature.
 */
export function buildCanonicalCheckinString(payload: CanonicalCheckinPayload): string {
  return [
    `v=${payload.protocolVersion}`,
    `uid=${payload.userId}`,
    `dev=${payload.deviceId}`,
    `ven=${payload.venueId ?? ""}`,
    `seat=${payload.seatId}`,
    `ts=${payload.timestamp}`,
    `nonce=${payload.clientNonce}`,
    `ik=${payload.idempotencyKey}`,
  ].join("|");
}

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex: string): ArrayBuffer {
  const match = hex.match(/.{1,2}/g) || [];
  const bytes = new Uint8Array(match.map((byte) => parseInt(byte, 16)));
  return bytes.buffer;
}

function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("crypto");
  if (nodeCrypto?.webcrypto?.subtle) {
    return nodeCrypto.webcrypto.subtle;
  }
  throw new Error("WebCrypto SubtleCrypto is not available in this environment.");
}

/**
 * Generates an ECDSA P-256 asymmetric key pair for the device.
 * Private key is non-extractable where supported.
 */
export async function generateDeviceKeyPair(extractable = false): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeySpkiHex: string;
}> {
  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    extractable,
    ["sign", "verify"],
  );

  const spkiBuffer = await subtle.exportKey("spki", keyPair.publicKey);
  const publicKeySpkiHex = bufferToHex(spkiBuffer);

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeySpkiHex,
  };
}

/**
 * Signs the canonical check-in payload using the device's private key.
 */
export async function signCheckinAttestation(
  payload: CanonicalCheckinPayload,
  privateKey: CryptoKey,
): Promise<string> {
  const subtle = getSubtleCrypto();
  const canonicalString = buildCanonicalCheckinString(payload);
  const data = new TextEncoder().encode(canonicalString);

  const signatureBuffer = await subtle.sign(
    {
      name: "ECDSA",
      hash: { name: "SHA-256" },
    },
    privateKey,
    data,
  );

  return bufferToHex(signatureBuffer);
}

/**
 * Verifies a signature against a canonical check-in string and the public key SPKI hex.
 */
export async function verifyCheckinSignature(
  canonicalString: string,
  signatureHex: string,
  publicKeySpkiHex: string,
): Promise<boolean> {
  try {
    const subtle = getSubtleCrypto();
    const spkiBuffer = hexToBuffer(publicKeySpkiHex);
    const signatureBuffer = hexToBuffer(signatureHex);
    const data = new TextEncoder().encode(canonicalString);

    const publicKey = await subtle.importKey(
      "spki",
      spkiBuffer,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["verify"],
    );

    return await subtle.verify(
      {
        name: "ECDSA",
        hash: { name: "SHA-256" },
      },
      publicKey,
      signatureBuffer,
      data,
    );
  } catch {
    return false;
  }
}

// Client-side in-memory cache for device key (avoids re-generating across queue items in session)
let activeClientDeviceKey: {
  deviceId: string;
  privateKey: CryptoKey;
  publicKeySpkiHex: string;
} | null = null;

export async function getOrCreateClientDeviceKey(
  deviceId: string = "device_default",
): Promise<{
  deviceId: string;
  privateKey: CryptoKey;
  publicKeySpkiHex: string;
}> {
  if (activeClientDeviceKey && activeClientDeviceKey.deviceId === deviceId) {
    return activeClientDeviceKey;
  }
  const keyPair = await generateDeviceKeyPair(false);
  activeClientDeviceKey = {
    deviceId,
    privateKey: keyPair.privateKey,
    publicKeySpkiHex: keyPair.publicKeySpkiHex,
  };
  return activeClientDeviceKey;
}

export function resetClientDeviceKey(): void {
  activeClientDeviceKey = null;
}

/**
 * Registers a device credential with the server.
 */
export function registerDeviceCredential(
  deviceId: string,
  userId: string,
  publicKeySpkiHex: string,
): DeviceRecord {
  const record: DeviceRecord = {
    deviceId,
    userId,
    publicKeySpkiHex,
    status: "active",
    registeredAt: Date.now(),
  };
  registeredDevices.set(deviceId, record);
  return record;
}

/**
 * Revokes an enrolled device credential.
 */
export function revokeDeviceCredential(deviceId: string): boolean {
  const device = registeredDevices.get(deviceId);
  if (!device) return false;
  device.status = "revoked";
  device.revokedAt = Date.now();
  return true;
}

/**
 * Retrieves a registered device credential.
 */
export function getDeviceCredential(deviceId: string): DeviceRecord | undefined {
  return registeredDevices.get(deviceId);
}

/**
 * Clears in-memory device registrations and nonces (used in tests).
 */
export function clearAttestationRegistries(): void {
  registeredDevices.clear(consumedNonces.clear(), consumedNonces.clear());
  consumedNonces.clear();
}

export interface VerificationResult {
  valid: boolean;
  status: number;
  error?: string;
  code?: string;
  idempotent?: boolean;
}

/**
 * Server-side verification and atomic consumption of an offline check-in attestation.
 */
export async function verifyAndConsumeAttestation(
  payload: CanonicalCheckinPayload,
  signatureHex: string,
  authenticatedUserId?: string,
  nowMs: number = Date.now(),
): Promise<VerificationResult> {
  // 1. Check protocol version
  if (!payload.protocolVersion || payload.protocolVersion < 2) {
    return {
      valid: false,
      status: 400,
      code: "UNSUPPORTED_PROTOCOL_VERSION",
      error: "Attestation protocol version 2 or higher required.",
    };
  }

  // 2. Bound authenticated user identity if available
  if (authenticatedUserId && payload.userId !== authenticatedUserId) {
    return {
      valid: false,
      status: 403,
      code: "USER_MISMATCH",
      error: "Check-in payload userId does not match authenticated session.",
    };
  }

  // 3. Time validity: clock-skew and maximum offline age
  if (payload.timestamp > nowMs + MAX_CLOCK_SKEW_MS) {
    return {
      valid: false,
      status: 400,
      code: "TIMESTAMP_IN_FUTURE",
      error: "Check-in timestamp is excessively in the future.",
    };
  }
  if (nowMs - payload.timestamp > MAX_OFFLINE_AGE_MS) {
    return {
      valid: false,
      status: 400,
      code: "TIMESTAMP_EXPIRED",
      error: "Check-in timestamp exceeds maximum allowed offline age (7 days).",
    };
  }

  // 4. Device Registration & Revocation
  const device = registeredDevices.get(payload.deviceId);
  if (!device) {
    return {
      valid: false,
      status: 404,
      code: "DEVICE_NOT_FOUND",
      error: "Device credential not registered.",
    };
  }
  if (device.status === "revoked") {
    return {
      valid: false,
      status: 403,
      code: "DEVICE_REVOKED",
      error: "Device credential has been revoked.",
    };
  }
  if (device.userId !== payload.userId) {
    return {
      valid: false,
      status: 403,
      code: "DEVICE_USER_MISMATCH",
      error: "Device is not associated with this user.",
    };
  }

  // 5. Cryptographic signature check
  const canonicalString = buildCanonicalCheckinString(payload);
  const isValidSig = await verifyCheckinSignature(
    canonicalString,
    signatureHex,
    device.publicKeySpkiHex,
  );
  if (!isValidSig) {
    return {
      valid: false,
      status: 400,
      code: "INVALID_SIGNATURE",
      error: "Cryptographic attestation signature verification failed.",
    };
  }

  // 6. Replay protection & atomic nonce consumption
  const nonceKey = `${payload.deviceId}:${payload.clientNonce}`;
  const existingNonce = consumedNonces.get(nonceKey);

  if (existingNonce) {
    // If exact same idempotencyKey and canonicalString digest -> idempotent retry
    if (
      existingNonce.idempotencyKey === payload.idempotencyKey &&
      existingNonce.payloadDigest === canonicalString
    ) {
      return {
        valid: true,
        status: 200,
        idempotent: true,
      };
    }
    // Replay attack with same nonce on different operation or seat
    return {
      valid: false,
      status: 409,
      code: "NONCE_REPLAYED",
      error: "Nonce has already been consumed for another operation.",
    };
  }

  // Atomically consume nonce
  consumedNonces.set(nonceKey, {
    deviceId: payload.deviceId,
    nonce: payload.clientNonce,
    idempotencyKey: payload.idempotencyKey,
    payloadDigest: canonicalString,
    consumedAt: nowMs,
  });

  return {
    valid: true,
    status: 200,
    idempotent: false,
  };
}
