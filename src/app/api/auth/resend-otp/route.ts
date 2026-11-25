import { NextRequest, NextResponse } from "next/server";

const RETIRED_RESPONSE = {
  error:
    "This endpoint has been retired. WorkSphere utilizes Clerk's native password reset and verification flow.",
  code: "ENDPOINT_RETIRED",
};

/**
 * POST /api/auth/resend-otp
 *
 * Retired: WorkSphere uses Clerk's native password reset and email verification flows.
 * Always returns HTTP 410 Gone.
 */
export async function POST(_req?: NextRequest) {
  return NextResponse.json(RETIRED_RESPONSE, { status: 410 });
}

/**
 * GET /api/auth/resend-otp
 *
 * Retired: WorkSphere uses Clerk's native password reset and email verification flows.
 * Always returns HTTP 410 Gone.
 */
export async function GET(_req?: NextRequest) {
  return NextResponse.json(RETIRED_RESPONSE, { status: 410 });
}
