import { NextRequest, NextResponse } from "next/server";
import { processMagicLinkRequest } from "@/lib/auth/emailService";

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
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json(
      {
        message: "Magic link generated successfully",
        email: result.email,
        token: result.token,
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
