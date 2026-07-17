import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import {
  verifyCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "@/lib/csrf";

// Validation schema
const verifyOtpSchema = z.object({
  email: z.string().email("A valid email address is required."),
  otp: z
    .string()
    .min(4, "OTP must be at least 4 characters.")
    .max(8, "OTP must be at most 8 characters.")
    .regex(/^\d+$/, "OTP must contain only digits."),
});

/**
 * POST /api/auth/verify-otp
 *
 * Rate limit: 5 requests per minute per IP to prevent brute-force OTP guessing.
 * Returns HTTP 429 Too Many Requests when the threshold is exceeded.
 *
 * In production, this handler would validate the OTP against your OTP store
 * (e.g., a time-based token, a Redis key, or Clerk's verification API).
 */
export async function POST(req: NextRequest) {
  // 1. CSRF validation
  const cookieValue = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  const headerValue = req.headers.get(CSRF_HEADER_NAME);
  const csrfValid = await verifyCsrfToken(cookieValue, headerValue);
  if (!csrfValid) {
    return NextResponse.json(
      { error: "CSRF validation failed. Please refresh and try again." },
      { status: 403 },
    );
  }

  // 2. Identify the caller
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";

  const identifier = `verify-otp:${ip}`;

  // 2. Rate limit — 5 requests per 1-minute sliding window
  const allowed = await rateLimit(identifier, 5);

  if (!allowed) {
    const info = await getRateLimitInfo(identifier, 5);
    const retryAfter = info?.resetTime
      ? Math.ceil((info.resetTime - Date.now()) / 1000)
      : 60;

    return NextResponse.json(
      {
        error:
          "Too many verification attempts. Please wait before trying again.",
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

  // 3. Validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = verifyOtpSchema.safeParse(body);
  if (!validation.success) {
    const errors = validation.error.flatten().fieldErrors;
    const message =
      errors.email?.[0] ?? errors.otp?.[0] ?? "Validation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { email, otp } = validation.data;

  // 4. Verify OTP (stub — integrate with Clerk / Redis / TOTP / etc.)
  // In a real implementation:
  //   const isValid = await verifyUserOtp({ email, otp });
  //   if (!isValid) return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
  console.log(
    `[verify-otp] OTP verification attempted for: ${email}, otp: ${otp}`,
  );

  return NextResponse.json(
    { message: "Verification successful." },
    { status: 200 },
  );
}
