/**
 * Secure CoworkingSession Invite Link & Token Helper (src/lib/sessionInviteTokens.ts)
 *
 * Uses WebCrypto API to generate secure invite tokens with expiration validation
 * and participant capacity enforcement for private coworking sessions.
 */

export interface InviteTokenPayload {
  sessionId: string;
  expiresAt: number;
  maxParticipants?: number;
  nonce: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
  expired?: boolean;
  payload?: InviteTokenPayload;
}

/**
 * Validates a session invite token against HMAC signature, expiration timestamp, and participant capacity limit.
 * Checks token expiration against server timestamp and assigns structured HTTP status codes (410 for expired, 404 for not found/mismatched session, 400 for malformed, 409 for capacity limit).
 */
export function validateSessionInviteToken(
  token: string,
  currentParticipantsCount = 0,
  expectedSessionId?: string,
  secret: string = getInviteSecret(),
  serverTimestamp: number = Date.now(),
): ValidationResult {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Missing invite token.", statusCode: 400 };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Invalid invite token format.", statusCode: 400 };
  }

  const [payloadB64, signature] = parts;
  const expectedSignature = computeHmacSha256(payloadB64, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return {
      valid: false,
      error: "Invalid or forged invite token signature.",
      statusCode: 400,
    };
  }

  try {
    const jsonStr = decodeBase64Url(payloadB64);
    const payload = JSON.parse(jsonStr) as InviteTokenPayload;

    if (!payload || !payload.sessionId || !payload.expiresAt) {
      return {
        valid: false,
        error: "Invalid invite token structure.",
        statusCode: 400,
      };
    }

    if (expectedSessionId && payload.sessionId !== expectedSessionId) {
      return {
        valid: false,
        error: "Invite token does not match this session.",
        statusCode: 404,
      };
    }

    if (serverTimestamp > payload.expiresAt) {
      return {
        valid: false,
        error: "Invite token has expired",
        expired: true,
        statusCode: 410,
      };
    }

    if (
      payload.maxParticipants !== undefined &&
      payload.maxParticipants > 0 &&
      currentParticipantsCount >= payload.maxParticipants
    ) {
      return {
        valid: false,
        error: "Session participant limit reached.",
        statusCode: 409,
      };
    }

    return { valid: true, statusCode: 200, payload };
  } catch {
    return {
      valid: false,
      error: "Failed to decode invite token.",
      statusCode: 400,
    };
  }
}

/**
 * Verifies invite token and returns a structured status code and JSON payload response.
 */
export function verifyInviteTokenResponse(
  token: string,
  currentParticipantsCount = 0,
  expectedSessionId?: string,
  secret: string = getInviteSecret(),
  serverTimestamp: number = Date.now(),
): { status: number; body: { error?: string; valid: boolean; payload?: InviteTokenPayload } } {
  const result = validateSessionInviteToken(
    token,
    currentParticipantsCount,
    expectedSessionId,
    secret,
    serverTimestamp,
  );

  return {
    status: result.statusCode ?? (result.valid ? 200 : 400),
    body: {
      valid: result.valid,
      ...(result.error ? { error: result.error } : {}),
      ...(result.payload ? { payload: result.payload } : {}),
    },
  };
}

const CHUNK_SIZE = 8192;

/**
 * Encodes string to URL-safe base64 format supporting full UTF-8 strings.
 */
export function encodeBase64Url(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf-8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes URL-safe base64 string back to raw UTF-8 text.
 */
export function decodeBase64Url(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Generates a cryptographically secure random hex nonce using WebCrypto API.
 */
export function generateSecureNonce(bytesCount = 16): string {
  const bytes = new Uint8Array(bytesCount);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Retrieves the secret key used for signing invite tokens.
 */
function getInviteSecret(): string {
  return (
    process.env.SESSION_INVITE_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    "worksphere-coworking-session-invite-secret-key-32b"
  );
}

/**
 * Constant-time comparison for strings to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Pure JS SHA-256 implementation for universal browser/edge/Node runtime safety.
 */
function sha256(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = data.length;
  const bitLen = len * 8;
  const padLen = (((len + 8) >> 6) << 6) + 64;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);

  for (let i = 0; i < padLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3);
      const s1 = ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let j = 0; j < 64; j++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const result = new Uint8Array(32);
  const resView = new DataView(result.buffer);
  resView.setUint32(0, h0, false);
  resView.setUint32(4, h1, false);
  resView.setUint32(8, h2, false);
  resView.setUint32(12, h3, false);
  resView.setUint32(16, h4, false);
  resView.setUint32(20, h5, false);
  resView.setUint32(24, h6, false);
  resView.setUint32(28, h7, false);
  return result;
}

/**
 * Computes an HMAC-SHA256 digest formatted as URL-safe base64.
 */
function computeHmacSha256(message: string, secret: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("crypto");
    if (nodeCrypto && typeof nodeCrypto.createHmac === "function") {
      return nodeCrypto.createHmac("sha256", secret).update(message).digest("base64url");
    }
  } catch {
    // Fall back to pure JS SHA-256 HMAC for browser/edge runtimes
  }

  const encoder = new TextEncoder();
  let keyBytes = encoder.encode(secret);
  const msgBytes = encoder.encode(message);

  if (keyBytes.length > 64) {
    keyBytes = sha256(keyBytes);
  }
  const paddedKey = new Uint8Array(64);
  paddedKey.set(keyBytes);

  const oKeyPad = new Uint8Array(64);
  const iKeyPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const innerMsg = new Uint8Array(64 + msgBytes.length);
  innerMsg.set(iKeyPad, 0);
  innerMsg.set(msgBytes, 64);
  const innerHash = sha256(innerMsg);

  const outerMsg = new Uint8Array(64 + 32);
  outerMsg.set(oKeyPad, 0);
  outerMsg.set(innerHash, 64);
  const outerHash = sha256(outerMsg);

  let binary = "";
  for (let i = 0; i < outerHash.length; i++) {
    binary += String.fromCharCode(outerHash[i]);
  }
  if (typeof btoa === "function") {
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(binary, "binary").toString("base64url");
}

/**
 * Generates a WebCrypto-secured shareable invite token for a CoworkingSession.
 */
export async function generateSessionInviteToken(
  sessionId: string,
  expiresInHours = 24,
  maxParticipants?: number,
  secret: string = getInviteSecret(),
): Promise<string> {
  const nonce = generateSecureNonce(16);
  const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000;

  const payload: InviteTokenPayload = {
    sessionId,
    expiresAt,
    maxParticipants,
    nonce,
  };

  const jsonStr = JSON.stringify(payload);
  const payloadB64 = encodeBase64Url(jsonStr);
  const signature = computeHmacSha256(payloadB64, secret);

  return `${payloadB64}.${signature}`;
}

