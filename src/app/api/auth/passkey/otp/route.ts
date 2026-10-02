import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import {
  PASSKEY_OTP_ACTIONS,
  OtpDeliveryError,
  issuePasskeyOtp,
  maskEmail,
} from "@/lib/passkey/emailOtp";

const OTP_HOURLY_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

const requestSchema = z.object({
  action: z.enum(PASSKEY_OTP_ACTIONS),
  credentialId: z.string().min(1),
});

function tooManyRequests(message: string, retryAfter: number) {
  return NextResponse.json(
    { error: message, retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/**
 * POST /api/auth/passkey/otp
 *
 * Emails a single-use code authorising one rotate / rename / revoke on one
 * of the caller's passkeys (#1991). The address always comes from the
 * account record — never from the request.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A valid action and credentialId are required." },
        { status: 400 },
      );
    }
    const { action, credentialId } = parsed.data;

    const cooldownKey = `passkey-otp-cooldown:${userId}`;
    if (!(await rateLimit(cooldownKey, 1, RESEND_COOLDOWN_MS))) {
      const info = await getRateLimitInfo(cooldownKey, 1, RESEND_COOLDOWN_MS);
      const retryAfter = info?.resetTime
        ? Math.max(1, Math.ceil((info.resetTime - Date.now()) / 1000))
        : 30;
      return tooManyRequests("Please wait before requesting another code.", retryAfter);
    }

    if (!(await rateLimit(`passkey-otp:${userId}`, OTP_HOURLY_LIMIT, HOUR_MS))) {
      return tooManyRequests(
        "Too many verification codes requested. Try again later.",
        3600,
      );
    }

    const credential = await prisma.passkeyCredential.findFirst({
      where: { id: credentialId, userId },
      select: { id: true, name: true },
    });
    if (!credential) {
      return NextResponse.json(
        { error: "Passkey credential not found" },
        { status: 404 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      return NextResponse.json(
        { error: "Add an email address to your account to manage passkeys." },
        { status: 400 },
      );
    }

    const { expiresAt } = await issuePasskeyOtp({
      userId,
      email: user.email,
      action,
      credentialId: credential.id,
      passkeyName: credential.name,
    });

    return NextResponse.json({ sentTo: maskEmail(user.email), expiresAt });
  } catch (error) {
    if (error instanceof OtpDeliveryError) {
      return NextResponse.json(
        { error: "We couldn't send the verification email. Please try again later." },
        { status: 503 },
      );
    }
    console.error("Error issuing passkey OTP:", error);
    return NextResponse.json(
      { error: "Failed to send verification code" },
      { status: 500 },
    );
  }
}
