import { NextRequest, NextResponse } from "next/server";
import {
  verifyReservationReceipt,
  signReservationReceipt,
  ReservationReceiptPayload,
  SignatureAlgorithm,
} from "@/lib/crypto/receiptSigner";

export const dynamic = "force-dynamic";

/**
 * POST /api/receipts/verify
 * Cryptographically verifies an RSA-2048 or ECDSA-P256 signature for a reservation receipt.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payload, signature, publicKeyPem, algorithm = "RSA-SHA256" } = body;

    if (!payload || !signature) {
      return NextResponse.json(
        { valid: false, error: "Missing required receipt payload or signature" },
        { status: 400 }
      );
    }

    // If publicKeyPem is provided, verify against that public key, otherwise use authority public key
    const result = verifyReservationReceipt(
      payload as ReservationReceiptPayload,
      signature,
      publicKeyPem || signReservationReceipt(payload).publicKeyPem,
      algorithm as SignatureAlgorithm
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    console.error("[Receipt Signature Verification Error]:", error);
    return NextResponse.json(
      {
        valid: false,
        error: error instanceof Error ? error.message : "Internal verification error",
      },
      { status: 500 }
    );
  }
}
