import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { getPerformanceSummary } from "@/lib/performanceTelemetry";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const admin = await getAdminUser();

    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const summary = await getPerformanceSummary();

    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Admin Performance API]", error);

    return NextResponse.json(
      { error: "Failed to load performance metrics" },
      { status: 500 },
    );
  }
}
