import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import {
  verifyCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "@/lib/csrf";

// Validation schema
const resendOtpSchema = z.object({
  email: z.string().email("A valid email address is required."),
});

/**
 * POST /api/auth/resend-otp
 *
 * Rate limit: 3 requests per 5 minutes per email+IP to prevent OTP resend abuse.
 * Returns HTTP 429 Too Many Requests when the threshold is exceeded.
 *
 * In production, this handler would trigger your OTP delivery service
 * (e.g., Twilio, Resend, Nodemailer). Since authentication is handled
 * by Clerk, this route provides the rate-limited security layer.
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

  // 2. Validate request body (must happen before rate limiting to extract email)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = resendOtpSchema.safeParse(body);
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
  const normEmail = email.trim().toLowerCase();

  // 3. Identify the caller (prefer IP, fall back to forwarded header)
  const ip = (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous"
  ).trim() || "anonymous";

  const identifier = `resend-otp:${normEmail}:${ip}`;

  // 4. Rate limit — 3 requests per 5-minute sliding window per email+IP
  const OTP_RESEND_MAX_REQUESTS = 3;
  const OTP_RESEND_WINDOW_MS = 5 * 60 * 1000; // 300,000 ms = 5 minutes

  const allowed = await rateLimit(
    identifier,
    OTP_RESEND_MAX_REQUESTS,
    OTP_RESEND_WINDOW_MS,
  );

  if (!allowed) {
    const info = await getRateLimitInfo(
      identifier,
      OTP_RESEND_MAX_REQUESTS,
      OTP_RESEND_WINDOW_MS,
    );
    const retryAfter = Math.max(
      1,
      info?.resetTime
        ? Math.ceil((info.resetTime - Date.now()) / 1000)
        : Math.ceil(OTP_RESEND_WINDOW_MS / 1000),
    );

    return NextResponse.json(
      {
        error:
          "Too many OTP requests. Please wait before requesting a new code.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(OTP_RESEND_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // 5. Delegate to OTP service (stub — integrate with Clerk / Twilio / etc.)
  // In a real implementation:
  //   await sendOtp({ email });
  console.log(`[resend-otp] OTP resend requested for: ${email}`);

  return NextResponse.json(
    { message: "A new verification code has been sent to your email." },
    { status: 200 },
  );
}
