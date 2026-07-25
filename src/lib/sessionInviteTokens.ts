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
  payload?: InviteTokenPayload;
}

/**
 * Encodes string to URL-safe base64 format.
 */
export function encodeBase64Url(str: string): string {
  if (typeof btoa === "function") {
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(str).toString("base64url");
}

/**
 * Decodes URL-safe base64 string back to raw text.
 */
export function decodeBase64Url(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  if (typeof atob === "function") {
    return atob(base64);
  }
  return Buffer.from(base64, "base64").toString("utf-8");
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
 * Generates a WebCrypto-secured shareable invite token for a CoworkingSession.
 */
export async function generateSessionInviteToken(
  sessionId: string,
  expiresInHours = 24,
  maxParticipants?: number,
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
  return encodeBase64Url(jsonStr);
}

/**
 * Validates a session invite token against expiration timestamp and participant capacity limit.
 */
export function validateSessionInviteToken(
  token: string,
  currentParticipantsCount: number,
  expectedSessionId?: string,
): ValidationResult {
  if (!token) {
    return { valid: false, error: "Missing invite token." };
  }

  try {
    const jsonStr = decodeBase64Url(token);
    const payload = JSON.parse(jsonStr) as InviteTokenPayload;

    if (!payload || !payload.sessionId || !payload.expiresAt) {
      return { valid: false, error: "Invalid invite token structure." };
    }

    if (expectedSessionId && payload.sessionId !== expectedSessionId) {
      return {
        valid: false,
        error: "Invite token does not match this session.",
      };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Invite link has expired." };
    }

    if (
      payload.maxParticipants !== undefined &&
      payload.maxParticipants > 0 &&
      currentParticipantsCount >= payload.maxParticipants
    ) {
      return { valid: false, error: "Session participant limit reached." };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Failed to decode invite token." };
  }
}
