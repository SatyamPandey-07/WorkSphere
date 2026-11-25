import { NextResponse } from "next/server";

const RETIRED_RESPONSE = {
  error:
    "This endpoint has been retired. WorkSphere utilizes Clerk's native session management.",
  code: "ENDPOINT_RETIRED",
};

/**
 * POST /api/auth/session/logout
 *
 * Retired: WorkSphere delegates session lifecycle and sign-out to Clerk.
 * Always returns HTTP 410 Gone.
 */
export async function POST() {
  return NextResponse.json(RETIRED_RESPONSE, { status: 410 });
}

/**
 * GET /api/auth/session/logout
 *
 * Retired: WorkSphere delegates session lifecycle and sign-out to Clerk.
 * Always returns HTTP 410 Gone.
 */
export async function GET() {
  return NextResponse.json(RETIRED_RESPONSE, { status: 410 });
}
