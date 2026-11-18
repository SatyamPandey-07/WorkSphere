import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import {
  createDateFilterErrorResponse,
  parseBookingDateFilter,
} from "@/lib/validations/dateFilter";
import {
  anonymizeTelemetryRows,
  buildTelemetryRows,
  exportTelemetryToCsv,
} from "@/lib/export/venueTelemetryExport";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Window used when the caller gives no startDate. */
export const DEFAULT_EXPORT_RANGE_DAYS = 30;
export const MAX_EXPORT_RANGE_DAYS = 366;
/** Upper bound per data source so one request cannot read a whole table. */
export const MAX_ROWS_PER_SOURCE = 20_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MANAGER_ROLES = new Set(["admin", "super_admin", "manager", "venue_manager"]);

function readRole(sessionClaims: unknown): string | undefined {
  const claims = sessionClaims as Record<string, unknown> | null | undefined;
  const metadata = claims?.metadata as Record<string, unknown> | undefined;
  const role = metadata?.role ?? claims?.role ?? claims?.org_role;
  return typeof role === "string" ? role.toLowerCase() : undefined;
}

/**
 * GET /api/venues/[venueId]/telemetry/export?format=csv|json&startDate=&endDate=
 *
 * Historical noise, crowd density and WiFi telemetry as a downloadable file.
 * Venue owners, creators and admins get raw samples. Any other signed in user
 * gets an anonymized hourly roll up. A date-only endDate includes that whole UTC day.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { userId, sessionClaims } = await auth();
    if (!userId) {
      return apiError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const { venueId } = await params;
    const searchParams = req.nextUrl.searchParams;

    const format = (searchParams.get("format") ?? "csv").trim().toLowerCase();
    if (format !== "csv" && format !== "json") {
      return apiError("format must be either csv or json", 400, "VALIDATION_FAILED");
    }

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
      select: { id: true, ownerId: true, creatorId: true, maxCapacity: true },
    });
    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const role = readRole(sessionClaims);
    const isManager =
      venue.ownerId === userId ||
      venue.creatorId === userId ||
      (role !== undefined && MANAGER_ROLES.has(role));

    const [readings, records, wifiSamples] = await Promise.all([
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
      prisma.telemetryRecord.findMany({
        where: { venueId: venue.id, timestamp: { gte: start, lte: end } },
        select: { timestamp: true, noiseLevel: true, occupancy: true, download: true },
        orderBy: { timestamp: "asc" },
        take: MAX_ROWS_PER_SOURCE + 1,
      }),
      prisma.wifiTelemetry.findMany({
        where: { venueId: venue.id, timestamp: { gte: start, lte: end } },
        select: { timestamp: true, download: true, crowdLevel: true },
        orderBy: { timestamp: "asc" },
        take: MAX_ROWS_PER_SOURCE + 1,
      }),
    ]);

    const truncated =
      readings.length > MAX_ROWS_PER_SOURCE ||
      records.length > MAX_ROWS_PER_SOURCE ||
      wifiSamples.length > MAX_ROWS_PER_SOURCE;

    const rawRows = buildTelemetryRows({
      readings: readings.slice(0, MAX_ROWS_PER_SOURCE),
      records: records.slice(0, MAX_ROWS_PER_SOURCE),
      wifiSamples: wifiSamples.slice(0, MAX_ROWS_PER_SOURCE),
      maxCapacity: venue.maxCapacity,
    });
    const rows = isManager ? rawRows : anonymizeTelemetryRows(rawRows);

    const safeId = venue.id.replace(/[^A-Za-z0-9_-]/g, "_");
    const headers: Record<string, string> = {
      "Content-Disposition": `attachment; filename="venue-telemetry-${safeId}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Telemetry-Anonymized": String(!isManager),
    };
    if (truncated) headers["X-Export-Truncated"] = "true";

    if (format === "json") {
      return NextResponse.json(
        {
          venueId: venue.id,
          anonymized: !isManager,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          truncated,
          count: rows.length,
          data: rows,
        },
        { status: 200, headers },
      );
    }

    return new NextResponse(exportTelemetryToCsv(rows), {
      status: 200,
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (error) {
    console.error("GET /api/venues/[venueId]/telemetry/export error:", error);
    return apiError("Failed to export venue telemetry", 500, "INTERNAL_ERROR");
  }
}
