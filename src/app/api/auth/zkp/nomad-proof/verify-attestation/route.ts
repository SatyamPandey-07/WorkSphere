/**
 * /api/auth/zkp/nomad-proof/verify-attestation
 * Authoritative server-side route to verify a Nomad Passport stamp's cryptographic attestation.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyServerPassportStampAttestation,
  type StampAttestationVerificationInput,
} from "@/lib/zkp/stampAttestationVerification";

export async function POST(req: NextRequest) {
  try {
    const body: StampAttestationVerificationInput = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          success: false,
          status: "invalid",
          verified: false,
          error: "Invalid request body.",
        },
        { status: 400 },
      );
    }

    const result = verifyServerPassportStampAttestation(body);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error(
      "[POST /api/auth/zkp/nomad-proof/verify-attestation] Error:",
      error,
    );
    return NextResponse.json(
      {
        success: false,
        status: "invalid",
        verified: false,
        error: "Internal verification error",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
