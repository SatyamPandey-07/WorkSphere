import { NextRequest, NextResponse } from "next/server";
import {
  verifyBatchStudentDiscountProofs,
  BatchStudentDiscountRequest,
} from "@/lib/zkp/batch";

/**
 * POST /api/user/verify-student/batch
 *
 * Verifies a batch of zero-knowledge student discount credentials in parallel,
 * performing Merkle root validation, nullifier replay check, and Groth16 cryptographic verification.
 */
export async function POST(req: NextRequest) {
  try {
    const body: BatchStudentDiscountRequest = await req.json();

    const items = body?.items || body?.studentProofs;

    if (!body || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        {
          error: "Invalid request payload. 'items' or 'studentProofs' array is required.",
        },
        { status: 400 },
      );
    }

    const verification = await verifyBatchStudentDiscountProofs(body);

    return NextResponse.json(verification, {
      status: verification.valid ? 200 : 207, // 207 Multi-Status if partial failure, 200 if all valid
    });
  } catch (err: any) {
    console.error("[BATCH_STUDENT_DISCOUNT_VERIFY_ERROR]", err);
    return NextResponse.json(
      {
        error:
          err?.message ||
          "Failed to process batch student discount verification.",
      },
      { status: 500 },
    );
  }
}
