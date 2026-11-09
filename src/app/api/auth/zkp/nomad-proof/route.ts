/**
 * route.ts
 * /api/auth/zkp/nomad-proof
 * Verifies Zero-Knowledge Productivity Proofs and mints signed Digital Nomad Passport Stamps.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyAndMintNomadPassportStamp,
  type ZkNomadProofPayload,
} from "@/lib/zkp/nomadProof";

export async function POST(req: NextRequest) {
  try {
    const body: ZkNomadProofPayload & { userId?: string } = await req.json();

    if (!body || !body.statement || !body.proof) {
      return NextResponse.json(
        { error: "Invalid request. ZK proof and statement are required." },
        { status: 400 }
      );
    }

    const verification = verifyAndMintNomadPassportStamp(body);

    if (!verification.isValid || !verification.stamp) {
      return NextResponse.json(
        { error: verification.error || "Proof verification failed" },
        { status: 400 }
      );
    }

    const userId = body.userId || "user_demo_nomad";

    // Award badge in database if user exists
    try {
      await prisma.userBadge.upsert({
        where: {
          userId_badgeType: {
            userId,
            badgeType: verification.stamp.badgeType,
          },
        },
        create: {
          userId,
          badgeType: verification.stamp.badgeType,
        },
        update: {
          awardedAt: new Date(),
        },
      });
    } catch (dbErr) {
      // User may be anonymous / mock in demo mode
    }

    return NextResponse.json({
      success: true,
      verified: true,
      message: "Zero-Knowledge Proof verified! Passport stamp unlocked.",
      stamp: verification.stamp,
    });
  } catch (error: any) {
    console.error("[POST /api/auth/zkp/nomad-proof] Error:", error);
    return NextResponse.json(
      { error: "Internal ZKP verification error", details: error.message },
      { status: 500 }
    );
  }
}
