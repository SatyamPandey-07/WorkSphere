import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import {
  getAdminAnalytics,
  parseAnalyticsRange,
} from "@/lib/adminAnalytics";

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

    const range = parseAnalyticsRange(
      request.nextUrl.searchParams.get("range"),
    );

    const analytics = await getAdminAnalytics(range);

    return NextResponse.json(analytics, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Admin Analytics API]", error);

    return NextResponse.json(
      { error: "Failed to load admin analytics" },
      { status: 500 },
    );
  }
}
