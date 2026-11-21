import crypto from "crypto";
import { ENCRYPTION_KEY } from "@/lib/crypto";

const ALGORITHM = "sha256";
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export interface VenueAccessTokenPayload {
  venueId: string;
  commitment: string;
  issuedAt: number;
  expiresAt: number;
}

function sign(data: string, secret: Buffer): string {
  return crypto.createHmac(ALGORITHM, secret).update(data).digest("base64url");
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Issue a signed venue access token after successful ZKP verification.
 * The token is a compact three-part string: payload.timestamp.signature
 * No identity information is stored — only the public commitment.
 */
export function issueVenueAccessToken(
  venueId: string,
  commitment: string,
): string {
  const now = Date.now();
  const payload: VenueAccessTokenPayload = {
    venueId,
    commitment,
    issuedAt: now,
    expiresAt: now + TOKEN_EXPIRY_MS,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const sig = sign(payloadB64, ENCRYPTION_KEY);

  return `${payloadB64}.${now}.${sig}`;
}

/**
 * Verify and decode a venue access token.
 * Returns the payload if valid and not expired, null otherwise.
 * Never stores or logs identity information.
 */
export function verifyVenueAccessToken(
  token: string,
): VenueAccessTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [payloadB64, timestamp, sig] = parts;

    const expectedSig = sign(payloadB64, ENCRYPTION_KEY);
    if (!safeCompare(sig, expectedSig)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as VenueAccessTokenPayload;

    if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) {
      return null;
    }

    if (typeof payload.venueId !== "string" || typeof payload.commitment !== "string") {
      return null;
    }

    if (String(payload.issuedAt) !== timestamp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

const CHECK_IN_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export interface AnonymousCheckInTokenPayload {
  scope: "venue-checkin";
  venueId: string;
  nullifierHash: string;
  epoch: number;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Issue a short-lived anonymous access token after a valid anonymous
 * venue check-in proof. The token carries only public proof signals —
 * no account ID, wallet address, or identity data.
 */
export function issueAnonymousCheckInToken(
  venueId: string,
  nullifierHash: string,
  epoch: number,
  ttlMs: number = CHECK_IN_TOKEN_EXPIRY_MS,
): string {
  const now = Date.now();
  const payload: AnonymousCheckInTokenPayload = {
    scope: "venue-checkin",
    venueId,
    nullifierHash,
    epoch,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const sig = sign(payloadB64, ENCRYPTION_KEY);

  return `${payloadB64}.${now}.${sig}`;
}

/**
 * Verify and decode an anonymous check-in access token.
 * Returns the payload if valid and not expired, null otherwise.
 */
export function verifyAnonymousCheckInToken(
  token: string,
): AnonymousCheckInTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [payloadB64, timestamp, sig] = parts;

    const expectedSig = sign(payloadB64, ENCRYPTION_KEY);
    if (!safeCompare(sig, expectedSig)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as AnonymousCheckInTokenPayload;

    if (payload.scope !== "venue-checkin") {
      return null;
    }

    if (
      typeof payload.expiresAt !== "number" ||
      Date.now() > payload.expiresAt
    ) {
      return null;
    }

    if (
      typeof payload.venueId !== "string" ||
      typeof payload.nullifierHash !== "string" ||
      !Number.isSafeInteger(payload.epoch)
    ) {
      return null;
    }

    if (String(payload.issuedAt) !== timestamp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
