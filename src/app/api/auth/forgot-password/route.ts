import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

const forgotPasswordSchema = z.object({
  email: z
    .string({ message: "A valid email address is required." })
    .trim()
    .email("A valid email address is required.")
    .toLowerCase(),
});

const FIVE_MINUTES_MS = 300_000;

/**
 * POST /api/auth/forgot-password
 *
 * Notice: Password recovery in WorkSphere is authoritatively handled on the client
 * via Clerk's native `reset_password_email_code` flow (`useSignIn()`).
 * This API endpoint serves as an auxiliary rate-limited gateway for backward
 * compatibility and headless clients, directing clients to Clerk's authoritative flow
 * while enforcing strict anti-enumeration and IP/email rate limits.
 */
export async function POST(req: NextRequest) {
  // 1. Validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = forgotPasswordSchema.safeParse(body);
  if (!validation.success) {
    const errorMsg =
      validation.error.flatten().fieldErrors.email?.[0] ?? "Validation failed.";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }

  const { email } = validation.data;

  // 2. Identify caller
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";

  const identifier = `forgot-password:${email}:${ip}`;

  // 3. Rate limit — 3 attempts per 5-minute sliding window per email+IP
  const allowed = await rateLimit(identifier, 3, FIVE_MINUTES_MS);
  if (!allowed) {
    const info = await getRateLimitInfo(identifier, 3, FIVE_MINUTES_MS);
    const retryAfter = info?.resetTime
      ? Math.ceil((info.resetTime - Date.now()) / 1000)
      : 300;

    return NextResponse.json(
      {
        error:
          "Too many password reset requests. Please wait before trying again.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": "3",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // Artificial constant-time mitigation against user enumeration
  await new Promise((resolve) => setTimeout(resolve, 50));

  return NextResponse.json(
    {
      message:
        "If an account with that email exists, a password reset code has been sent. Please complete recovery via the /reset-password page.",
      recoveryStrategy: "reset_password_email_code",
    },
    { status: 200 },
  );
}
