/**
 * route.ts
 * API endpoint to generate secure, time-limited mesh tokens
 * and track compute contribution metrics.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

async function signJwt(
  payload: Record<string, any>,
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
  userId: z.string().uuid(),
  requestedCores: z.number().int().min(1).max(16),
  estimatedDurationMs: z.number().int().min(1000).max(3600000),
  venueId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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

    const { userId, requestedCores, estimatedDurationMs, venueId } =
      parsed.data;

    // Generate a secure, time-limited JWT for the mesh network
    const secret = process.env.MESH_JWT_SECRET || "fallback-dev-secret";
    const expSeconds = Math.ceil(estimatedDurationMs / 1000) + 60; // Add 60s buffer

    const token = await signJwt(
      {
        uid: userId,
        cores: requestedCores,
        venue: venueId,
      },
      secret,
      expSeconds,
    );

    // Log metrics (in production, this would go to a telemetry database)
    console.log(
      `[ComputeBurst] Token issued for user ${userId} requesting ${requestedCores} cores`,
    );

    return NextResponse.json({
      success: true,
      meshToken: token,
      roomId: venueId ? `mesh-${venueId}` : `mesh-global`,
      expiresAt: Date.now() + estimatedDurationMs + 60000,
    });
  } catch (error: any) {
    console.error("[ComputeBurst] API Error:", error);
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  // Endpoint to fetch current mesh statistics for the dashboard
  const userId = req.nextUrl.searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Mocked metrics response
  return NextResponse.json({
    userId,
    totalChunksProcessed: 14502,
    totalComputeTimeSavedMs: 845000,
    activePeers: 4,
    networkHealth: "optimal",
  });
}
