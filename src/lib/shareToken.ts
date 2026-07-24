import crypto from "crypto";
import { ENCRYPTION_KEY } from "./crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits is recommended for GCM

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

export function decryptShareToken(token: string): ShareTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [ivStr, encrypted, authTagStr] = parts;

    const iv = Buffer.from(ivStr, "base64url");
    const authTag = Buffer.from(authTagStr, "base64url");

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "base64url", "utf8");
    decrypted += decipher.final("utf8");

    return JSON.parse(decrypted) as ShareTokenPayload;
  } catch {
    // Return null if decryption or parsing fails
    return null;
  }
}
