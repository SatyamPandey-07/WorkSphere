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
  /**
   * How many seconds the verifier's clock may be off. The validity window is widened by this much on
   * both sides. Default: 0. Capped at `MAX_CLOCK_SKEW_SECONDS`, because the tolerance also lengthens the
   * time a copied passcard can be replayed; a negative or non-finite value counts as 0.
   */
  clockSkewSeconds?: number;
}

export const OFFLINE_PASSCARD_VERSION = 1;
/** A raw P-256 ECDSA signature is r and s, 32 bytes each. */
export const SIGNATURE_BYTES = 64;
/** Largest clock skew tolerance a verifier may ask for (5 minutes). */
export const MAX_CLOCK_SKEW_SECONDS = 300;
/** How many verification keys are tried for one token; matches the retained public key limit. */
export const MAX_VERIFICATION_KEYS = 10;
/** Longest accepted text field, which keeps the token (and the QR) small. */
export const MAX_FIELD_LENGTH = 128;
/** Default maximum number of verified passcards retained in the LRU signature cache. */
export const DEFAULT_VERIFICATION_CACHE_CAPACITY = 1000;

const ECDSA_KEY_PARAMS = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// -- LRU Signature Verification Cache (#8907) ----------------------------------------------------

/**
 * WeakMap assigning an opaque monotonic numeric ID to each CryptoKey reference.
 * Used to securely isolate cache entries across different public verification keys
 * without retaining key references in cache entry strings or leaking key structures.
 */
const keyIdMap = new WeakMap<CryptoKey, number>();
let nextKeyId = 1;

function getVerificationKeyId(key: CryptoKey): number {
  let id = keyIdMap.get(key);
  if (!id) {
    id = nextKeyId++;
    keyIdMap.set(key, id);
  }
  return id;
}

/**
 * Computes a deterministic SHA-256 hash of the exact token string bytes and combines
 * it with the verification key identifier to form a secure, collision-resistant cache key.
 */
async function computeVerificationCacheKey(
  token: string,
  key: CryptoKey,
): Promise<string> {
  const tokenBytes = stringToUint8Array(token);
  const digestBuffer = await subtle().digest("SHA-256", bytesOf(tokenBytes));
  const digestBytes = new Uint8Array(digestBuffer);
  let hexDigest = "";
  for (let i = 0; i < digestBytes.length; i++) {
    hexDigest += digestBytes[i].toString(16).padStart(2, "0");
  }
  const keyId = getVerificationKeyId(key);
  return `${keyId}:${hexDigest}`;
}

let verificationCacheCapacity = DEFAULT_VERIFICATION_CACHE_CAPACITY;
/** Bounded LRU cache of cryptographically verified passcard payloads. */
const verificationCache = new Map<string, OfflinePasscardPayload>();
/** In-flight single-flight map to deduplicate concurrent verification calls for the same key. */
const inFlightVerifications = new Map<string, Promise<boolean>>();

/**
 * Adjusts the LRU signature verification cache capacity.
 * Trims existing entries if the new capacity is smaller than current cache size.
 */
export function setVerificationCacheCapacity(capacity: number): void {
  const normalized = Math.floor(capacity);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new RangeError(
      "Verification cache capacity must be a positive integer",
    );
  }
  verificationCacheCapacity = normalized;
  while (verificationCache.size > verificationCacheCapacity) {
    const oldestKey = verificationCache.keys().next().value;
    if (oldestKey !== undefined) {
      verificationCache.delete(oldestKey);
    } else {
      break;
    }
  }
}

/** Returns the current capacity limit of the verification cache. */
export function getVerificationCacheCapacity(): number {
  return verificationCacheCapacity;
}

/** Returns the current number of cached verified passcard signatures. */
export function getVerificationCacheSize(): number {
  return verificationCache.size;
}

/**
 * Clears the verification LRU cache and aborts/clears in-flight single-flight promises.
 * Primarily used for cache invalidation, key rotation, and isolated testing.
 */
export function clearVerificationCache(): void {
  verificationCache.clear();
  inFlightVerifications.clear();
}

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

