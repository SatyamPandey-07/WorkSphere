import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

const resetPasswordSchema = z.object({
  code: z
    .string({ message: "Verification code is required." })
    .min(4, "Verification code is required.")
    .max(16, "Verification code is invalid."),
  newPassword: z
    .string({ message: "Password must be at least 8 characters long." })
    .min(8, "Password must be at least 8 characters long.")
    .max(128, "Password must be at most 128 characters long.")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number.",
    ),
});

/**
 * POST /api/auth/reset-password
 *
 * Notice: Password resets in WorkSphere are authoritatively completed client-side
 * with Clerk's native `reset_password_email_code` flow (`signIn.attemptFirstFactor()`).
 * This endpoint provides validation and instructions for clients attempting direct API calls,
 * ensuring no competing password storage or mock user updates exist on the server.
 */
export async function POST(req: NextRequest) {
  // 1. Identify caller & apply rate limiting
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";

  const identifier = `reset-password:${ip}`;
  const allowed = await rateLimit(identifier, 5);

  if (!allowed) {
    const info = await getRateLimitInfo(identifier, 5);
    const retryAfter = info?.resetTime
      ? Math.ceil((info.resetTime - Date.now()) / 1000)
      : 60;

    return NextResponse.json(
      {
        error:
          "Too many password reset attempts. Please wait before trying again.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // 2. Validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = resetPasswordSchema.safeParse(body);
  if (!validation.success) {
    const errors = validation.error.flatten().fieldErrors;
    const message =
      errors.code?.[0] ?? errors.newPassword?.[0] ?? "Validation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(
    {
      message:
        "Please complete password reset on the frontend at /reset-password using Clerk's authoritative email verification code flow.",
      authProvider: "clerk",
    },
    { status: 200 },
  );
}
