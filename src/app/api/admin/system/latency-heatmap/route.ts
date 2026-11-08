import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { getRouteLatencyHeatmapData } from "@/lib/telemetry/collectors/performanceCollector";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();

    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const rangeParam = searchParams.get("range");
    const range: "1h" | "24h" | "7d" =
      rangeParam === "24h" || rangeParam === "7d" ? rangeParam : "1h";

    const heatmapData = await getRouteLatencyHeatmapData(range);

    return NextResponse.json(heatmapData, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Admin Latency Heatmap API]", error);

    return NextResponse.json(
      { error: "Failed to generate route latency heatmap" },
      { status: 500 },
    );
  }
}
