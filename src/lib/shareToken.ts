import crypto from "crypto";
import { ENCRYPTION_KEY } from "./crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits is recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits standard for GCM

/**
 * Clock skew tolerance in milliseconds (60 seconds) to account for slight
 * differences between server clocks when evaluating token issuance times.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

export interface ShareTokenPayload {
  collectionId: string;
  permission: "view";
  issuedAt: number;
}

export function encryptShareToken(payload: ShareTokenPayload): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  const payloadStr = JSON.stringify(payload);
  let encrypted = cipher.update(payloadStr, "utf8", "base64url");
  encrypted += cipher.final("base64url");

  const authTag = cipher.getAuthTag().toString("base64url");
  const ivStr = iv.toString("base64url");

  // Format: iv.encrypted.authTag
  return `${ivStr}.${encrypted}.${authTag}`;
}

export function decryptShareToken(
  token: string,
  maxAgeMs?: number,
): ShareTokenPayload | null {
  try {
    if (typeof token !== "string") {
      return null;
    }

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [ivStr, encrypted, authTagStr] = parts;

    if (!ivStr || !encrypted || !authTagStr) {
      return null;
    }

    const iv = Buffer.from(ivStr, "base64url");
    const authTag = Buffer.from(authTagStr, "base64url");

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      return null;
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "base64url", "utf8");
    decrypted += decipher.final("utf8");

    const parsed = JSON.parse(decrypted);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.collectionId !== "string" ||
      parsed.collectionId.trim().length === 0 ||
      parsed.permission !== "view" ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isFinite(parsed.issuedAt) ||
      parsed.issuedAt < 0
    ) {
      return null;
    }

    const payload: ShareTokenPayload = {
      collectionId: parsed.collectionId,
      permission: "view",
      issuedAt: parsed.issuedAt,
    };

    if (maxAgeMs !== undefined) {
      if (
        typeof maxAgeMs !== "number" ||
        !Number.isFinite(maxAgeMs) ||
        maxAgeMs <= 0
      ) {
        return null;
      }

      const now = Date.now();

      // Reject tokens issued excessively far into the future (beyond clock skew tolerance)
      if (payload.issuedAt > now + CLOCK_SKEW_TOLERANCE_MS) {
        return null;
      }

      // Reject expired tokens
      if (now - payload.issuedAt > maxAgeMs) {
        return null;
      }
    }

    return payload;
  } catch {
    // Return null if decryption or parsing fails
    return null;
  }
}
