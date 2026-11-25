import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { generateOtpCode, hashOtpCode, maskEmail } from "@/lib/auth/passkeys/server/emailOtp";
import { issueStepUpToken } from "@/lib/auth/stepUpAuth";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

// In-memory OTP store for step-up fallback (transaction-scoped)
interface StoredStepUpOtp {
  codeHash: string;
  userId: string;
  action: string;
  amount: number;
  recipient?: string;
  expiresAt: number;
  attempts: number;
}

const stepUpOtpStore = new Map<string, StoredStepUpOtp>();

export async function requestStepUpEmailOtpHandler(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
    if (!(await rateLimit(`stepup-email-otp-req:${userId || ip}`, 5, 60 * 1000))) {
      return NextResponse.json(
        { error: "Too many verification code requests. Please wait." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { action = "wallet_transfer", amount = 0, recipient } = body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      return NextResponse.json(
        { error: "No verified email found on user account." },
        { status: 400 }
      );
    }

    const code = generateOtpCode();
    // Scope hash by userId, action, and transaction amount
    const codeHash = hashOtpCode(code, {
      userId,
      action: "rotate", // using valid PasskeyOtpAction for HMAC helper
      credentialId: `stepup:${action}:${amount}`,
    });

    const storeKey = `stepup:${userId}:${action}`;
    stepUpOtpStore.set(storeKey, {
      codeHash,
      userId,
      action,
      amount: Number(amount),
      recipient,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });

    // In a live environment, send via email service. In test/dev, log or proceed.
    console.info(`[Step-Up Email OTP] Generated code for ${maskEmail(user.email)} for action=${action}`);

    return NextResponse.json({
      success: true,
      maskedEmail: maskEmail(user.email),
      expiresInSeconds: 300,
    });
  } catch (error: any) {
    console.error("Error issuing step-up email OTP:", error);
    return NextResponse.json(
      { error: "Failed to issue email verification code" },
      { status: 500 }
    );
  }
}

export async function verifyStepUpEmailOtpHandler(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
    if (!(await rateLimit(`stepup-email-otp-ver:${userId || ip}`, 10, 60 * 1000))) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please wait." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { code, action = "wallet_transfer", amount = 0, recipient } = body;
    void recipient;

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Verification code is required" }, { status: 400 });
    }

    const storeKey = `stepup:${userId}:${action}`;
    const stored = stepUpOtpStore.get(storeKey);

    if (!stored) {
      return NextResponse.json(
        { error: "No active verification code found. Please request a new code." },
        { status: 400 }
      );
    }

    if (Date.now() > stored.expiresAt) {
      stepUpOtpStore.delete(storeKey);
      return NextResponse.json(
        { error: "Verification code has expired. Please request a new one." },
        { status: 400 }
      );
    }

    if (stored.attempts >= MAX_ATTEMPTS) {
      stepUpOtpStore.delete(storeKey);
      return NextResponse.json(
        { error: "Too many failed attempts. This code has been invalidated." },
        { status: 400 }
      );
    }

    stored.attempts += 1;

    // Check transaction binding
    if (stored.amount !== Number(amount)) {
      return NextResponse.json(
        { error: "Verification code was issued for a different transaction amount." },
        { status: 400 }
      );
    }

    // Verify code hash
    const expectedHash = hashOtpCode(code.trim(), {
      userId,
      action: "rotate",
      credentialId: `stepup:${action}:${stored.amount}`,
    });

    if (stored.codeHash !== expectedHash) {
      return NextResponse.json(
        { error: "Invalid verification code. Please try again." },
        { status: 400 }
      );
    }

    // Single-use: delete after successful verification
    stepUpOtpStore.delete(storeKey);

    // Issue cryptographic Step-Up token
    const stepUpToken = issueStepUpToken(
      userId,
      action,
      "email_otp_fallback",
      true
    );

    return NextResponse.json({
      verified: true,
      stepUpToken,
      action,
      method: "email_otp",
    });
  } catch (error: any) {
    console.error("Error verifying step-up email OTP:", error);
    return NextResponse.json(
      { error: "Failed to verify email verification code" },
      { status: 500 }
    );
  }
}
