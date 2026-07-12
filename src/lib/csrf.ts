/**
 * CSRF Protection — signed double-submit cookie pattern (Edge runtime safe)
 *
 * How it works:
 *  1. Server issues a cookie: `${raw}.${signature}` where signature = HMAC-SHA256(raw, secret).
 *     Cookie is httpOnly, so an attacker's cross-site page can never read it directly.
 *  2. The raw value is also handed to the client once (via GET /api/auth/csrf-token),
 *     which the client echoes back on state-changing requests as the `x-csrf-token` header.
 *  3. On each mutating request, middleware verifies:
 *       a) the cookie's signature was produced with our secret (not forged/injected), and
 *       b) the header value matches the cookie's raw value (proves same-origin JS read it).
 *
 * Uses Web Crypto (`crypto.subtle`) exclusively so this works in Next.js middleware
 * (Edge runtime), not just Node.js API routes.
 */

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

const ENCODER = new TextEncoder();

function getSecret(): string {
  const secret = process.env.CSRF_SECRET || process.env.CLERK_SECRET_KEY;
  if (!secret) {
    // Fail safe in production; allow a deterministic dev-only fallback so local
    // setups without every env var configured don't hard-crash.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CSRF_SECRET (or CLERK_SECRET_KEY) must be set in production to sign CSRF tokens."
      );
    }
    return "insecure-development-only-csrf-secret";
  }
  return secret;
}

async function hmacSign(raw: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, ENCODER.encode(raw));
  return base64UrlEncode(new Uint8Array(signatureBuffer));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Constant-time string comparison to avoid timing side-channels. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Generates a brand-new signed CSRF token. Returns both the full cookie value and the raw part to hand to the client. */
export async function issueCsrfToken(): Promise<{ cookieValue: string; raw: string }> {
  const secret = getSecret();
  const raw = randomRawToken();
  const signature = await hmacSign(raw, secret);
  return { cookieValue: `${raw}.${signature}`, raw };
}

/**
 * Verifies an incoming request's CSRF cookie + header pair.
 * Returns true only if the cookie signature is valid AND matches the header token.
 */
export async function verifyCsrfToken(
  cookieValue: string | undefined | null,
  headerValue: string | undefined | null
): Promise<boolean> {
  if (!cookieValue || !headerValue) return false;

  const separatorIndex = cookieValue.lastIndexOf(".");
  if (separatorIndex === -1) return false;

  const raw = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);

  const secret = getSecret();
  const expectedSignature = await hmacSign(raw, secret);

  if (!timingSafeEqual(signature, expectedSignature)) return false;
  return timingSafeEqual(raw, headerValue);
}

/** HTTP methods that mutate state and therefore require CSRF validation. */
export const CSRF_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
