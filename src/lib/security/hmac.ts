import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validates whether a given string is a non-empty, even-length, strict hexadecimal string.
 * This prevents Node.js `Buffer.from(str, 'hex')` from permissively decoding malformed
 * inputs (e.g. truncated odd-length hex or non-hex characters).
 */
export function isValidHex(str: unknown): str is string {
  if (typeof str !== "string" || str.length === 0 || str.length % 2 !== 0) {
    return false;
  }
  return /^[0-9a-fA-F]+$/.test(str);
}

/**
 * Safely compares two hexadecimal HMAC/webhook signatures in constant time
 * to prevent timing side-channel attacks.
 *
 * Requirements:
 * 1. Convert both signatures into Buffers using hex encoding after verifying hex validity.
 * 2. Check buffer lengths before calling `timingSafeEqual`, returning `false` for mismatched
 *    lengths without throwing a `RangeError`.
 * 3. Handle malformed, null, undefined, or empty signatures safely without throwing.
 * 4. Delegate to Node.js `crypto.timingSafeEqual` for equal-length valid inputs.
 *
 * @param signature The received signature string (hex-encoded)
 * @param computedSignature The expected/computed signature string (hex-encoded)
 * @returns boolean indicating if the signatures match in constant time
 */
export function safeCompareSignatures(
  signature: unknown,
  computedSignature: unknown,
): boolean {
  try {
    if (!isValidHex(signature) || !isValidHex(computedSignature)) {
      return false;
    }

    const received = Buffer.from(signature as string, "hex");
    const expected = Buffer.from(computedSignature as string, "hex");

    if (received.length === 0 || expected.length === 0 || received.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

export interface WebhookVerificationOptions {
  /**
   * Secret key for computing HMAC. If starts with "whsec_", prefix can be stripped.
   */
  secret: string;
  /**
   * Signature algorithm, defaults to "sha256".
   */
  algorithm?: string;
  /**
   * Prefix in signature header, e.g. "sha256=" or none.
   */
  prefix?: string;
}

/**
 * Computes an HMAC digest for raw payload using specified secret and algorithm (default sha256).
 */
export function computeHmacSignature(
  rawBody: string,
  secret: string,
  algorithm: string = "sha256",
): string {
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return createHmac(algorithm, cleanSecret).update(rawBody, "utf8").digest("hex");
}

/**
 * Verifies standard HMAC signature from webhook headers.
 * Extracts signature (stripping optional prefix like "sha256="),
 * calculates expected HMAC, and uses `safeCompareSignatures`.
 */
export function verifyHmacWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
  prefix: string = "sha256=",
): boolean {
  if (!signatureHeader || !secret || typeof signatureHeader !== "string" || typeof secret !== "string") {
    return false;
  }

  let signature = signatureHeader.trim();
  if (prefix && signature.toLowerCase().startsWith(prefix.toLowerCase())) {
    signature = signature.slice(prefix.length).trim();
  }

  const expectedSignature = computeHmacSignature(rawBody, secret);
  return safeCompareSignatures(signature, expectedSignature);
}
