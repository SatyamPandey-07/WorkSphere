import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

// Validation schema
const resetPasswordSchema = z.object({
  token: z
    .string()
    .min(16, "Reset token is too short.")
    .max(512, "Reset token is too long."),
  newPassword: z
    .string()
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
 * Rate limit: 5 requests per minute per IP to prevent token brute-force
 * and password reset spam attacks.
 * Returns HTTP 429 Too Many Requests when the threshold is exceeded.
 *
 * In production, this handler would validate the reset token against your
 * token store (e.g., a signed JWT, a Redis key, or Clerk's password reset API)
 * and update the user's password in the database.
 */
export async function POST(req: NextRequest) {
  // 1. Identify the caller
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous";

  const identifier = `reset-password:${ip}`;

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

  // 3. Validate request body
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
      errors.token?.[0] ?? errors.newPassword?.[0] ?? "Validation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { token, newPassword } = validation.data;

  // 4. Reset password (stub — integrate with Clerk / Prisma / etc.)
  // In a real implementation:
  //   const userId = await verifyResetToken(token);
  //   if (!userId) return NextResponse.json({ error: "Invalid or expired reset token." }, { status: 400 });
  //   await prisma.user.update({ where: { id: userId }, data: { password: await hashPassword(newPassword) } });
  //   await invalidateResetToken(token);
  console.log(
    `[reset-password] Password reset attempted with token: ${token.slice(0, 8)}..., new password length: ${newPassword.length}`,
  );

  return NextResponse.json(
    { message: "Your password has been reset successfully." },
    { status: 200 },
  );
}
