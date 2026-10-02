/**
 * Email OTP step-up verification for sensitive passkey actions (#1991).
 *
 * Rotating, renaming or revoking a passkey requires a 6-digit code mailed to
 * the account's address. This is the fallback that still works when the
 * user's authenticator is lost, so it is hardened accordingly:
 *   - codes come from a CSPRNG and only an HMAC of them is stored
 *   - each code is bound to one (user, action, credential) and is single-use
 *   - codes expire after OTP_TTL_MS and lock after OTP_MAX_ATTEMPTS guesses
 *   - issuing a new code invalidates any outstanding one for the same scope
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { escapeHtml } from "@/lib/html";

export const PASSKEY_OTP_ACTIONS = ["rotate", "rename", "revoke"] as const;
export type PasskeyOtpAction = (typeof PASSKEY_OTP_ACTIONS)[number];

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpVerification =
  | { ok: true; otpId: string }
  | { ok: false; reason: "missing" | "expired" | "locked" | "invalid" };

export function isPasskeyOtpAction(value: unknown): value is PasskeyOtpAction {
  return (
    typeof value === "string" &&
    (PASSKEY_OTP_ACTIONS as readonly string[]).includes(value)
  );
}

function getOtpSecret(): string {
  const secret =
    process.env.PASSKEY_OTP_SECRET ||
    process.env.CSRF_SECRET ||
    process.env.CLERK_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "PASSKEY_OTP_SECRET (or CSRF_SECRET / CLERK_SECRET_KEY) must be set in production.",
      );
    }
    return "insecure-development-only-passkey-otp-secret";
  }
  return secret;
}

/** Uniformly random zero-padded numeric code. */
export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

/**
 * HMAC binds the code to its scope, so a code issued to rename credential A
 * can never verify a revoke of credential B even if rows were tampered with.
 */
export function hashOtpCode(
  code: string,
  scope: { userId: string; action: PasskeyOtpAction; credentialId: string },
): string {
  return createHmac("sha256", getOtpSecret())
    .update(`${scope.userId}:${scope.action}:${scope.credentialId}:${code}`)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** "jane.doe@example.com" -> "j•••e@example.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  if (local.length <= 2) return `${local[0] ?? ""}•••@${domain}`;
  return `${local[0]}•••${local[local.length - 1]}@${domain}`;
}

const ACTION_LABELS: Record<PasskeyOtpAction, string> = {
  rotate: "rotate",
  rename: "rename",
  revoke: "remove",
};

function createMailer(): nodemailer.Transporter | null {
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export class OtpDeliveryError extends Error {}

async function sendOtpEmail(
  to: string,
  code: string,
  action: PasskeyOtpAction,
  passkeyName: string,
): Promise<void> {
  const mailer = createMailer();
  const verb = ACTION_LABELS[action];
  const minutes = Math.round(OTP_TTL_MS / 60000);

  if (!mailer) {
    // Never fall back to logging codes in production — that would leak them.
    if (process.env.NODE_ENV === "production") {
      throw new OtpDeliveryError("Email delivery is not configured");
    }
    console.info(`[passkey-otp] (dev only, SMTP not configured) ${verb} code for ${to}: ${code}`);
    return;
  }

  await mailer.sendMail({
    from: `"WorkSphere" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to,
    subject: `Your WorkSphere code to ${verb} a passkey: ${code}`,
    text:
      `Use ${code} to ${verb} the passkey "${passkeyName}" on your WorkSphere account.\n\n` +
      `The code expires in ${minutes} minutes. If you didn't request this, ` +
      `ignore this email and consider reviewing your account security.`,
    html:
      `<p>Use the code below to ${verb} the passkey <strong>${escapeHtml(passkeyName)}</strong> ` +
      `on your WorkSphere account.</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>` +
      `<p>The code expires in ${minutes} minutes. If you didn't request this, ` +
      `ignore this email and consider reviewing your account security.</p>`,
  });
}

/**
 * Issue a fresh code for one action on one credential and email it.
 * Outstanding codes for the same scope are invalidated first.
 */
export async function issuePasskeyOtp(params: {
  userId: string;
  email: string;
  action: PasskeyOtpAction;
  credentialId: string;
  passkeyName: string;
}): Promise<{ expiresAt: Date }> {
  const { userId, email, action, credentialId, passkeyName } = params;
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const now = new Date();

  await prisma.passkeyEmailOtp.updateMany({
    where: { userId, action, credentialId, consumedAt: null },
    data: { consumedAt: now },
  });

  const record = await prisma.passkeyEmailOtp.create({
    data: {
      userId,
      action,
      credentialId,
      codeHash: hashOtpCode(code, { userId, action, credentialId }),
      expiresAt,
    },
  });

  try {
    await sendOtpEmail(email, code, action, passkeyName);
  } catch (error) {
    // An undeliverable code must not stay valid.
    await prisma.passkeyEmailOtp
      .update({ where: { id: record.id }, data: { consumedAt: new Date() } })
      .catch(() => {});
    throw error instanceof OtpDeliveryError
      ? error
      : new OtpDeliveryError("Failed to send verification email");
  }

  return { expiresAt };
}

/**
 * Check a submitted code against the latest outstanding one for its scope.
 * Does NOT consume it — call consumePasskeyOtp() atomically with the action
 * so a failure later in the request (e.g. WebAuthn verification) does not
 * burn the user's code.
 */
export async function verifyPasskeyOtp(params: {
  userId: string;
  action: PasskeyOtpAction;
  credentialId: string;
  code: unknown;
}): Promise<OtpVerification> {
  const { userId, action, credentialId, code } = params;

  const record = await prisma.passkeyEmailOtp.findFirst({
    where: { userId, action, credentialId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return { ok: false, reason: "missing" };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  // Claim an attempt atomically BEFORE comparing, so concurrent guesses
  // cannot all read a stale counter and exceed OTP_MAX_ATTEMPTS.
  const claimed = await prisma.passkeyEmailOtp.updateMany({
    where: { id: record.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { ok: false, reason: "locked" };

  const valid =
    typeof code === "string" &&
    new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code) &&
    safeEqualHex(hashOtpCode(code, { userId, action, credentialId }), record.codeHash);

  if (!valid) {
    return {
      ok: false,
      reason: record.attempts + 1 >= OTP_MAX_ATTEMPTS ? "locked" : "invalid",
    };
  }

  return { ok: true, otpId: record.id };
}

type OtpClient = Pick<typeof prisma, "passkeyEmailOtp">;

/**
 * Atomically mark a verified code as used. Returns false if another request
 * already consumed it (replay / double-submit), in which case abort.
 */
export async function consumePasskeyOtp(
  otpId: string,
  client: OtpClient = prisma,
): Promise<boolean> {
  const result = await client.passkeyEmailOtp.updateMany({
    where: { id: otpId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return result.count === 1;
}

const OTP_ERROR_MESSAGES: Record<Exclude<OtpVerification, { ok: true }>["reason"], string> = {
  missing: "No verification code was requested for this action. Request a new code.",
  expired: "This verification code has expired. Request a new code.",
  locked: "Too many incorrect attempts. Request a new code.",
  invalid: "Incorrect verification code.",
};

/** Map a failed verification to a user-facing message (HTTP 403). */
export function otpErrorMessage(
  result: Exclude<OtpVerification, { ok: true }>,
): string {
  return OTP_ERROR_MESSAGES[result.reason];
}
