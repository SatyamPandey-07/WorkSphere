import { NextResponse } from "next/server";
import { getPublicJwks } from "@/lib/security/keyRotation";

/**
 * GET /api/security/offline-passcards/keys
 * Returns the public verification keys as a JWKS JSON object.
 * Caching headers are set for up-to-24h freshness.
 */
export async function GET() {
  try {
    const keys = getPublicJwks();
    return NextResponse.json(
      { keys },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error("[offline-passcards/keys] Configuration error:", error);
    return NextResponse.json(
      { error: "Public verification keys unavailable" },
      { status: 500 },
    );
  }
}
