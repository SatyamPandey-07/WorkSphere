import { randomBytes, createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

export const emailSchema = z
  .string()
  .trim()
  .email({ message: "Invalid email address format" })
  .transform((val) => val.toLowerCase());

export interface MagicLinkResult {
  success: boolean;
  email?: string;
  token?: string;
  error?: string;
}

export interface StoredMagicToken {
  email: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
  consumedAt?: number;
}

const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// In-memory fallback stores for test and environments without Redis
const inMemoryTokenStore = new Map<string, StoredMagicToken>();
const inMemoryRateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

export function hashMagicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSecureToken(): string {
  return randomBytes(32).toString("hex");
}

export async function checkRateLimit(email: string): Promise<boolean> {
  const redis = getRedis();
  const key = `magic_rate:${email}`;

  if (redis) {
    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
      }
      return current <= MAX_REQUESTS_PER_WINDOW;
    } catch {
      // Fallback to in-memory on redis error
    }
  }

  const now = Date.now();
  const entry = inMemoryRateLimitStore.get(email);
  if (!entry || now > entry.resetAt) {
    inMemoryRateLimitStore.set(email, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  entry.count += 1;
  return true;
}

export async function storeMagicToken(
  token: string,
  email: string,
  ttlMs = MAGIC_TOKEN_TTL_MS,
): Promise<StoredMagicToken> {
  const tokenHash = hashMagicToken(token);
  const now = Date.now();
  const stored: StoredMagicToken = {
    email,
    tokenHash,
    createdAt: now,
    expiresAt: now + ttlMs,
    consumed: false,
  };

  const redis = getRedis();
  if (redis) {
    try {
      const key = `magic_token:${tokenHash}`;
      await redis.set(key, JSON.stringify(stored), { px: ttlMs });
    } catch (err) {
      console.warn(
        "Failed to store magic token in Redis, using in-memory store",
        err,
      );
    }
  }

  inMemoryTokenStore.set(tokenHash, stored);
  return stored;
}

export async function verifyMagicLinkToken(
  rawToken: string,
): Promise<{ success: boolean; email?: string; error?: string }> {
  if (!rawToken || typeof rawToken !== "string") {
    return { success: false, error: "Token is required" };
  }

  const tokenHash = hashMagicToken(rawToken);
  let stored: StoredMagicToken | null = null;

  const redis = getRedis();
  if (redis) {
    try {
      const data = await redis.get<string | StoredMagicToken>(
        `magic_token:${tokenHash}`,
      );
      if (data) {
        stored = typeof data === "string" ? JSON.parse(data) : data;
      }
    } catch (err) {
      console.warn("Failed to retrieve magic token from Redis", err);
    }
  }

  if (!stored) {
    stored = inMemoryTokenStore.get(tokenHash) || null;
  }

  if (!stored) {
    return { success: false, error: "Invalid or expired magic link" };
  }

  if (stored.consumed) {
    return { success: false, error: "Magic link has already been used" };
  }

  if (Date.now() > stored.expiresAt) {
    return { success: false, error: "Magic link has expired" };
  }

  // Mark single-use token as consumed
  stored.consumed = true;
  stored.consumedAt = Date.now();

  if (redis) {
    try {
      await redis.set(`magic_token:${tokenHash}`, JSON.stringify(stored), {
        px: Math.max(0, stored.expiresAt - Date.now()),
      });
    } catch (err) {
      console.warn("Failed to update consumed status in Redis", err);
    }
  }

  inMemoryTokenStore.set(tokenHash, stored);

  return { success: true, email: stored.email };
}

async function createMailer() {
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  const nodemailer = (await import("nodemailer")).default;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendMagicLinkEmail(
  email: string,
  token: string,
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const magicLinkUrl = `${appUrl}/api/auth/magic-link?token=${encodeURIComponent(token)}`;

  const mailer = await createMailer();
  if (mailer) {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || '"WorkSphere" <no-reply@worksphere.io>',
      to: email,
      subject: "Your WorkSphere Magic Link",
      text: `Click the link below to sign in to WorkSphere:\n\n${magicLinkUrl}\n\nThis link will expire in 15 minutes. If you did not request this link, you can safely ignore this email.`,
      html: `<p>Click the link below to sign in to WorkSphere:</p><p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p><p>This link will expire in 15 minutes. If you did not request this link, you can safely ignore this email.</p>`,
    });
  }
}

export async function processMagicLinkRequest(
  rawEmail: string,
): Promise<MagicLinkResult> {
  const parseResult = emailSchema.safeParse(rawEmail);

  if (!parseResult.success) {
    const errorMsg =
      (parseResult.error as any).issues?.[0]?.message ||
      (parseResult.error as any).errors?.[0]?.message ||
      "Invalid email format";
    return {
      success: false,
      error: errorMsg,
    };
  }

  const normalizedEmail = parseResult.data;

  // Rate limiting check
  const allowed = await checkRateLimit(normalizedEmail);
  if (!allowed) {
    return {
      success: false,
      error: "Too many magic link requests. Please try again later.",
    };
  }

  let user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
    },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        id: `user_${generateSecureToken().substring(0, 10)}`,
        email: normalizedEmail,
      },
    });
  }

  // Cryptographically secure token generation
  const token = generateSecureToken();

  // Store hashed token with expiration
  await storeMagicToken(token, normalizedEmail);

  // Deliver authentication link to user's email
  try {
    await sendMagicLinkEmail(normalizedEmail, token);
  } catch (deliveryError) {
    console.error("Failed to deliver magic link email:", deliveryError);
  }

  return {
    success: true,
    email: normalizedEmail,
    token, // Internal for testing and programmatic callers
  };
}

export function clearTokenStore(): void {
  inMemoryTokenStore.clear();
  inMemoryRateLimitStore.clear();
}
