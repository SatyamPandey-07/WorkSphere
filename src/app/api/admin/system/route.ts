import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import {
  getAdminSystemMetrics,
  parseSystemRange,
} from "@/lib/adminSystemMetrics";
import { measureRedisLatencyMs } from "@/lib/redisHealth";

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

    const range = parseSystemRange(request.nextUrl.searchParams.get("range"));

    const [metrics, redisHealth] = await Promise.all([
      getAdminSystemMetrics(range),
      measureRedisLatencyMs(),
    ]);

    return NextResponse.json(
      {
        ...metrics,
        redisHealth,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("[Admin System API]", error);

    return NextResponse.json(
      { error: "Failed to load system metrics" },
      { status: 500 },
    );
  }
}
