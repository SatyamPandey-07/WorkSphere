import { NextRequest, NextResponse } from "next/server";
import { runWeeklyPartitionMaintenance } from "@/lib/database/partitionManager";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

// DETACH/CREATE DDL on large partitions can take a while.
export const maxDuration = 300;

/**
 * Weekly partition maintenance cron for the nomad audit log and check-in
 * telemetry tables (#7489).
 *
 * Every run:
 *  1. Pre-creates the weekly partitions (`<table>_y{YYYY}w{WW}`) for the
 *     current week and the next 2 weeks — future partitions exist before
 *     the data arrives, without downtime.
 *  2. Detaches partitions older than 90 days and moves them to a
 *     cold-storage archive schema.
 *
 * Execution is idempotent: existing partitions are skipped, every CREATE is
 * `IF NOT EXISTS`, and an advisory lock prevents overlapping runs from
 * issuing duplicate DDL.
 *
 * Schedule weekly (e.g. Vercel Cron `"0 3 * * 1"` — Mondays 03:00 UTC) or
 * trigger externally; both GET and POST are supported. Secure with the
 * CRON_SECRET env var, sent as `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runWeeklyPartitionMaintenance();
    if (report.skipped) {
      return NextResponse.json({
        success: true,
        skipped: report.skipped,
        tables: report.tables,
      });
    }

    const errors = report.tables.flatMap((t) => t.errors);
    const created = report.tables.flatMap((t) => t.created);
    const archived = report.tables.flatMap((t) => t.archived);
    const dropped = report.tables.flatMap((t) => t.dropped);

    return NextResponse.json(
      {
        success: errors.length === 0,
        createdPartitions: created,
        archivedPartitions: archived,
        droppedPartitions: dropped,
        tables: report.tables,
        message:
          "Weekly audit/check-in partitions created & 90-day retention executed.",
      },
      { status: errors.length === 0 ? 200 : 207 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PartitionCron] Weekly partition maintenance failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