function clockSkewMs(seconds: number | undefined): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return 0;
  return Math.min(seconds, MAX_CLOCK_SKEW_SECONDS) * 1000;
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

  const cacheKey = await computeVerificationCacheKey(token, verificationKey);

  // 1. Check LRU Verification Cache (fast path)
  const cachedPayload = verificationCache.get(cacheKey);
  let payload: OfflinePasscardPayload;

  if (cachedPayload !== undefined) {
    // Refresh LRU recency
    verificationCache.delete(cacheKey);
    verificationCache.set(cacheKey, cachedPayload);
    payload = cachedPayload;
  } else {
    // 2. Single-flight deduplication for concurrent verifications
    let inFlight = inFlightVerifications.get(cacheKey);
    if (!inFlight) {
      inFlight = (async () => {
        try {
          return await subtle().verify(
            ECDSA_SIGN_PARAMS,
            verificationKey,
            bytesOf(parts.signature),
            bytesOf(parts.payloadBytes),
          );
        } catch {
          return false;
        }
      })();
      inFlightVerifications.set(cacheKey, inFlight);
    }

    let genuine = false;
    try {
      genuine = await inFlight;
    } finally {
      // Ensure in-flight map is always cleared upon promise settlement
      inFlightVerifications.delete(cacheKey);
    }

    if (!genuine) return { valid: false, reason: "bad-signature" };

    const parsed = parsePayload(uint8ArrayToString(parts.payloadBytes));
    if (!parsed) return { valid: false, reason: "malformed" };
    payload = parsed;

    // Insert into LRU verification cache only on success
    if (verificationCache.has(cacheKey)) {
      verificationCache.delete(cacheKey);
    } else if (verificationCache.size >= verificationCacheCapacity) {
      const oldestKey = verificationCache.keys().next().value;
      if (oldestKey !== undefined) {
        verificationCache.delete(oldestKey);
      }
    }
    verificationCache.set(cacheKey, payload);
  }

  // 3. Temporal Validity Window Evaluation
  if (options.enforceWindow !== false) {
    const nowMs =
      options.now instanceof Date
        ? options.now.getTime()
        : (options.now ?? Date.now());
    const skewMs = clockSkewMs(options.clockSkewSeconds);
    if (nowMs < payload.validFrom * 1000 - skewMs)
      return { valid: false, reason: "not-yet-valid", payload };
    if (nowMs > payload.validUntil * 1000 + skewMs)
      return { valid: false, reason: "expired", payload };
  }
  return { valid: true, payload };
}

/**
 * Checks a token against a set of verification keys, for example the keys kept through a key rotation.
 * A token does not say which key signed it, so the keys are tried in order, at most
 * `MAX_VERIFICATION_KEYS` of them. The first key the signature is genuine under decides the result,
 * which can still be "not-yet-valid" or "expired". "bad-signature" means no key matched.
 */
export async function verifyOfflinePasscardWithKeys(
  token: string,
  verificationKeys: readonly CryptoKey[],
  options: VerifyOfflinePasscardOptions = {},
): Promise<OfflinePasscardVerification> {
  // A malformed token is malformed under every key, so report it even when there is no key to try.
  if (!splitToken(token)) return { valid: false, reason: "malformed" };

  for (const key of verificationKeys.slice(0, MAX_VERIFICATION_KEYS)) {
    const result = await verifyOfflinePasscard(token, key, options);
    if (result.valid || result.reason !== "bad-signature") return result;
  }
  return { valid: false, reason: "bad-signature" };
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

/**
 * Imports the public keys of a JWKS (`{ keys: [...] }`, as served by
 * `/api/security/offline-passcards/keys`) or of a plain array of JWKs. An entry that is not a usable
 * public P-256 key, or that carries private key material, is skipped. At most `MAX_VERIFICATION_KEYS`
 * entries are read.
 */
export async function importVerificationKeys(
  jwks: unknown,
): Promise<CryptoKey[]> {
  const entries: unknown = Array.isArray(jwks)
    ? jwks
    : (jwks as { keys?: unknown } | null | undefined)?.keys;
  if (!Array.isArray(entries)) return [];

  const keys: CryptoKey[] = [];
  for (const entry of entries.slice(0, MAX_VERIFICATION_KEYS)) {
    if (!entry || typeof entry !== "object") continue;
    try {
      keys.push(await importVerificationKey(entry as JsonWebKey));
    } catch {
      // Not a usable verification key: leave it out.
    }
  }
  return keys;
}

/** Imports a private signing key (server side only). */
export async function importSigningKey(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.d === undefined) {
    throw new Error("A signing key must contain the private key (d)");
  }
  return subtle().importKey("jwk", jwk, ECDSA_KEY_PARAMS, false, ["sign"]);
}
