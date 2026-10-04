/**
 * Session Token & Refresh Token Rotation Management (src/lib/auth/sessionTokens.ts)
 *
 * Implements JWT access token signing & verification and rotating refresh tokens
 * with reuse detection (theft protection) using WebCrypto (Edge & Node runtime safe).
 */

export const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const WARNING_DURATION_MS = 60 * 1000; // 60 seconds warning before auto sign-out

export const REFRESH_COOKIE_NAME = "worksphere_refresh_token";
export const ACCESS_COOKIE_NAME = "worksphere_access_token";

export interface SessionUserPayload {
  sub: string; // User ID
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export interface AccessTokenClaims extends SessionUserPayload {
  iat: number;
  exp: number;
  jti: string;
  tokenType: "access";
}

export interface RefreshTokenClaims {
  sub: string;
  familyId: string;
  version: number;
  iat: number;
  exp: number;
  jti: string;
  tokenType: "refresh";
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function getSecret(): string {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.CSRF_SECRET ||
    process.env.CLERK_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production to sign session tokens.");
    }
    return "insecure-development-only-session-secret-key-32chars";
  }
  return secret;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === "function") {
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(binary, "binary").toString("base64url");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return Buffer.from(base64, "base64");
}

function generateRandomHex(byteCount = 16): string {
  const bytes = new Uint8Array(byteCount);
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random number generator is unavailable");
  }
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, ENCODER.encode(data));
  return base64UrlEncode(new Uint8Array(signatureBuffer));
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      ENCODER.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signatureBytes = base64UrlDecode(signature);
    return await crypto.subtle.verify("HMAC", key, signatureBytes as unknown as BufferSource, ENCODER.encode(data));
  } catch {
    return false;
  }
}

/**
 * Signs a payload into a standard 3-part JWT (`header.payload.signature`).
 */
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string = getSecret(),
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(ENCODER.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(ENCODER.encode(JSON.stringify(payload)));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSign(data, secret);
  return `${data}.${signature}`;
}

/**
 * Verifies a JWT token signature and expiration.
 */
export async function verifyJwt<T = Record<string, unknown>>(
  token: string,
  secret: string = getSecret(),
): Promise<T | null> {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;

  const isValid = await hmacVerify(data, signature, secret);
  if (!isValid) return null;

  try {
    const payloadJson = DECODER.decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(payloadJson) as T & { exp?: number };

    // Verify expiration timestamp if present
    if (typeof payload.exp === "number") {
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (nowInSeconds > payload.exp) {
        return null; // Expired
      }
    }

    return payload as T;
  } catch {
    return null;
  }
}

/**
 * Creates an access JWT token.
 */
export async function generateAccessToken(
  user: SessionUserPayload,
  expiresInSeconds = ACCESS_TOKEN_EXPIRY_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = {
    ...user,
    iat: now,
    exp: now + expiresInSeconds,
    jti: generateRandomHex(16),
    tokenType: "access",
  };
  return signJwt(claims as unknown as Record<string, unknown>);
}

/**
 * Verifies an access token.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  const claims = await verifyJwt<AccessTokenClaims>(token);
  if (!claims || claims.tokenType !== "access") return null;
  return claims;
}

// ─── Rotating Refresh Token Family Store & Reuse Detection ──────────────────

interface RefreshTokenRecord {
  familyId: string;
  userId: string;
  currentJti: string;
  version: number;
  revoked: boolean;
  expiresAt: number;
}

// In-memory token family registry (Edge / serverless safe fallback)
const tokenFamilyStore = new Map<string, RefreshTokenRecord>();
const usedJtis = new Set<string>();

/**
 * Generates an initial refresh token and creates a new token family.
 */
export async function generateRefreshToken(
  userId: string,
  expiresInSeconds = REFRESH_TOKEN_EXPIRY_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const familyId = generateRandomHex(16);
  const jti = generateRandomHex(16);

  const record: RefreshTokenRecord = {
    familyId,
    userId,
    currentJti: jti,
    version: 1,
    revoked: false,
    expiresAt: now + expiresInSeconds,
  };
  tokenFamilyStore.set(familyId, record);

  const claims: RefreshTokenClaims = {
    sub: userId,
    familyId,
    version: 1,
    iat: now,
    exp: now + expiresInSeconds,
    jti,
    tokenType: "refresh",
  };

  return signJwt(claims as unknown as Record<string, unknown>);
}

export type RotateResult =
  | {
      success: true;
      accessToken: string;
      refreshToken: string;
      userId: string;
      expiresAt: number;
    }
  | {
      success: false;
      error: "EXPIRED" | "INVALID" | "REUSE_DETECTED" | "REVOKED";
    };

/**
 * Rotates a refresh token: verifies signature & single-use jti,
 * detects reuse (replay attack), invalidates old token, and issues fresh access + refresh token pair.
 */
export async function rotateRefreshToken(
  oldRefreshTokenString: string,
  userPayloadModifier?: Partial<SessionUserPayload>,
): Promise<RotateResult> {
  const claims = await verifyJwt<RefreshTokenClaims>(oldRefreshTokenString);
  if (!claims || claims.tokenType !== "refresh") {
    return { success: false, error: "INVALID" };
  }

  const { familyId, jti, sub: userId, version } = claims;
  const record = tokenFamilyStore.get(familyId);

  // If family does not exist or was explicitly revoked
  if (!record || record.revoked) {
    return { success: false, error: "REVOKED" };
  }

  // Reuse detection: If this JTI was already used, someone is replaying an old token!
  if (usedJtis.has(jti) || record.currentJti !== jti || record.version !== version) {
    // Invalidate entire family immediately to protect against token theft
    record.revoked = true;
    tokenFamilyStore.set(familyId, record);
    return { success: false, error: "REUSE_DETECTED" };
  }

  // Mark previous JTI as used
  usedJtis.add(jti);

  // Rotate to new version and new JTI in same family
  const nextJti = generateRandomHex(16);
  const nextVersion = record.version + 1;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + REFRESH_TOKEN_EXPIRY_SECONDS;

  record.currentJti = nextJti;
  record.version = nextVersion;
  record.expiresAt = exp;
  tokenFamilyStore.set(familyId, record);

  const nextRefreshClaims: RefreshTokenClaims = {
    sub: userId,
    familyId,
    version: nextVersion,
    iat: now,
    exp,
    jti: nextJti,
    tokenType: "refresh",
  };

  const newRefreshToken = await signJwt(nextRefreshClaims as unknown as Record<string, unknown>);
  const newAccessToken = await generateAccessToken({
    sub: userId,
    ...userPayloadModifier,
  });

  return {
    success: true,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    userId,
    expiresAt: exp,
  };
}

/**
 * Revokes a refresh token family (e.g. on logout or theft detection).
 */
export async function revokeRefreshTokenFamily(refreshTokenString: string): Promise<boolean> {
  const claims = await verifyJwt<RefreshTokenClaims>(refreshTokenString);
  if (!claims || !claims.familyId) return false;

  const record = tokenFamilyStore.get(claims.familyId);
  if (record) {
    record.revoked = true;
    tokenFamilyStore.set(claims.familyId, record);
    return true;
  }
  return false;
}

/**
 * Returns cookie configuration options for httpOnly refresh cookie.
 */
export function getRefreshCookieOptions(maxAgeSeconds = REFRESH_TOKEN_EXPIRY_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Clear test state for unit testing.
 * @internal
 */
export function _resetTokenFamilyStoreForTesting(): void {
  tokenFamilyStore.clear();
  usedJtis.clear();
}
