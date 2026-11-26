import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createNomadProofChallenge,
  verifyAndMintNomadPassportStamp,
  type NomadActivityCounters,
} from "@/lib/zkp/nomadProofVerification";
import {
  NOMAD_BADGE_POLICIES,
  type ClaimableNomadBadgeType,
} from "@/lib/zkp/nomadProof";
import { invalidateXpLeaderboard } from "@/lib/leaderboards/xpLeaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOMAD_VERIFICATION_BADGE_TYPES: ClaimableNomadBadgeType[] =
  Object.values(NOMAD_BADGE_POLICIES).map((policy) => policy.badgeType);

type RequestBody = {
  action?: unknown;
  badgeType?: unknown;
  proof?: unknown;
  publicSignals?: unknown;
};

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, verified: false, error: "Unauthorized" },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }

    const badges = await prisma.userBadge.findMany({
      where: {
        userId,
        badgeType: {
          in: NOMAD_VERIFICATION_BADGE_TYPES,
        },
      },
      select: {
        badgeType: true,
      },
      take: 1,
    });

    return NextResponse.json(
      {
        success: true,
        verified: badges.length > 0,
      },
      {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  } catch (error) {
    console.error("[GET /api/auth/zkp/nomad-proof] Error:", error);
    return NextResponse.json(
      {
        success: false,
        verified: false,
        error: "Unable to read verification status.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: RequestBody = await req.json().catch(() => ({}));

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid Nomad proof request." },
        { status: 400 },
      );
    }

    if (body.action !== "challenge" && body.action !== "verify") {
      return NextResponse.json(
        { error: "Unsupported Nomad proof action." },
        { status: 400 },
      );
    }

    // Re-read activity from Prisma for both challenge and verification.
    // Never trust client-submitted activity counters or identity fields.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentStreak: true,
        totalDeepWorkMinutes: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const activity: NomadActivityCounters = user;

    if (body.action === "challenge") {
      const result = createNomadProofChallenge(
        userId,
        body.badgeType,
        activity,
      );

      if (!result.ok) {
        return NextResponse.json(
          {
            success: false,
            code: result.code,
            error: result.error,
          },
          { status: result.status },
        );
      }

      return NextResponse.json({
        success: true,
        challenge: result.challenge,
      });
    }

    const verification = await verifyAndMintNomadPassportStamp(
      userId,
      body.badgeType,
      {
        proof: body.proof,
        publicSignals: body.publicSignals,
      },
      activity,
    );

    if (!verification.isValid) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          code: verification.code,
          error: verification.error,
        },
        { status: verification.status },
      );
    }

    // Badge persistence occurs only after successful Groth16 pairing verification.
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
      message: "Nomad Groth16 proof verified. Passport stamp unlocked.",
      stamp: verification.stamp,
    });
  } catch (error) {
    console.error("[POST /api/auth/zkp/nomad-proof] Error:", error);

    return NextResponse.json(
      { error: "Internal Nomad proof verification error." },
      { status: 500 },
    );
  }
}
