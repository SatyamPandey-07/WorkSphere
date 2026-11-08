import { NextRequest, NextResponse } from "next/server";
import {
  verifyMultiVenueBatchProofs,
  MultiVenueBatchVerifyRequest,
} from "@/lib/zkp/batch";

export async function POST(req: NextRequest) {
  try {
    const body: MultiVenueBatchVerifyRequest = await req.json();

    if (
      !body ||
      !Array.isArray(body.venueProofs) ||
      body.venueProofs.length === 0
    ) {
      return NextResponse.json(
        { error: "Invalid request payload. venueProofs array is required." },
        { status: 400 },
      );
    }

    const verification = await verifyMultiVenueBatchProofs(body);

    return NextResponse.json(verification, {
      status: verification.valid ? 200 : 422,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to process batch ZKP verification." },
      { status: 500 },
    );
  }
}
