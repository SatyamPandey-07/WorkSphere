/**
 * Session Token & Refresh Token Rotation Management (Retired)
 *
 * WorkSphere utilizes Clerk's native session management for token issuance,
 * session renewal, and authentication lifecycle.
 *
 * The legacy custom in-memory token-family store (`tokenFamilyStore`, `usedJtis`)
 * and manual refresh rotation have been retired.
 */

export { IDLE_TIMEOUT_MS, WARNING_DURATION_MS } from "./sessionConfig";

export const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60; // 15 minutes (legacy reference)
export const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days (legacy reference)

export const REFRESH_COOKIE_NAME = "worksphere_refresh_token";
export const ACCESS_COOKIE_NAME = "worksphere_access_token";

export interface SessionUserPayload {
  sub: string;
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

/**
 * Generates a refresh token (Retired).
 * Returns a placeholder indication that custom token generation is retired.
 */
export async function generateRefreshToken(_userId: string): Promise<string> {
  return "custom_refresh_tokens_retired_use_clerk";
}

/**
 * Rotates a refresh token (Retired).
 * Returns retired error status to prevent custom token family usage.
 */
export async function rotateRefreshToken(
  _refreshToken?: string,
  _ip?: string,
  _passwordChangedAt?: number | null,
): Promise<{
  error?: string;
  code?: string;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
}> {
  return {
    error:
      "Custom refresh token rotation is retired. Use Clerk session management.",
    code: "ENDPOINT_RETIRED",
  };
}

/**
 * Revokes a refresh token family (Retired).
 */
export async function revokeRefreshTokenFamily(
  _tokenOrFamilyId: string,
): Promise<void> {
  // No-op: in-memory token families have been retired
}

/**
 * Resets token family store for testing (Retired no-op).
 */
export function _resetTokenFamilyStoreForTesting(): void {
  // No-op: in-memory store has been retired
}
