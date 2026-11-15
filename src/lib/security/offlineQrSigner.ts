/**
 * Offline passcard signer (#7271).
 *
 * In a basement or a shielded coworking space there is no cellular signal, so a passcard that needs the
 * network to load is useless at the door. This module turns the few facts a door scanner needs into one
 * compact token that is signed with ECDSA (P-256, SHA-256) through the Web Crypto API and can be drawn
 * as a QR code. A scanner that holds the venue's public verification key can check it with no network.
 *
 *   token = base64url(payload) + "." + base64url(signature)
 *
 * The payload is a fixed-order JSON array, not an object, so the same facts always produce the same bytes
 * and the QR stays small:
 *
 *   [1, bookingId, userId, venueId, validFrom, validUntil, seatNumber]
 *
 * `validFrom` and `validUntil` are Unix seconds. The signature is the 64-byte raw (IEEE P1363) form that
 * Web Crypto produces, not DER. The signature is checked against the exact payload bytes carried in the
 * token, never against a re-serialised copy, so there is nothing to canonicalise on the verifying side.
 *
 * Key handling: the signing key belongs to whoever issues passcards (a server). Only the public
 * verification key is ever given to scanners or to the browser. `importVerificationKey` refuses a JWK that
 * carries private material.
 */

import {
  base64UrlToUint8Array,
  stringToUint8Array,
  uint8ArrayToBase64Url,
  uint8ArrayToString,
} from "@/lib/crypto/encoding";

export interface OfflinePasscardPayload {
  bookingId: string;
  userId: string;
  venueId: string;
  /** Unix seconds: the passcard is not valid before this moment. */
  validFrom: number;
  /** Unix seconds: the passcard is not valid after this moment. */
  validUntil: number;
  seatNumber: string;
}

export type OfflinePasscardFailure =
  "malformed" | "bad-signature" | "not-yet-valid" | "expired";

export type OfflinePasscardVerification =
  | { valid: true; payload: OfflinePasscardPayload }
  | {
      valid: false;
      reason: OfflinePasscardFailure;
      /** Present only when the signature was good, so the facts can be trusted (for example to show why it was refused). */
      payload?: OfflinePasscardPayload;
    };

export interface VerifyOfflinePasscardOptions {
  /** The moment to check the validity window against. Default: now. */
  now?: Date | number;
  /** Set to false to check the signature only. Default: true. */
  enforceWindow?: boolean;
}

export const OFFLINE_PASSCARD_VERSION = 1;
/** A raw P-256 ECDSA signature is r and s, 32 bytes each. */
export const SIGNATURE_BYTES = 64;
/** Longest accepted text field, which keeps the token (and the QR) small. */
export const MAX_FIELD_LENGTH = 128;

const ECDSA_KEY_PARAMS = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) {
    throw new Error("Web Crypto is not available in this environment");
  }
  return api;
}

/** Web Crypto wants an ArrayBuffer-backed view; this copies into one. */
function bytesOf(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data);
}

// -- payload ------------------------------------------------------------------------------------

function isText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_FIELD_LENGTH
  );
}

function isSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Throws a descriptive error when the payload could not be signed as a valid passcard. */
export function assertValidPayload(payload: OfflinePasscardPayload): void {
  for (const field of [
    "bookingId",
    "userId",
    "venueId",
    "seatNumber",
  ] as const) {
    if (!isText(payload[field])) {
      throw new Error(
        `${field} must be a non-empty string of at most ${MAX_FIELD_LENGTH} characters`,
      );
    }
  }
  for (const field of ["validFrom", "validUntil"] as const) {
    if (!isSeconds(payload[field])) {
      throw new Error(`${field} must be a whole number of Unix seconds`);
    }
  }
  if (payload.validUntil <= payload.validFrom) {
    throw new Error("validUntil must be later than validFrom");
  }
}

function serializePayload(payload: OfflinePasscardPayload): string {
  return JSON.stringify([
    OFFLINE_PASSCARD_VERSION,
    payload.bookingId,
    payload.userId,
    payload.venueId,
    payload.validFrom,
    payload.validUntil,
    payload.seatNumber,
  ]);
}

function parsePayload(json: string): OfflinePasscardPayload | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    !Array.isArray(data) ||
    data.length !== 7 ||
    data[0] !== OFFLINE_PASSCARD_VERSION
  )
    return null;
  const [, bookingId, userId, venueId, validFrom, validUntil, seatNumber] =
    data;
  const payload = {
    bookingId,
    userId,
    venueId,
    validFrom,
    validUntil,
    seatNumber,
  } as OfflinePasscardPayload;
  try {
    assertValidPayload(payload);
  } catch {
    return null;
  }
  return payload;
}

