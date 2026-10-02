import { NextRequest, NextResponse } from "next/server";
import {
  autoCreateUpcomingPartitions,
  archiveExpiredPushNotificationPartitions,
  checkPartitionHealth,
} from "@/lib/partitionMaintenance";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runPartitionRetention, type RetentionRunReport } from "@/lib/partitionRetention";

// DETACH/VACUUM on large partitions can take a while.
export const maxDuration = 300;

/**
 * GET /api/cron/partition-maintenance
 *
 * Monthly cron job that:
 * 1. Creates upcoming PushNotificationLog partitions (next 2 months)
 * 2. Archives expired PushNotificationLog partitions
 * 3. For WifiTelemetry + AdminAuditLog (#3362): pre-creates partitions,
 *    drops/archives expired ones in one transaction per table, and
 *    VACUUM (ANALYZE)s the active partitions
 * 4. Returns a health report
 *
 * Secure with a CRON_SECRET env var; configure in Vercel cron.json as
 * a monthly job (e.g. "0 2 1 * *" = 2 AM on the 1st of each month).
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const results: {
    partitionsCreated?: string[];
    partitionsArchived?: string[];
    retention?: RetentionRunReport;
    healthReport?: unknown;
    errors: string[];
  } = { errors: [] };

  // 1. Create upcoming partitions
  try {
    results.partitionsCreated = await autoCreateUpcomingPartitions();
    console.log(
      `[PartitionCron] Created ${results.partitionsCreated.length} upcoming partition(s)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`autoCreateUpcomingPartitions: ${msg}`);
    console.error("[PartitionCron] Failed to create partitions:", err);
  }

  // 2. Archive expired partitions
  try {
    const archiveResult = await archiveExpiredPushNotificationPartitions();
    results.partitionsArchived = archiveResult.archived.map((a) => a.name);
    console.log(
      `[PartitionCron] Archived ${results.partitionsArchived.length} expired partition(s)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`archiveExpiredPartitions: ${msg}`);
    console.error("[PartitionCron] Failed to archive partitions:", err);
  }

  // 3. Telemetry / audit log partition upkeep + retention (#3362)
  try {
    results.retention = await runPartitionRetention();
    for (const table of results.retention.tables) {
      for (const error of table.errors) results.errors.push(`${table.table}: ${error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`runPartitionRetention: ${msg}`);
    console.error("[PartitionCron] Retention run failed:", err);
  }

  // 4. Collect health report
  try {
    results.healthReport = await checkPartitionHealth();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`checkPartitionHealth: ${msg}`);
  }

  const durationMs = Date.now() - startedAt;
  const success = results.errors.length === 0;

  return NextResponse.json(
    {
      success,
      durationMs,
      ...results,
    },
    { status: success ? 200 : 207 },
  );
}
