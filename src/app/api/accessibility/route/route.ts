import { NextRequest, NextResponse } from "next/server";
import {
  fetchAccessibleRoute,
  normalizeAccessibilityCoordinate,
  RoutingProviderError,
} from "@/lib/accessibility/openRouteService";

function readMobilityProfile(value: unknown): {
  wheelchairMode: boolean;
  maxAllowedGradePercent: number;
} {
  const profile = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const max = Number(profile.maxInclinePercent ?? profile.maxAllowedGradePercent ?? 8.33);
  return {
    wheelchairMode: profile.wheelchairMode !== false && profile.type !== "walking",
    maxAllowedGradePercent: Number.isFinite(max) ? Math.max(1, Math.min(20, max)) : 8.33,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const venueId = typeof body?.venueId === "string" ? body.venueId : null;
    const start = normalizeAccessibilityCoordinate(body?.startCoords);
    const end = normalizeAccessibilityCoordinate(body?.endCoords);
    if (!venueId || !start || !end || !body?.mobilityProfile) {
      return NextResponse.json(
        { error: "A venueId, valid startCoords/endCoords, and mobilityProfile are required." },
        { status: 400 },
      );
    }

    const profile = readMobilityProfile(body.mobilityProfile);
    const result = await fetchAccessibleRoute(start, end, profile);

    return NextResponse.json({
      success: true,
      venueId,
      route: {
        path: result.geometry,
        totalDistanceMeters: result.totalDistanceMeters,
        totalDurationSeconds: result.totalDurationSeconds,
        accessibilityScore: result.evaluation.accessibilityScore,
        isRecommended: result.evaluation.isRecommended,
        penaltyMultiplier: result.evaluation.penaltyMultiplier,
        warnings: result.warnings,
        navigationCues: result.evaluation.cues,
      },
      barriers: result.barriers,
      dataSource: result.dataSource,
    });
  } catch (error) {
    if (error instanceof RoutingProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[Accessibility API] Routing failed:", error);
    return NextResponse.json({ error: "Unable to calculate an accessible route." }, { status: 500 });
  }
}
