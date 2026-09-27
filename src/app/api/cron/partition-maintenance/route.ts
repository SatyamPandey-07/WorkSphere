import { NextRequest, NextResponse } from "next/server";
import {
  autoCreateUpcomingPartitions,
  archiveExpiredPushNotificationPartitions,
  checkPartitionHealth,
} from "@/lib/partitionMaintenance";

/**
 * GET /api/cron/partition-maintenance
 *
 * Monthly cron job that:
 * 1. Creates upcoming telemetry table partitions (next 2 months)
 * 2. Archives/drops expired partitions older than the retention window
 * 3. Returns a health report
 *
 * Secure with a CRON_SECRET env var; configure in Vercel cron.json as
 * a monthly job (e.g. "0 2 1 * *" = 2 AM on the 1st of each month).
 */
export async function GET(request: NextRequest) {
  // Validate cron secret to prevent unauthorized invocations
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  const results: {
    partitionsCreated?: string[];
    partitionsArchived?: string[];
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
    results.partitionsArchived =
      await archiveExpiredPushNotificationPartitions();
    console.log(
      `[PartitionCron] Archived ${results.partitionsArchived.length} expired partition(s)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`archiveExpiredPartitions: ${msg}`);
    console.error("[PartitionCron] Failed to archive partitions:", err);
  }

  // 3. Collect health report
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
