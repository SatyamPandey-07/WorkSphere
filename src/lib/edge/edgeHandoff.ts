/**
 * Edge Handoff Token Protocol
 *
 * Generates and verifies cryptographic handoff tokens for seamless client
 * migration between PartyKit regional edge nodes. When a user travels
 * across geographical regions, the source edge server issues a handoff
 * token that the target edge server validates before accepting the
 * transferred session state.
 *
 * Token format: base64url( JSON({ payload, signature }) )
 * Signature: HMAC-SHA256( JSON(payload), secret )
 */

import type { Region } from "./geoRouter";

/** The payload embedded inside a handoff token. */
export interface HandoffPayload {
  userId: string;
  sourceRegion: Region;
  targetRegion: Region;
  /** Unix-ms timestamp when the token was created. */
  timestamp: number;
  /** Unix-ms timestamp when the token expires. */
  expiry: number;
  /** Unique nonce to prevent replay attacks. */
  nonce: string;
}

/** Result of a handoff token verification attempt. */
export interface HandoffVerifyResult {
  valid: boolean;
  payload: HandoffPayload | null;
  error?: string;
}

/** Default token time-to-live in milliseconds (30 seconds). */
const DEFAULT_TOKEN_TTL_MS = 30_000;

/**
 * Shared secret used to sign handoff tokens.
 * In production this should come from an environment variable or a
 * secrets manager — the fallback is only for local development.
 */
const HANDOFF_SECRET =
  process.env.EDGE_HANDOFF_SECRET ?? "worksphere-edge-handoff-dev-secret";

// ---------------------------------------------------------------------------
// Portable HMAC-SHA-256 helpers
// ---------------------------------------------------------------------------

/**
 * Encode a UTF-8 string into bytes (works in both Node and edge runtimes).
 */
function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Compute HMAC-SHA-256 and return a hex digest.
 * Uses Web Crypto (available in Cloudflare Workers, Deno, Node ≥ 15).
 */
async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const crypto = globalThis.crypto ?? (await import("crypto")).webcrypto;

  const key = await (crypto as any).subtle.importKey(
    "raw",
    encodeUtf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await (crypto as any).subtle.sign(
    "HMAC",
    key,
    encodeUtf8(message),
  );
  const bytes = new Uint8Array(sig);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a cryptographic random nonce (hex string).
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without crypto.getRandomValues
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Base64-URL helpers (no padding, URL-safe alphabet)
// ---------------------------------------------------------------------------

function base64UrlEncode(str: string): string {
  // btoa is available in all modern runtimes (browsers, Workers, Node ≥ 16)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(encoded: string): string {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return atob(base64);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a signed handoff token for migrating a client session from one
 * regional edge node to another.
 *
 * @param userId       The authenticated user being handed off.
 * @param sourceRegion The region the user is leaving.
 * @param targetRegion The region the user is moving to.
 * @param ttlMs        Token time-to-live in ms (default 30 s).
 * @returns            A compact, URL-safe base64 token string.
 */
export async function generateHandoffToken(
  userId: string,
  sourceRegion: Region,
  targetRegion: Region,
  ttlMs: number = DEFAULT_TOKEN_TTL_MS,
): Promise<string> {
  const now = Date.now();
  const payload: HandoffPayload = {
    userId,
    sourceRegion,
    targetRegion,
    timestamp: now,
    expiry: now + ttlMs,
    nonce: generateNonce(),
  };

  const payloadJson = JSON.stringify(payload);
  const signature = await hmacSha256Hex(payloadJson, HANDOFF_SECRET);

  const tokenObj = JSON.stringify({ payload: payloadJson, signature });
  return base64UrlEncode(tokenObj);
}

/**
 * Verify a handoff token received by a target edge node.
 *
 * Checks:
 *   1. Structural validity (decodable, well-formed JSON)
 *   2. HMAC signature matches
 *   3. Token has not expired
 *   4. Target region matches the receiving server's region
 *
 * @param token         The base64url-encoded handoff token.
 * @param serverRegion  The region of the server verifying the token.
 * @returns             A result object with `valid`, `payload`, and optional `error`.
 */
export async function verifyHandoffToken(
  token: string,
  serverRegion: Region,
): Promise<HandoffVerifyResult> {
  try {
    const decoded = base64UrlDecode(token);
    const tokenObj = JSON.parse(decoded) as {
      payload: string;
      signature: string;
    };

    if (!tokenObj.payload || !tokenObj.signature) {
      return {
        valid: false,
        payload: null,
        error: "Malformed token structure",
      };
    }

    // Verify HMAC signature
    const expectedSig = await hmacSha256Hex(tokenObj.payload, HANDOFF_SECRET);
    if (expectedSig !== tokenObj.signature) {
      return { valid: false, payload: null, error: "Invalid signature" };
    }

    const payload: HandoffPayload = JSON.parse(tokenObj.payload);

    // Check expiry
    if (Date.now() > payload.expiry) {
      return { valid: false, payload, error: "Token expired" };
    }

    // Check target region
    if (payload.targetRegion !== serverRegion) {
      return {
        valid: false,
        payload,
        error: `Region mismatch: token targets '${payload.targetRegion}', server is '${serverRegion}'`,
      };
    }

    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      payload: null,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
