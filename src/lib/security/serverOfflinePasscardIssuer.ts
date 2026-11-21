/**
 * Server‑only offline passcard issuer.
 *
 * Loads the private signing key from the environment, validates it, and provides
 * a function to issue a signed token for a confirmed booking.
 *
 * This module is server‑only – it must never be imported into client code.
 */
import "server-only";
import {
  signOfflinePasscard,
  importSigningKey,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

// Environment variable that holds the private JWK for signing.
export const PRIVATE_JWK_ENV = "OFFLINE_PASSCARD_PRIVATE_KEY_JWK";

/** Fallback seat representation when a booking does not have a designated seat. */
export const UNASSIGNED_SEAT = "UNASSIGNED";

/** Default booking duration in minutes when not specified on the booking record. */
export const DEFAULT_BOOKING_DURATION_MINUTES = 60;

/**
 * Validates that a JWK conforms to ECDSA P‑256 private key requirements.
 * Throws an Error if validation fails.
 */
export function validateSigningJwk(jwk: unknown): asserts jwk is JsonWebKey {
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk)) {
    throw new Error(`${PRIVATE_JWK_ENV} must be a JSON object representing an EC private JWK`);
  }
  const candidate = jwk as Record<string, unknown>;
  if (candidate.kty !== "EC") {
    throw new Error(`${PRIVATE_JWK_ENV} must have kty="EC"`);
  }
  if (candidate.crv !== "P-256") {
    throw new Error(`${PRIVATE_JWK_ENV} must use the P-256 curve (crv="P-256")`);
  }
  if (typeof candidate.d !== "string" || candidate.d.trim().length === 0) {
    throw new Error(`${PRIVATE_JWK_ENV} must contain private component 'd'`);
  }
  if (typeof candidate.x !== "string" || candidate.x.trim().length === 0) {
    throw new Error(`${PRIVATE_JWK_ENV} must contain coordinate 'x'`);
  }
  if (typeof candidate.y !== "string" || candidate.y.trim().length === 0) {
    throw new Error(`${PRIVATE_JWK_ENV} must contain coordinate 'y'`);
  }
}

// In-memory cache for imported CryptoKey keyed by raw JWK string
let cachedJwkString: string | null = null;
let cachedSigningKey: CryptoKey | null = null;

/** Clears the in-memory signing key cache (primarily for tests). */
export function clearSigningKeyCache(): void {
  cachedJwkString = null;
  cachedSigningKey = null;
}

/**
 * Imports (and caches) the private signing key from the environment.
 */
export async function getSigningKey(): Promise<CryptoKey> {
  const raw = process.env[PRIVATE_JWK_ENV];
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Missing environment variable ${PRIVATE_JWK_ENV}`);
  }

  if (cachedSigningKey && cachedJwkString === raw) {
    return cachedSigningKey;
  }

  let jwk: unknown;
  try {
    jwk = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`${PRIVATE_JWK_ENV} is not valid JSON: ${err.message}`);
  }

  validateSigningJwk(jwk);

  const key = await importSigningKey(jwk);
  cachedJwkString = raw;
  cachedSigningKey = key;
  return key;
}

export interface BookingForPasscard {
  id: string;
  userId: string;
  venueId: string;
  startsAt: Date;
  endsAt?: Date | null;
  durationMinutes?: number | null;
  seatNumber?: string | null;
}

/**
 * Constructs and validates a trusted passcard payload from confirmed booking data.
 */
export function buildPasscardPayload(
  booking: BookingForPasscard,
): OfflinePasscardPayload {
  if (!booking || typeof booking !== "object") {
    throw new Error("Booking record is required to construct passcard payload");
  }

  const { id: bookingId, userId, venueId, startsAt } = booking;

  if (typeof bookingId !== "string" || bookingId.trim().length === 0) {
    throw new Error("bookingId must be a non-empty string");
  }
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("userId must be a non-empty string");
  }
  if (typeof venueId !== "string" || venueId.trim().length === 0) {
    throw new Error("venueId must be a non-empty string");
  }
  if (!(startsAt instanceof Date) || isNaN(startsAt.getTime())) {
    throw new Error("startsAt must be a valid Date instance");
  }

  let endsAt = booking.endsAt;
  if (!endsAt) {
    const durationMins =
      typeof booking.durationMinutes === "number" &&
      Number.isFinite(booking.durationMinutes) &&
      booking.durationMinutes > 0
        ? booking.durationMinutes
        : DEFAULT_BOOKING_DURATION_MINUTES;
    endsAt = new Date(startsAt.getTime() + durationMins * 60_000);
  } else if (!(endsAt instanceof Date) || isNaN(endsAt.getTime())) {
    throw new Error("endsAt must be a valid Date instance when provided");
  }

  const validFrom = Math.floor(startsAt.getTime() / 1000);
  const validUntil = Math.floor(endsAt.getTime() / 1000);

  if (validUntil <= validFrom) {
    throw new Error(
      `Invalid booking validity window: validUntil (${validUntil}) must be strictly later than validFrom (${validFrom})`,
    );
  }

  const seatNumber =
    typeof booking.seatNumber === "string" && booking.seatNumber.trim().length > 0
      ? booking.seatNumber.trim()
      : UNASSIGNED_SEAT;

  return {
    bookingId,
    userId,
    venueId,
    validFrom,
    validUntil,
    seatNumber,
  };
}

/**
 * Issues a cryptographically signed offline passcard token for an eligible confirmed booking.
 * Returns the two-segment Base64URL token string: `payload.signature`.
 */
export async function issuePasscard(
  booking: BookingForPasscard,
): Promise<string> {
  const payload = buildPasscardPayload(booking);
  const signingKey = await getSigningKey();
  return signOfflinePasscard(payload, signingKey);
}
