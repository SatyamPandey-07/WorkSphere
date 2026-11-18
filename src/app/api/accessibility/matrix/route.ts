import { NextRequest, NextResponse } from "next/server";
import {
  fetchAccessibleRoute,
  normalizeAccessibilityCoordinate,
  RoutingProviderError,
} from "@/lib/accessibility/openRouteService";

const MAX_COORDINATES = 6;
const MAX_CONCURRENT_ROUTES = 3;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!Array.isArray(body?.coordinates) || body.coordinates.length < 2 ||
        body.coordinates.length > MAX_COORDINATES) {
      return NextResponse.json(
        { error: `coordinates must contain between 2 and ${MAX_COORDINATES} points.` },
        { status: 400 },
      );
    }

    const coordinates = body.coordinates.map(normalizeAccessibilityCoordinate);
    if (coordinates.some((coordinate) => coordinate === null)) {
      return NextResponse.json(
        { error: "Every coordinate must contain a valid latitude and longitude." },
        { status: 400 },
      );
    }

    const wheelchairMode = body.wheelchairMode !== false;
    const requestedMaxGrade = Number(body.maxInclinePercent ?? 8.33);
    const maxAllowedGradePercent = Number.isFinite(requestedMaxGrade)
      ? Math.max(1, Math.min(20, requestedMaxGrade))
      : 8.33;
    const pairs: Array<{ from: number; to: number }> = [];
    for (let from = 0; from < coordinates.length; from++) {
      for (let to = 0; to < coordinates.length; to++) {
        if (from !== to) pairs.push({ from, to });
      }
    }

    const matrix: Record<string, Record<string, unknown>> = {};
    for (let index = 0; index < coordinates.length; index++) {
      matrix[index] = {
        [index]: { distance: 0, duration: 0, accessibilityScore: 100, isRecommended: true },
      };
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < pairs.length) {
        const pair = pairs[cursor++];
        const start = coordinates[pair.from]!;
        const end = coordinates[pair.to]!;
        const result = await fetchAccessibleRoute(start, end, {
          wheelchairMode,
          maxAllowedGradePercent,
        });
        matrix[pair.from][pair.to] = {
          distance: result.totalDistanceMeters,
          duration: result.evaluation.totalDuration,
          accessibilityScore: result.evaluation.accessibilityScore,
          isRecommended: result.evaluation.isRecommended,
          penaltyMultiplier: result.evaluation.penaltyMultiplier,
          warnings: result.warnings,
          dataSource: result.dataSource,
        };
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_ROUTES, pairs.length) }, () => worker()),
    );

    return NextResponse.json({
      success: true,
      matrix,
      coordinateCount: coordinates.length,
      routeCount: pairs.length,
      dataSource: "OpenRouteService",
    });
  } catch (error) {
    if (error instanceof RoutingProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[Accessibility Matrix] Routing failed:", error);
    return NextResponse.json({ error: "Unable to calculate the accessibility matrix." }, { status: 500 });
  }
}
