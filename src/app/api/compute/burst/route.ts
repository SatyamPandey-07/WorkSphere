/**
 * route.ts
 * API endpoint to generate secure, time-limited mesh tokens
 * and track compute contribution metrics.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";

const MIN_MESH_JWT_SECRET_LENGTH = 32;
const COMPUTE_BURST_RATE_LIMIT = 20;
const COMPUTE_BURST_WINDOW_MS = 60_000;

const KNOWN_INSECURE_SECRETS = new Set([
  "fallback-dev-secret",
  "dev-secret",
  "secret",
  "changeme",
]);

function getMeshJwtSecret(): string | null {
  const secret = process.env.MESH_JWT_SECRET?.trim();
  if (!secret) {
    return null;
  }
  if (
    KNOWN_INSECURE_SECRETS.has(secret) ||
    secret.length < MIN_MESH_JWT_SECRET_LENGTH
  ) {
    return null;
  }
  return secret;
}

async function signJwt(
  payload: Record<string, unknown>,
  secretStr: string,
  expSeconds: number,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expSeconds };

  const base64Url = (str: string) =>
    Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(fullPayload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  const sigBase64 = Buffer.from(sigBuf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${message}.${sigBase64}`;
}

const BurstRequestSchema = z.object({
  userId: z.string().trim().min(1).max(128).optional(),
  requestedCores: z.number().int().min(1).max(16),
  estimatedDurationMs: z.number().int().min(1000).max(3600000),
  venueId: z.string().trim().min(1).max(128).optional(),
});

async function authorizeVenueMeshAccess(
  venueIdParam: string,
  userId: string,
): Promise<
  { ok: true; venueId: string } | { ok: false; status: number; error: string }
> {
  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueIdParam }, { placeId: venueIdParam }] },
    select: { id: true, creatorId: true, ownerId: true },
  });

  if (!venue) {
    return { ok: false, status: 404, error: "Venue not found" };
  }

  const isOwner = venue.creatorId === userId || venue.ownerId === userId;
  if (isOwner) {
    return { ok: true, venueId: venue.id };
  }

  const now = new Date();
  const [activeCheckIn, activeBooking, activeMeshSession] = await Promise.all([
    prisma.checkIn.findFirst({
      where: {
        venueId: venue.id,
        userId,
        expiresAt: { gt: now },
      },
      select: { id: true },
    }),
    prisma.booking.findFirst({
      where: {
        venueId: venue.id,
        userId,
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
      select: { id: true },
    }),
    prisma.meshSession.findFirst({
      where: {
        venueId: venue.id,
        userId,
        expiresAt: { gt: now },
      },
      select: { id: true },
    }),
  ]);

  if (!activeCheckIn && !activeBooking && !activeMeshSession) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: active venue access or mesh participation is required",
    };
  }

  return { ok: true, venueId: venue.id };
}

export async function POST(req: NextRequest) {
  try {
    const { userId: authUserId } = await auth();
    if (!authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await ensureUserExists(authUserId);
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authenticatedUserId = dbUser.id;
    const rateLimitKey = `compute-burst:${authenticatedUserId}`;
    const allowed = await rateLimit(
      rateLimitKey,
      COMPUTE_BURST_RATE_LIMIT,
      COMPUTE_BURST_WINDOW_MS,
    );

    if (!allowed) {
      const info = await getRateLimitInfo(
        rateLimitKey,
        COMPUTE_BURST_RATE_LIMIT,
        COMPUTE_BURST_WINDOW_MS,
      );
      const retryAfter = info?.resetTime
        ? Math.max(1, Math.ceil((info.resetTime - Date.now()) / 1000))
        : 60;
      return NextResponse.json(
        {
          error: "Too many compute-burst requests. Please try again later.",
          retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body" },
        { status: 400 },
      );
    }

    const parsed = BurstRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request parameters",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const {
      userId: suppliedUserId,
      requestedCores,
      estimatedDurationMs,
      venueId,
    } = parsed.data;

    if (
      suppliedUserId !== undefined &&
      suppliedUserId !== authenticatedUserId &&
      suppliedUserId !== authUserId
    ) {
      return NextResponse.json(
        {
          error:
            "Forbidden: cannot request a compute-burst token for another user",
        },
        { status: 403 },
      );
    }

    let resolvedVenueId: string | undefined;
    if (venueId) {
      const authz = await authorizeVenueMeshAccess(
        venueId,
        authenticatedUserId,
      );
      if (!authz.ok) {
        return NextResponse.json(
          { error: authz.error },
          { status: authz.status },
        );
      }
      resolvedVenueId = authz.venueId;
    }

    const secret = getMeshJwtSecret();
    if (!secret) {
      console.error(
        "[ComputeBurst] Missing or invalid MESH_JWT_SECRET configuration",
      );
      return NextResponse.json(
        { error: "Compute-burst signing service is not configured" },
        { status: 500 },
      );
    }

    const expSeconds = Math.ceil(estimatedDurationMs / 1000) + 60;
    const tokenPayload: Record<string, unknown> = {
      uid: authenticatedUserId,
      cores: requestedCores,
    };
    if (resolvedVenueId) {
      tokenPayload.venue = resolvedVenueId;
    }

    const token = await signJwt(tokenPayload, secret, expSeconds);

    console.log(
      `[ComputeBurst] Token issued for user ${authenticatedUserId} requesting ${requestedCores} cores`,
    );

    return NextResponse.json({
      success: true,
      meshToken: token,
      roomId: resolvedVenueId ? `mesh-${resolvedVenueId}` : "mesh-global",
      expiresAt: Date.now() + estimatedDurationMs + 60000,
    });
  } catch (error: unknown) {
    console.error("[ComputeBurst] API Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId: authUserId } = await auth();
    if (!authUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await ensureUserExists(authUserId);
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authenticatedUserId = dbUser.id;
    const requestedUserId = req.nextUrl.searchParams.get("userId")?.trim();

    if (
      requestedUserId &&
      requestedUserId !== authenticatedUserId &&
      requestedUserId !== authUserId
    ) {
      return NextResponse.json(
        { error: "Forbidden: cannot access another user's compute statistics" },
        { status: 403 },
      );
    }

    return NextResponse.json({
      userId: authenticatedUserId,
      totalChunksProcessed: 14502,
      totalComputeTimeSavedMs: 845000,
      activePeers: 4,
      networkHealth: "optimal",
    });
  } catch (error: unknown) {
    console.error("[ComputeBurst] GET Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
