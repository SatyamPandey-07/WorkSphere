import { NextRequest, NextResponse } from "next/server";
import {
  processMagicLinkRequest,
  verifyMagicLinkToken,
} from "@/lib/auth/emailService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email field is required and must be a string" },
        { status: 400 },
      );
    }

    const result = await processMagicLinkRequest(email);

    if (!result.success) {
      const isRateLimit = result.error?.includes(
        "Too many magic link requests",
      );
      return NextResponse.json(
        { error: result.error },
        { status: isRateLimit ? 429 : 422 },
      );
    }

    // Do NOT return the raw authentication token in the response
    return NextResponse.json(
      {
        message: "If this email is registered, a magic link has been sent.",
        email: result.email,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Verification token is required" },
        { status: 400 },
      );
    }

    const result = await verifyMagicLinkToken(token);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Verification failed" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        message: "Magic link verified successfully",
        email: result.email,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 },
    );
  }
}
