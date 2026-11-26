import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  verifyTeamPassAttestationSignature,
  type TeamPassAttestationPayload,
} from "@/lib/security/teamPassAttestation";

const AttestationPayloadSchema = z.object({
  attestationId: z.string().min(1).max(512),
  venueId: z.string().min(1).max(512),
  memberId: z.string().min(1).max(512),
  nonce: z.string().min(1).max(512),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const AttestationSchema = z.object({
  payload: AttestationPayloadSchema,
  signature: z.string().min(1).max(512),
});

const BatchSchema = z.object({
  attestations: z.array(z.unknown()).min(1).max(50),
});

type RouteContext = {
  params: Promise<{ venueId: string }> | { venueId: string };
};

type VerificationStatus =
  | "verified"
  | "invalid_attestation"
  | "invalid_signature"
  | "expired"
  | "replayed";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { userId, sessionClaims } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { venueId } = await Promise.resolve(context.params);

    if (!venueId) {
      return NextResponse.json(
        { error: "Venue ID is required" },
        { status: 400 },
      );
    }

    const venue = await prisma.venue.findFirst({
      where: { OR: [{ id: venueId }, { placeId: venueId }] },
      select: { id: true, ownerId: true, creatorId: true },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    const role = (
      (sessionClaims?.metadata as Record<string, any>)?.role ||
      (sessionClaims as Record<string, any>)?.role ||
      (sessionClaims as Record<string, any>)?.org_role
    )?.toLowerCase();

    const isVenueManager =
      venue.ownerId === userId ||
      venue.creatorId === userId ||
      role === "manager" ||
      role === "venue_manager" ||
      role === "admin" ||
      role === "super_admin";

    if (!isVenueManager) {
      return NextResponse.json(
        { error: "Forbidden: Venue manager access required" },
        { status: 403 },
      );
    }

    const secret = process.env.TEAM_PASS_ATTESTATION_SECRET;

    if (!secret || secret.length < 32) {
      console.error("[TeamPassAttestation] Missing or weak signing secret");
      return NextResponse.json(
        { error: "Attestation verification is not configured" },
        { status: 503 },
      );
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const batch = BatchSchema.safeParse(body);

    if (!batch.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: batch.error.flatten(),
        },
        { status: 400 },
      );
    }

    const now = new Date();

    const results = await Promise.all(
      batch.data.attestations.map(async (item, index) => {
        const parsed = AttestationSchema.safeParse(item);

        if (!parsed.success) {
          return {
            index,
            status: "invalid_attestation" as VerificationStatus,
          };
        }

        const { payload, signature } = parsed.data;

        if (payload.venueId !== venue.id) {
          return {
            index,
            attestationId: payload.attestationId,
            status: "invalid_attestation" as VerificationStatus,
          };
        }

        const issuedAt = new Date(payload.issuedAt);
        const expiresAt = new Date(payload.expiresAt);

        if (
          !Number.isFinite(issuedAt.getTime()) ||
          !Number.isFinite(expiresAt.getTime()) ||
          expiresAt <= issuedAt ||
          issuedAt > now
        ) {
          return {
            index,
            attestationId: payload.attestationId,
            status: "invalid_attestation" as VerificationStatus,
          };
        }

        if (expiresAt <= now) {
          return {
            index,
            attestationId: payload.attestationId,
            status: "expired" as VerificationStatus,
          };
        }

        const validSignature = verifyTeamPassAttestationSignature(
          payload as TeamPassAttestationPayload,
          signature,
          secret,
        );

        if (!validSignature) {
          return {
            index,
            attestationId: payload.attestationId,
            status: "invalid_signature" as VerificationStatus,
          };
        }

        try {
          await prisma.teamPassAttestationNonce.create({
            data: {
              nonce: payload.nonce,
              venueId: venue.id,
              attestationId: payload.attestationId,
              memberId: payload.memberId,
              expiresAt,
            },
          });

          return {
            index,
            attestationId: payload.attestationId,
            status: "verified" as VerificationStatus,
          };
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            return {
              index,
              attestationId: payload.attestationId,
              status: "replayed" as VerificationStatus,
            };
          }

          throw error;
        }
      }),
    );

    const verifiedCount = results.filter(
      (result) => result.status === "verified",
    ).length;
    const failedCount = results.length - verifiedCount;

    return NextResponse.json({
      success: true,
      total: results.length,
      verified: verifiedCount,
      verifiedCount,
      failedCount,
      results,
    });
  } catch (error) {
    console.error("[TeamPassAttestation] Batch verification failed:", error);

    return NextResponse.json(
      { error: "Batch attestation verification failed" },
      { status: 500 },
    );
  }
}
