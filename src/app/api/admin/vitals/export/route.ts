import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { createTelemetryCsvStream } from "@/lib/export/domain/systemVitalsExporter";

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
    const range = searchParams.get("range") || "7d";
    const venueId = searchParams.get("venueId") || undefined;
    const batchSizeParam = searchParams.get("batchSize");
    const batchSize = batchSizeParam ? parseInt(batchSizeParam, 10) : 1000;

    const stream = createTelemetryCsvStream({
      range,
      venueId,
      batchSize: isNaN(batchSize) ? 1000 : batchSize,
    });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `worksphere-system-vitals-${range}-${today}.csv`;

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Transfer-Encoding": "chunked",
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Admin Web Vitals CSV Export API]", error);
    return NextResponse.json(
      { error: "Failed to export web vitals CSV" },
      { status: 500 },
    );
  }
}
