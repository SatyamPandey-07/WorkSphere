import { createHmac, timingSafeEqual } from "crypto";

export interface IotWebhookVerificationResult {
  isValid: boolean;
  reason?: string;
  timestamp?: number;
}

export interface VerifyIotWebhookSignatureOptions {
  /**
   * Maximum acceptable difference between the webhook timestamp and the server's
   * current time in seconds. Defaults to 300 seconds (5 minutes). Set to 0 to disable.
   */
  toleranceSeconds?: number;
  /**
   * Override current server timestamp (in seconds) for testing purposes.
   */
  currentTimestamp?: number;
}

/**
 * Signs a payload using HMAC-SHA256 according to the WorkSphere specification:
 * Header format: `X-WorkSphere-Signature: t=${timestamp},v1=${signature}`
 * Signed string format: `${timestamp}.${rawBody}`
 */
export function signIotWebhookPayload(
  rawBody: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { header: string; signature: string; timestamp: number } {
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const hmac = createHmac("sha256", cleanSecret);
  hmac.update(`${timestamp}.${rawBody}`);
  const signature = hmac.digest("hex");
  const header = `t=${timestamp},v1=${signature}`;

  return {
    header,
    signature,
    timestamp,
  };
}

/**
 * Verifies an incoming `X-WorkSphere-Signature` header against the raw request body and shared secret.
 *
 * Requirements:
 * 1. Secret must be present and non-empty (fails closed).
 * 2. Signature header must follow `t=${timestamp},v1=${signature}` format.
 * 3. Timestamp freshness is validated against tolerance (default 300 seconds).
 * 4. HMAC-SHA256 is computed using the raw request body and timestamp.
 * 5. Uses `crypto.timingSafeEqual` with preceding buffer length check to avoid timing attacks or exceptions.
 * 6. Never throws unhandled exceptions or leaks secrets/sensitive data.
 */
export function verifyIotWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
  options?: VerifyIotWebhookSignatureOptions,
): IotWebhookVerificationResult {
  if (!secret || typeof secret !== "string" || secret.trim() === "") {
    return { isValid: false, reason: "MISSING_SECRET" };
  }

  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { isValid: false, reason: "MISSING_SIGNATURE_HEADER" };
  }

  // Parse `t=${timestamp},v1=${signature}`
  const parts = signatureHeader.split(",");
  let timestampStr: string | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    const value = rest.join("=");
    if (key === "t") timestampStr = value;
    if (key === "v1") signature = value;
  }

  if (!timestampStr || !signature) {
    return { isValid: false, reason: "INVALID_SIGNATURE_FORMAT" };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || timestamp <= 0) {
    return { isValid: false, reason: "INVALID_TIMESTAMP" };
  }

  // Validate timestamp freshness (tolerance window: +/- toleranceSeconds, default 300s)
  const tolerance = options?.toleranceSeconds ?? 300;
  const nowSec = options?.currentTimestamp ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(nowSec - timestamp) > tolerance) {
    return { isValid: false, reason: "TIMESTAMP_OUT_OF_TOLERANCE", timestamp };
  }

  try {
    const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const hmac = createHmac("sha256", cleanSecret);
    hmac.update(`${timestamp}.${rawBody}`);
    const expectedSignature = hmac.digest("hex");

    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    // Ensure hex length is even and buffer length matches expected 32 bytes (256 bits)
    if (
      signature.length !== expectedSignature.length ||
      sigBuffer.length !== expectedBuffer.length ||
      sigBuffer.length === 0
    ) {
      return { isValid: false, reason: "SIGNATURE_MISMATCH", timestamp };
    }

    const matches = timingSafeEqual(sigBuffer, expectedBuffer);
    if (!matches) {
      return { isValid: false, reason: "SIGNATURE_MISMATCH", timestamp };
    }

    return { isValid: true, timestamp };
  } catch {
    return { isValid: false, reason: "VERIFICATION_ERROR", timestamp };
  }
}
