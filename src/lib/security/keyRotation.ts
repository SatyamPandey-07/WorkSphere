/**
 * Key rotation utilities for offline passcards.
 *
 * Provides helpers to retrieve the active signing key (private) and the set of
 * public verification keys that scanners can use. These helpers are server‑only
 * and are NOT imported by client code.
 */
import "server-only";

export interface PublicVerificationJwk extends JsonWebKey {
  kid?: string;
}

export interface JwkSet {
  keys: PublicVerificationJwk[];
}

/** Maximum number of public verification keys accepted to bound verification cost. */
export const MAX_RETAINED_PUBLIC_KEYS = 10;

/** Allowed public EC fields in exported verification JWKs. */
const ALLOWED_PUBLIC_FIELDS = new Set([
  "kty",
  "crv",
  "x",
  "y",
  "use",
  "alg",
  "kid",
]);

/**
 * Validates a public JWK for ECDSA P-256 verification and strips any unapproved
 * or private fields (specifically private component `d`).
 */
export function sanitizeAndValidatePublicJwk(jwk: unknown): PublicVerificationJwk | null {
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk)) {
    return null;
  }
  const candidate = jwk as Record<string, unknown>;

  // Must never have private key material
  if (candidate.d !== undefined) {
    return null;
  }

  // Mandatory EC P-256 coordinates
  if (
    candidate.kty !== "EC" ||
    candidate.crv !== "P-256" ||
    typeof candidate.x !== "string" ||
    typeof candidate.y !== "string" ||
    candidate.x.trim().length === 0 ||
    candidate.y.trim().length === 0
  ) {
    return null;
  }

  // Validate optional fields if present
  if (candidate.use !== undefined && candidate.use !== "sig") {
    return null;
  }
  if (candidate.alg !== undefined && candidate.alg !== "ES256") {
    return null;
  }
  if (
    candidate.kid !== undefined &&
    (typeof candidate.kid !== "string" || candidate.kid.trim().length === 0)
  ) {
    return null;
  }

  // Build clean object with only approved fields
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(candidate)) {
    if (ALLOWED_PUBLIC_FIELDS.has(key) && val !== undefined) {
      clean[key] = val;
    }
  }

  return clean as PublicVerificationJwk;
}

/**
 * Retrieves and validates the active signing private JWK from environment configuration.
 * Throws if the configuration is present but malformed.
 */
export function getActiveSigningJwk(): JsonWebKey | null {
  const raw = process.env.OFFLINE_PASSCARD_PRIVATE_KEY_JWK;
  if (!raw || raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`OFFLINE_PASSCARD_PRIVATE_KEY_JWK is not valid JSON: ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OFFLINE_PASSCARD_PRIVATE_KEY_JWK must be a valid JSON object");
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.kty !== "EC" ||
    candidate.crv !== "P-256" ||
    typeof candidate.d !== "string" ||
    typeof candidate.x !== "string" ||
    typeof candidate.y !== "string"
  ) {
    throw new Error(
      "OFFLINE_PASSCARD_PRIVATE_KEY_JWK must be a valid EC P-256 private JWK with 'd', 'x', and 'y'",
    );
  }

  return candidate as JsonWebKey;
}

/**
 * Returns the array of public JWKs that are advertised via the public endpoint.
 * The environment variable `OFFLINE_PASSCARD_PUBLIC_JWKS` must contain a JSON
 * string representing a JWKS object (`{ "keys": [ ... ] }`).
 *
 * Additionally verifies that:
 * 1. If an active signing key is configured in OFFLINE_PASSCARD_PRIVATE_KEY_JWK,
 *    a corresponding public key with identical EC coordinates (x, y) is present in the published JWKS.
 * 2. Every published key has a stable `kid`.
 * 3. No private material is published.
 *
 * Throws a descriptive configuration error if any inconsistency is detected.
 */
export function getPublicJwks(): PublicVerificationJwk[] {
  const raw = process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`OFFLINE_PASSCARD_PUBLIC_JWKS is not valid JSON: ${err.message}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as any).keys)
  ) {
    throw new Error(
      "OFFLINE_PASSCARD_PUBLIC_JWKS must be a JSON object containing a 'keys' array",
    );
  }

  const rawKeys = (parsed as { keys: unknown[] }).keys;
  if (rawKeys.length > MAX_RETAINED_PUBLIC_KEYS) {
    throw new Error(
      `OFFLINE_PASSCARD_PUBLIC_JWKS contains ${rawKeys.length} keys, exceeding the maximum of ${MAX_RETAINED_PUBLIC_KEYS}`,
    );
  }

  const sanitizedKeys: PublicVerificationJwk[] = [];
  const seenKids = new Set<string>();

  for (let i = 0; i < rawKeys.length; i++) {
    const rawKey = rawKeys[i];
    const clean = sanitizeAndValidatePublicJwk(rawKey);
    if (!clean) {
      throw new Error(
        `OFFLINE_PASSCARD_PUBLIC_JWKS contains invalid or malformed public JWK at index ${i}`,
      );
    }
    if (!clean.kid || typeof clean.kid !== "string" || clean.kid.trim().length === 0) {
      throw new Error(
        `OFFLINE_PASSCARD_PUBLIC_JWKS: public key at index ${i} is missing a required stable 'kid'`,
      );
    }
    if (seenKids.has(clean.kid)) {
      throw new Error(
        `OFFLINE_PASSCARD_PUBLIC_JWKS: duplicate key identifier (kid="${clean.kid}") detected at index ${i}`,
      );
    }
    seenKids.add(clean.kid);
    sanitizedKeys.push(clean);
  }

  // Cross-validation: If an active private signing key is configured, verify that its public
  // counterpart (same curve, x, and y coordinates) is present in the published JWKS.
  const activePrivate = getActiveSigningJwk();
  if (activePrivate) {
    const matchingKey = sanitizedKeys.find(
      (k) => k.x === activePrivate.x && k.y === activePrivate.y && k.crv === activePrivate.crv,
    );
    if (!matchingKey) {
      throw new Error(
        "Active signing key in OFFLINE_PASSCARD_PRIVATE_KEY_JWK does not match any public key in OFFLINE_PASSCARD_PUBLIC_JWKS",
      );
    }
  }

  return sanitizedKeys;
}
