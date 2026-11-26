import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  exportAcousticsHistoryToCSV,
  formatAcousticsHistoryFilename,
  type AcousticsHistoryRow,
  calculateQuietScore,
} from "@/lib/export/acousticsHistoryExport";

/**
 * GET /api/venues/[venueId]/acoustics/history
 *
 * Query params:
 * - format: "csv" | "json" (default: "json" unless Accept header prefers csv)
 * - limit: max rows to return (default: 500, max: 5000)
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ venueId: string }> | { venueId: string } }
) {
  try {
    const resolvedParams = await context.params;
    const venueId = resolvedParams.venueId?.trim();

    if (!venueId) {
      return NextResponse.json(
        { error: "venueId is required" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format");
    const limitRaw = Number(searchParams.get("limit") ?? "500");
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 5000)
        : 500;
    const accept = req.headers.get("accept") ?? "";

    const venue = await prisma.venue.findFirst({
      where: { OR: [{ id: venueId }, { placeId: venueId }] },
      select: { id: true, name: true },
    });

    if (!venue) {
      return NextResponse.json(
        { error: "Venue not found", code: "VENUE_NOT_FOUND" },
        { status: 404 }
      );
    }

    const ratings = await prisma.venueRating.findMany({
      where: {
        venueId: venue.id,
        OR: [{ avgDecibels: { not: null } }, { peakDecibels: { not: null } }],
      },
      select: {
        createdAt: true,
        avgDecibels: true,
        peakDecibels: true,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    const rows: AcousticsHistoryRow[] = ratings.map((r) => {
      const avg = r.avgDecibels ?? null;
      const peak =
        r.peakDecibels ?? (avg !== null ? Math.round(avg + 10) : null);
      const domFreq = 500; // typical acoustic speech/ambient center frequency
      const quiet = calculateQuietScore(avg);

      return {
        timestamp: r.createdAt.toISOString(),
        average_db: avg,
        peak_db: peak,
        dominant_frequency_hz: domFreq,
        quiet_score: quiet,
      };
    });

    const wantsCsv = format === "csv" || accept.includes("text/csv");
    if (wantsCsv) {
      const csv = exportAcousticsHistoryToCSV(rows);
      const filename = formatAcousticsHistoryFilename(venue.id);

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-cache",
        },
      });
    }

    return NextResponse.json(
      {
        venueId: venue.id,
        total: rows.length,
        history: rows,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("GET /api/venues/[venueId]/acoustics/history error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve acoustics history" },
      { status: 500 }
    );
  }
}
