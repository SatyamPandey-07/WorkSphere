import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { SLACalculator, SLAThresholds } from "@/core/audit/SLACalculator";
import { TelemetryAggregator, TelemetryPoint } from "@/core/audit/TelemetryAggregator";
import { VenuePenaltyEngine } from "@/core/audit/VenuePenaltyEngine";

const DEFAULT_THRESHOLDS: SLAThresholds = {
  minWifiUptimePercent: 95,
  minAverageWifiSpeedMbps: 40,
  maxNoiseLevelDb: 65,
  minSeatAvailabilityPercent: 20,
};
const THRESHOLD_VERSION = "venue-sla-v1";
const MIN_TELEMETRY_SAMPLES = 10;
const MAX_PERIOD_DAYS = 31;
const MAX_VENUES_PER_RUN = 100;

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const hasPeriodInput = body?.periodStart !== undefined || body?.periodEnd !== undefined;
    const periodStart = parseDate(body?.periodStart) ?? (
      hasPeriodInput ? null : new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    const periodEnd = parseDate(body?.periodEnd) ?? (hasPeriodInput ? null : new Date());
    if (!periodStart || !periodEnd || periodStart >= periodEnd) {
      return NextResponse.json(
        { error: "Valid periodStart and periodEnd timestamps are required." },
        { status: 400 },
      );
    }
    if (periodEnd.getTime() - periodStart.getTime() > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Audit period cannot exceed 31 days." }, { status: 400 });
    }

    // Preserve compatibility with the original trigger payload, but ignore its
    // client-supplied telemetry and re-read measurements from PostgreSQL.
    const venueIds = body?.venueIds ??
      (Array.isArray(body?.venues)
        ? body.venues.map((venue: { id?: unknown }) => venue?.id)
        : undefined);
    if (
      venueIds !== undefined &&
      (!Array.isArray(venueIds) ||
        venueIds.length === 0 ||
        venueIds.length > MAX_VENUES_PER_RUN ||
        venueIds.some((id: unknown) => typeof id !== "string" || !id.trim()))
    ) {
      return NextResponse.json(
        { error: "venueIds must be a non-empty array of at most 100 venue IDs." },
        { status: 400 },
      );
    }

    const venues = await prisma.venue.findMany({
      where: venueIds ? { id: { in: venueIds } } : undefined,
      select: { id: true, maxCapacity: true },
      take: MAX_VENUES_PER_RUN,
      orderBy: { id: "asc" },
    });

    const calculator = new SLACalculator(DEFAULT_THRESHOLDS);
    const aggregator = new TelemetryAggregator();
    const penaltyEngine = new VenuePenaltyEngine();
    const results = [];

    for (const venue of venues) {
      const records = await prisma.telemetryRecord.findMany({
        where: {
          venueId: venue.id,
          timestamp: { gte: periodStart, lte: periodEnd },
          download: { not: null },
          noiseLevel: { not: null },
          occupancy: { not: null },
        },
        select: {
          timestamp: true,
          download: true,
          noiseLevel: true,
          occupancy: true,
          presence: true,
        },
        orderBy: { timestamp: "asc" },
      });

      if (records.length < MIN_TELEMETRY_SAMPLES) {
        const audit = await prisma.venueSlaAudit.upsert({
          where: {
            venueId_periodStart_periodEnd_thresholdVersion: {
              venueId: venue.id,
              periodStart,
              periodEnd,
              thresholdVersion: THRESHOLD_VERSION,
            },
          },
          create: {
            venueId: venue.id,
            periodStart,
            periodEnd,
            thresholdVersion: THRESHOLD_VERSION,
            status: "INSUFFICIENT_DATA",
            sampleCount: records.length,
          },
          update: {
            status: "INSUFFICIENT_DATA",
            sampleCount: records.length,
            avgWifiSpeedMbps: null,
            wifiUptimePercent: null,
            avgNoiseLevelDb: null,
            avgSeatAvailabilityPercent: null,
            complianceScore: null,
            isCompliant: null,
            penaltyPoints: null,
            violations: Prisma.DbNull,
          },
        });
        results.push({ venueId: venue.id, status: audit.status, sampleCount: records.length });
        continue;
      }

      const telemetry: TelemetryPoint[] = records.map((record) => {
        const capacity = Math.max(0, venue.maxCapacity);
        const occupancy = Math.max(0, Math.min(capacity, record.occupancy ?? 0));
        return {
          timestamp: record.timestamp.getTime(),
          wifiSpeedMbps: record.download ?? 0,
          wifiConnected: record.presence !== false,
          noiseLevelDb: record.noiseLevel ?? 0,
          seatsAvailable: Math.max(0, capacity - occupancy),
          totalSeats: capacity,
        };
      });

      const metrics = aggregator.aggregate(venue.id, telemetry);
      const slaResult = calculator.evaluate(
        venue.id,
        metrics.wifiUptimePercent,
        metrics.avgWifiSpeedMbps,
        metrics.avgNoiseLevelDb,
        metrics.avgSeatAvailabilityPercent,
      );
      const penaltyResult = penaltyEngine.applyPenalties(venue.id, 100, slaResult);
      const penaltyPoints = Math.max(0, Math.min(100, penaltyResult.penaltyPoints));
      const violations = slaResult.violations;

      const audit = await prisma.$transaction(async (tx) => {
        const persisted = await tx.venueSlaAudit.upsert({
          where: {
            venueId_periodStart_periodEnd_thresholdVersion: {
              venueId: venue.id,
              periodStart,
              periodEnd,
              thresholdVersion: THRESHOLD_VERSION,
            },
          },
          create: {
            venueId: venue.id,
            periodStart,
            periodEnd,
            thresholdVersion: THRESHOLD_VERSION,
            status: "COMPLETE",
            sampleCount: metrics.sampleCount,
            avgWifiSpeedMbps: metrics.avgWifiSpeedMbps,
            wifiUptimePercent: metrics.wifiUptimePercent,
            avgNoiseLevelDb: metrics.avgNoiseLevelDb,
            avgSeatAvailabilityPercent: metrics.avgSeatAvailabilityPercent,
            complianceScore: slaResult.complianceScore,
            isCompliant: slaResult.isCompliant,
            penaltyPoints,
            violations: violations as Prisma.InputJsonValue,
          },
          update: {
            status: "COMPLETE",
            sampleCount: metrics.sampleCount,
            avgWifiSpeedMbps: metrics.avgWifiSpeedMbps,
            wifiUptimePercent: metrics.wifiUptimePercent,
            avgNoiseLevelDb: metrics.avgNoiseLevelDb,
            avgSeatAvailabilityPercent: metrics.avgSeatAvailabilityPercent,
            complianceScore: slaResult.complianceScore,
            isCompliant: slaResult.isCompliant,
            penaltyPoints,
            violations: violations as Prisma.InputJsonValue,
          },
        });
        await tx.venue.update({
          where: { id: venue.id },
          data: {
            slaPenaltyPoints: penaltyPoints,
            slaComplianceScore: slaResult.complianceScore,
            slaLastAuditedAt: new Date(),
          },
        });
        return persisted;
      });

      results.push({
        venueId: venue.id,
        status: audit.status,
        sampleCount: metrics.sampleCount,
        slaCompliant: slaResult.isCompliant,
        complianceScore: slaResult.complianceScore,
        penaltyPoints,
        violations,
      });
    }

    return NextResponse.json({
      success: true,
      processedCount: results.length,
      thresholdVersion: THRESHOLD_VERSION,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      results,
    });
  } catch (error) {
    console.error("[SlaAudit] Audit trigger failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
