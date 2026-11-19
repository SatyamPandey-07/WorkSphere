import { NextRequest, NextResponse } from "next/server";
import { archiveExpiredTelemetryPartitions } from "@/lib/partitionMaintenance";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const maxDuration = 300;

const TELEMETRY_RETENTION_DAYS = 90;

/**
 * GET /api/cron/archive-telemetry
 *
 * Monthly maintenance endpoint. It archives only complete TelemetryRecord
 * partitions whose upper UTC boundary is at least 90 days old, writes compact
 * per-venue monthly noise summaries, and retains the original partitions in
 * the telemetry_archive schema.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  try {
    const result = await archiveExpiredTelemetryPartitions({
      now,
      retentionDays: TELEMETRY_RETENTION_DAYS,
    });

    return NextResponse.json(
      {
        success: true,
        retentionDays: TELEMETRY_RETENTION_DAYS,
        cutoff: cutoff.toISOString(),
        archivedPartitions: result.archived,
        retainedPartitions: result.retained,
        noiseSummaryTable:
          result.archived.length > 0
            ? "telemetry_archive.noise_monthly_summary"
            : null,
        durationMs: Date.now() - startedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[TelemetryArchiveCron] Failed to archive telemetry partitions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Telemetry archival failed. Check server logs for details.",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
