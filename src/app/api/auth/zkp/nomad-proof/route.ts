/**
 * route.ts
 * /api/auth/zkp/nomad-proof
 * Verifies Zero-Knowledge Productivity Proofs and mints signed Digital Nomad Passport Stamps.
 */

import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyAndMintNomadPassportStamp,
  type ZkNomadProofPayload,
} from "@/lib/zkp/nomadProof";
import { invalidateXpLeaderboard } from "@/lib/leaderboards/xpLeaderboard";

export async function POST(req: NextRequest) {
  try {
    // Derive the account identity exclusively from the authenticated session.
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ZkNomadProofPayload = await req.json();

    if (!body || !body.statement || !body.proof) {
      return NextResponse.json(
        { error: "Invalid request. ZK proof and statement are required." },
        { status: 400 },
      );
    }

    const verification = verifyAndMintNomadPassportStamp(body);

    if (!verification.isValid || !verification.stamp) {
      return NextResponse.json(
        { error: verification.error || "Proof verification failed" },
        { status: 400 },
      );
    }

    // Award the badge only to the account authenticated by Clerk.
    // Persistence failures propagate to the outer catch and prevent false success.
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

    await invalidateXpLeaderboard();

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
      { status: 500 },
    );
  }
}