// -- token --------------------------------------------------------------------------------------

function splitToken(
  token: string,
): { payloadBytes: Uint8Array; signature: Uint8Array } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !BASE64URL.test(parts[0]) ||
    !BASE64URL.test(parts[1])
  )
    return null;
  try {
    const payloadBytes = base64UrlToUint8Array(parts[0]);
    const signature = base64UrlToUint8Array(parts[1]);
    if (signature.length !== SIGNATURE_BYTES) return null;
    return { payloadBytes, signature };
  } catch {
    return null;
  }
}

/**
 * Reads the facts out of a token WITHOUT checking the signature. Use it to show or index a token you will
 * verify separately; never to decide whether a passcard is genuine. Returns null for a malformed token.
 */
export function decodeOfflinePasscardPayload(
  token: string,
): OfflinePasscardPayload | null {
  const parts = splitToken(token);
  return parts ? parsePayload(uint8ArrayToString(parts.payloadBytes)) : null;
}

/** Signs the payload and returns the Base64URL token to draw as a QR code. Throws on an invalid payload. */
export async function signOfflinePasscard(
  payload: OfflinePasscardPayload,
  signingKey: CryptoKey,
): Promise<string> {
  assertValidPayload(payload);
  const payloadBytes = stringToUint8Array(serializePayload(payload));
  const signature = new Uint8Array(
    await subtle().sign(ECDSA_SIGN_PARAMS, signingKey, bytesOf(payloadBytes)),
  );
  return `${uint8ArrayToBase64Url(payloadBytes)}.${uint8ArrayToBase64Url(signature)}`;
}

/**
 * Checks a token against the venue's public verification key, with no network. The signature is checked
 * first; only then is the validity window looked at, so a "not-yet-valid" or "expired" result still means
 * the token is genuine.
 */
export async function verifyOfflinePasscard(
  token: string,
  verificationKey: CryptoKey,
  options: VerifyOfflinePasscardOptions = {},
): Promise<OfflinePasscardVerification> {
  const parts = splitToken(token);
  if (!parts) return { valid: false, reason: "malformed" };

  let genuine = false;
  try {
    genuine = await subtle().verify(
      ECDSA_SIGN_PARAMS,
      verificationKey,
      bytesOf(parts.signature),
      bytesOf(parts.payloadBytes),
    );
  } catch {
    genuine = false;
  }
  if (!genuine) return { valid: false, reason: "bad-signature" };

  const payload = parsePayload(uint8ArrayToString(parts.payloadBytes));
  if (!payload) return { valid: false, reason: "malformed" };

  if (options.enforceWindow !== false) {
    const nowMs =
      options.now instanceof Date
        ? options.now.getTime()
        : (options.now ?? Date.now());
    if (nowMs < payload.validFrom * 1000)
      return { valid: false, reason: "not-yet-valid", payload };
    if (nowMs > payload.validUntil * 1000)
      return { valid: false, reason: "expired", payload };
  }
  return { valid: true, payload };
}

// -- keys ---------------------------------------------------------------------------------------

/** A fresh P-256 key pair. The issuer keeps the private key; the public half goes to scanners. */
export async function generateOfflinePasscardKeyPair(): Promise<CryptoKeyPair> {
  return subtle().generateKey(ECDSA_KEY_PARAMS, true, ["sign", "verify"]);
}

/** The public verification key as a JWK, ready to ship to scanners or to the browser. */
export async function exportVerificationKeyJwk(
  publicKey: CryptoKey,
): Promise<JsonWebKey> {
  return subtle().exportKey("jwk", publicKey);
}

/** Imports a public verification key. Refuses anything that carries private key material. */
export async function importVerificationKey(
  jwk: JsonWebKey,
): Promise<CryptoKey> {
  if (jwk.d !== undefined) {
    throw new Error("A verification key must not contain private key material");
  }
  return subtle().importKey("jwk", jwk, ECDSA_KEY_PARAMS, true, ["verify"]);
}

/** Imports a private signing key (server side only). */
export async function importSigningKey(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.d === undefined) {
    throw new Error("A signing key must contain the private key (d)");
  }
  return subtle().importKey("jwk", jwk, ECDSA_KEY_PARAMS, false, ["sign"]);
}
