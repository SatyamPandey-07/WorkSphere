import crypto from "crypto";

const STEP_UP_SECRET =
  process.env.STEP_UP_SECRET ||
  process.env.ENCRYPTION_KEY ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("STEP_UP_SECRET must be set in production");
      })()
    : "worksphere_step_up_reauth_secret_key_default_32b");

const STEP_UP_TTL_SECONDS = 300; // 5 minutes validity

export interface StepUpTokenPayload {
  userId: string;
  action: string;
  credentialId: string;
  userVerified: boolean;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface StepUpVerificationResult {
  valid: boolean;
  userId?: string;
  action?: string;
  userVerified?: boolean;
  error?: string;
  timeRemainingSeconds?: number;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

/**
 * Issues a cryptographically signed, tamper-proof Step-Up Re-Authentication token.
 */
export function issueStepUpToken(
  userId: string,
  action: string,
  credentialId: string,
  userVerified = true
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: StepUpTokenPayload = {
    userId,
    action,
    credentialId,
    userVerified,
    issuedAt: now,
    expiresAt: now + STEP_UP_TTL_SECONDS,
    nonce: crypto.randomBytes(8).toString("hex"),
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", STEP_UP_SECRET)
    .update(payloadEncoded)
    .digest("base64url");

  return `${payloadEncoded}.${signature}`;
}

/**
 * Validates a Step-Up Re-Authentication token for a sensitive action.
 */
export function verifyStepUpToken(
  token: string,
  expectedAction?: string,
  expectedUserId?: string
): StepUpVerificationResult {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, error: "Missing or malformed step-up token" };
  }

  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) {
    return { valid: false, error: "Invalid step-up token format" };
  }

  // 1. Verify HMAC signature
  const expectedSig = crypto
    .createHmac("sha256", STEP_UP_SECRET)
    .update(payloadEncoded)
    .digest("base64url");

  if (signature !== expectedSig) {
    return { valid: false, error: "Step-up signature verification failed" };
  }

  // 2. Parse payload
  let payload: StepUpTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded));
  } catch {
    return { valid: false, error: "Failed to decode step-up payload" };
  }

  const now = Math.floor(Date.now() / 1000);

  // 3. Check expiry
  if (now > payload.expiresAt) {
    return { valid: false, error: "Step-up re-authentication expired. Please re-authenticate." };
  }

  // 4. Check user verification
  if (!payload.userVerified) {
    return { valid: false, error: "Step-up action requires biometric user verification (UV)." };
  }

  // 5. Match expected action
  if (expectedAction && payload.action !== expectedAction) {
    return { valid: false, error: `Step-up token action mismatch (expected ${expectedAction}).` };
  }

  // 6. Match expected user
  if (expectedUserId && payload.userId !== expectedUserId) {
    return { valid: false, error: "Step-up token does not match active user session." };
  }

  return {
    valid: true,
    userId: payload.userId,
    action: payload.action,
    userVerified: payload.userVerified,
    timeRemainingSeconds: payload.expiresAt - now,
  };
}
