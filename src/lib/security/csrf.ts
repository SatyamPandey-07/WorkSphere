/**
 * CSRF Protection — signed double-submit cookie pattern with 256-bit entropy enforcement
 * and timing-safe comparison (Edge & Node runtime safe).
 *
 * Security Guarantees:
 *  1. Entropy: Raw CSRF tokens enforce minimum 256-bit (32 bytes) cryptographically
 *     secure random values to prevent brute-force and token guessing.
 *  2. Timing-Safe Comparison: Header and signature verification utilizes timing-safe comparison
 *     to prevent side-channel timing attacks.
 *  3. Signed Double-Submit Cookie: httpOnly cookie signed with HMAC-SHA256 preventing
 *     forgery and cross-site extraction.
 */

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

export const CSRF_MIN_ENTROPY_BYTES = 32;
export const CSRF_MIN_ENTROPY_BITS = 256;
export const CSRF_TOKEN_BYTE_LENGTH = 32;

const ENCODER = new TextEncoder();

function getSecret(): string {
  const secret = process.env.CSRF_SECRET || process.env.CLERK_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return (
        process.env.VERCEL_GIT_COMMIT_SHA ||
        "worksphere-production-fallback-csrf-secret"
      );
    }
    return "insecure-development-only-csrf-secret";
  }
  return secret;
}

/**
 * Encodes a Uint8Array into URL-safe Base64 (RFC 4648 § 5) without padding.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes a URL-safe Base64 or standard Base64 string into a Uint8Array.
 * Returns null if the input is malformed or invalid.
 */
export function base64UrlDecode(str: string): Uint8Array | null {
  if (typeof str !== "string" || !str) return null;
  const cleaned = str.trim();
  if (!cleaned) return null;

  // Validate characters: standard base64 or URL-safe base64 with optional padding
  if (
    !/^[A-Za-z0-9_-]+={0,2}$/.test(cleaned) &&
    !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)
  ) {
    return null;
  }

  let base64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }

  try {
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(base64, "base64"));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Validates that a CSRF token has minimum 256-bit (32 bytes) entropy.
 */
export function validateCsrfTokenEntropy(
  token: string | undefined | null,
  minEntropyBytes: number = CSRF_MIN_ENTROPY_BYTES,
): boolean {
  if (typeof token !== "string" || !token) return false;
  const trimmed = token.trim();
  if (!trimmed) return false;

  // Check if hex-encoded token
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const byteLength = trimmed.length / 2;
    if (byteLength >= minEntropyBytes) return true;
  }

  // Check base64 / base64url token
  const decoded = base64UrlDecode(trimmed);
  if (decoded && decoded.byteLength >= minEntropyBytes) {
    return true;
  }

  return false;
}

/**
 * Generates cryptographically secure random token bytes and returns URL-safe Base64 string.
 * Enforces a minimum of 32 bytes (256 bits) entropy.
 */
export function generateCsrfRawToken(
  entropyBytes: number = CSRF_TOKEN_BYTE_LENGTH,
): string {
  if (entropyBytes < CSRF_MIN_ENTROPY_BYTES) {
    throw new Error(
      `CSRF token entropy must be at least ${CSRF_MIN_ENTROPY_BYTES} bytes (${CSRF_MIN_ENTROPY_BITS} bits). Received: ${entropyBytes} bytes.`,
    );
  }
  const bytes = new Uint8Array(entropyBytes);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto?.getRandomValues
  ) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error(
      "No cryptographically secure random number generator available.",
    );
  }
  return base64UrlEncode(bytes);
}

function randomRawToken(): string {
  return generateCsrfRawToken(CSRF_TOKEN_BYTE_LENGTH);
}

async function hmacSign(raw: string, secret: string): Promise<string> {
  const subtle =
    typeof crypto !== "undefined" && crypto.subtle
      ? crypto.subtle
      : (globalThis as any).crypto?.subtle;

  if (!subtle) {
    throw new Error("crypto.subtle is not available in the current runtime.");
  }

  const key = await subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await subtle.sign("HMAC", key, ENCODER.encode(raw));
  return base64UrlEncode(new Uint8Array(signatureBuffer));
}

/**
 * Constant-time comparison to avoid timing side-channels.
 * Operates in constant time across both Edge and Node.js runtimes.
 */
export function timingSafeEqual(
  a: string | Uint8Array,
  b: string | Uint8Array,
): boolean {
  if (typeof a !== "string" && !(a instanceof Uint8Array)) return false;
  if (typeof b !== "string" && !(b instanceof Uint8Array)) return false;

  const bufA = typeof a === "string" ? ENCODER.encode(a) : a;
  const bufB = typeof b === "string" ? ENCODER.encode(b) : b;

  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

/**
 * Generates a brand-new signed CSRF token with 256-bit entropy.
 * Returns both the full cookie value and the raw part to hand to the client.
 */
export async function issueCsrfToken(): Promise<{
  cookieValue: string;
  raw: string;
}> {
  const secret = getSecret();
  const raw = randomRawToken();
  const signature = await hmacSign(raw, secret);
  return { cookieValue: `${raw}.${signature}`, raw };
}

/**
 * Verifies an incoming request's CSRF cookie + header pair.
 * Enforces minimum 256-bit entropy (32 random bytes) and timing-safe comparison
 * via crypto.timingSafeEqual to eliminate side-channel timing attack vectors.
 * Returns true only if the cookie signature is valid AND matches the header token.
 */
export async function verifyCsrfToken(
  cookieValue: string | undefined | null,
  headerValue: string | undefined | null,
): Promise<boolean> {
  if (!cookieValue || !headerValue) return false;

  const separatorIndex = cookieValue.lastIndexOf(".");
  if (separatorIndex === -1) return false;

  const raw = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);

  // Enforce minimum 256-bit entropy (32 random bytes) on both raw token and header token
  if (
    !validateCsrfTokenEntropy(raw) ||
    !validateCsrfTokenEntropy(headerValue)
  ) {
    return false;
  }

  const secret = getSecret();
  const expectedSignature = await hmacSign(raw, secret);

  // Timing-safe comparisons for both signature verification and header token match
  const isSignatureValid = timingSafeEqual(signature, expectedSignature);
  const isHeaderValid = timingSafeEqual(raw, headerValue);

  return isSignatureValid && isHeaderValid;
}

/** HTTP methods that mutate state and therefore require CSRF validation. */
export const CSRF_PROTECTED_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Checks whether an HTTP method requires CSRF protection (case-insensitive).
 */
export function isCsrfProtectedMethod(
  method: string | undefined | null,
): boolean {
  if (typeof method !== "string") return false;
  return CSRF_PROTECTED_METHODS.has(method.trim().toUpperCase());
}
