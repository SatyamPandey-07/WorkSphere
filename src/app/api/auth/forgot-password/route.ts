import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

// Validation schema
const forgotPasswordSchema = z.object({
  email: z.string().email("A valid email address is required."),
});

/**
 * POST /api/auth/forgot-password
 *
 * Rate limit: 3 requests per minute per IP to prevent email spam
 * and account enumeration attacks.
 * Returns HTTP 429 Too Many Requests when the threshold is exceeded.
 *
 * SECURITY NOTE: Always returns a generic 200 success regardless of whether
 * the email exists in the database. This prevents account enumeration attacks
 * where an attacker could probe for valid emails.
 */
export async function POST(req: NextRequest) {
  // 1. Identify the caller
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";

  const identifier = `forgot-password:${ip}`;

  // 2. Rate limit — 3 requests per 1-minute sliding window
  const allowed = await rateLimit(identifier, 3);

  if (!allowed) {
    const info = await getRateLimitInfo(identifier, 3);
    const retryAfter = info?.resetTime
      ? Math.ceil((info.resetTime - Date.now()) / 1000)
      : 60;

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

  // 3. Validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = forgotPasswordSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        error:
          validation.error.format().email?._errors[0] ?? "Validation failed.",
      },
      { status: 400 },
    );
  }

  const { email } = validation.data;

  // 4. Trigger password reset (stub — integrate with Clerk / Nodemailer / etc.)
  // In a real implementation:
  //   const user = await prisma.user.findUnique({ where: { email } });
  //   if (user) await sendPasswordResetEmail({ email, token: generateToken() });
  //   (Always return 200 regardless of whether the user exists — no enumeration)
  console.log(`[forgot-password] Password reset requested for: ${email}`);

  return NextResponse.json(
    {
      message:
        "If an account with that email exists, a password reset link has been sent.",
    },
    { status: 200 },
  );
}
