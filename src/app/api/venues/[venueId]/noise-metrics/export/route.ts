import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import {
  createDateFilterErrorResponse,
  parseBookingDateFilter,
} from "@/lib/validations/dateFilter";
import { buildNoiseMetricRows, iterateNoiseMetricsCsv } from "@/lib/export/csvExporter";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Window used when the caller gives no startDate. */
export const DEFAULT_EXPORT_RANGE_DAYS = 30;
export const MAX_EXPORT_RANGE_DAYS = 366;
/** Upper bound per data source so one request cannot read the whole table. */
export const MAX_ROWS_PER_SOURCE = 20_000;
const LINES_PER_CHUNK = 500;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/venues/[venueId]/noise-metrics/export?startDate=&endDate=
 *
 * Streams historical noise (avg/peak dB), crowd density and WiFi latency as an
 * RFC 4180 CSV attachment. A date-only endDate includes that whole UTC day.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const { venueId } = await params;
    const searchParams = req.nextUrl.searchParams;

    const parsed = parseBookingDateFilter(searchParams);
    if (!parsed.success) {
      return parsed.response;
    }

    const rawEnd = searchParams.get("endDate") || searchParams.get("to");
    let end = parsed.data.endDateUtc ? new Date(parsed.data.endDateUtc) : new Date();
    if (rawEnd && DATE_ONLY.test(rawEnd.trim())) {
      end = new Date(end.getTime() + MS_PER_DAY - 1);
    }
    const start = parsed.data.startDateUtc
      ? new Date(parsed.data.startDateUtc)
      : new Date(end.getTime() - DEFAULT_EXPORT_RANGE_DAYS * MS_PER_DAY);

    if (start.getTime() > end.getTime()) {
      return createDateFilterErrorResponse([
        { field: "startDate", issue: "startDate must be before or equal to endDate" },
      ]);
    }
    if (end.getTime() - start.getTime() > MAX_EXPORT_RANGE_DAYS * MS_PER_DAY) {
      return createDateFilterErrorResponse([
        {
          field: "endDate",
          issue: `Date range cannot exceed ${MAX_EXPORT_RANGE_DAYS} days`,
        },
      ]);
    }

    const venue = await prisma.venue.findFirst({
      where: { OR: [{ id: venueId }, { placeId: venueId }] },
      select: { id: true },
    });
    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const [readings, wifiSamples] = await Promise.all([
      prisma.venueRating.findMany({
        where: {
          venueId: venue.id,
          createdAt: { gte: start, lte: end },
          OR: [{ avgDecibels: { not: null } }, { peakDecibels: { not: null } }],
        },
        select: { createdAt: true, avgDecibels: true, peakDecibels: true },
        orderBy: { createdAt: "asc" },
        take: MAX_ROWS_PER_SOURCE + 1,
      }),
      prisma.wifiTelemetry.findMany({
        where: { venueId: venue.id, timestamp: { gte: start, lte: end } },
        select: { timestamp: true, latency: true, crowdLevel: true },
        orderBy: { timestamp: "asc" },
        take: MAX_ROWS_PER_SOURCE + 1,
      }),
    ]);

    const truncated =
      readings.length > MAX_ROWS_PER_SOURCE || wifiSamples.length > MAX_ROWS_PER_SOURCE;

    const rows = buildNoiseMetricRows(
      venue.id,
      readings.slice(0, MAX_ROWS_PER_SOURCE),
      wifiSamples.slice(0, MAX_ROWS_PER_SOURCE),
    );

    const lines = iterateNoiseMetricsCsv(rows);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        let chunk = "";
        for (let i = 0; i < LINES_PER_CHUNK; i++) {
          const next = lines.next();
          if (next.done) {
            if (chunk) controller.enqueue(encoder.encode(chunk));
            controller.close();
            return;
          }
          chunk += next.value;
        }
        controller.enqueue(encoder.encode(chunk));
      },
    });

    const safeId = venue.id.replace(/[^A-Za-z0-9_-]/g, "_");
    const headers: Record<string, string> = {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="venue-${safeId}-noise-metrics.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (truncated) headers["X-Export-Truncated"] = "true";

    return new NextResponse(body, { status: 200, headers });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/noise-metrics/export error:", error);
    return apiError("Failed to export noise metrics", 500, "INTERNAL_ERROR");
  }
}
