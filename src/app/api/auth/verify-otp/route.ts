import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify-otp
 *
 * RETIRED: This legacy standalone OTP verification endpoint has been retired (HTTP 410 Gone).
 * WorkSphere utilizes Clerk's native password recovery and multi-factor verification flows
 * (e.g., signIn.attemptFirstFactor with strategy "reset_password_email_code" on /reset-password).
 * No standalone or unauthenticated OTP verification is accepted or performed here.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error:
        "This legacy OTP verification endpoint has been retired. Password recovery and code verification are managed natively by Clerk.",
      code: "ENDPOINT_RETIRED",
    },
    { status: 410 },
  );
}

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      error:
        "This legacy OTP verification endpoint has been retired. Password recovery and code verification are managed natively by Clerk.",
      code: "ENDPOINT_RETIRED",
    },
    { status: 410 },
  );
}
