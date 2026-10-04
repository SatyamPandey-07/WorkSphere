import { NextRequest, NextResponse } from "next/server";
import {
  autoCreateUpcomingPartitions,
  archiveExpiredPushNotificationPartitions,
  archiveExpiredTelemetryPartitions,
  checkPartitionHealth,
} from "@/lib/partitionMaintenance";
import { runTelemetryPartitionMaintenance } from "@/lib/db/partitionManager";
import { runPartmanPartitionMaintenance } from "@/lib/db/partitionMaintenance";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { runPartitionRetention, type RetentionRunReport } from "@/lib/partitionRetention";

// DETACH/VACUUM on large partitions can take a while.
export const maxDuration = 300;

/**
 * GET /api/cron/partition-maintenance
 *
 * Monthly cron job that:
 * 1. Creates upcoming table partitions (PushNotificationLog, WifiTelemetry, and AdminAuditLog)
 * 2. Detaches and archives expired telemetry partitions older than 12 months to S3/cold storage
 * 3. Archives expired PushNotificationLog partitions older than 6 months
 * 4. Runs upkeep, drops/archives expired ones in one transaction per table, and VACUUM (ANALYZE)s active partitions

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
    telemetryPartitionsArchived?: string[];
    retention?: RetentionRunReport;

    healthReport?: unknown;
    telemetryPartitions?: {
      created: string[];
      archived: string[];
      vacuumed: string[];
    };
    telemetryMaintenance?: {
      maintained: string[];
      plannedPartitions: string[];
      activePartitions: string[];
      skippedTables: string[];
    };
    errors: string[];
  } = { errors: [] };

  // 1. Create upcoming partitions (TelemetryRecord & PushNotificationLog)
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

  // 2. Archive expired push notification partitions
  try {
    const archiveResult = await archiveExpiredPushNotificationPartitions();
    results.partitionsArchived = archiveResult.archived.map((a) => a.name);
    console.log(
      `[PartitionCron] Archived ${results.partitionsArchived.length} expired push partition(s)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`archiveExpiredPushNotificationPartitions: ${msg}`);
    console.error("[PartitionCron] Failed to archive push partitions:", err);
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

  // Detach and archive expired telemetry partitions older than 12 months to cold storage / S3
  try {
    if (typeof archiveExpiredTelemetryPartitions === "function") {
      const telemetryArchiveResult = await archiveExpiredTelemetryPartitions();
      results.telemetryPartitionsArchived = telemetryArchiveResult.archived.map((a) => a.name);
      console.log(
        `[PartitionCron] Archived ${results.telemetryPartitionsArchived.length} expired telemetry partition(s)`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`archiveExpiredTelemetryPartitions: ${msg}`);
    console.error("[PartitionCron] Failed to archive telemetry partitions:", err);
  }


  // 4. Collect health report
  try {
    results.healthReport = await checkPartitionHealth();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`checkPartitionHealth: ${msg}`);
  }

  // 4. Run automated table partitioning maintenance worker
  try {
    results.telemetryMaintenance = await runPartmanPartitionMaintenance();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`runPartmanPartitionMaintenance: ${msg}`);
    console.error("[PartitionCron] Telemetry maintenance failed:", err);
  }


  const durationMs = Date.now() - startedAt;
  const success = results.errors.length === 0;

  try {
    const adminId = process.env.PARTITION_MAINTENANCE_ADMIN_ID;
    if (!adminId) {
      throw new Error("PARTITION_MAINTENANCE_ADMIN_ID is not configured");
    }

    const auditActor = await prisma.user.findFirst({
      where: { id: adminId, isAdmin: true },
      select: { id: true },
    });
    if (!auditActor) {
      throw new Error("Configured partition maintenance audit actor is not an admin user");
    }

    await prisma.adminAuditLog.create({
      data: {
        adminId: auditActor.id,
        action: "PARTITION_MAINTENANCE",
        entityType: "DatabasePartition",
        entityId: "WifiTelemetry,AcousticTelemetry",
        details: JSON.stringify({ success, durationMs, ...results }),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.errors.push(`partitionMaintenanceAudit: ${msg}`);
    console.error("[PartitionCron] Failed to log maintenance metrics:", err);
  }

  return NextResponse.json(
    {
      success: results.errors.length === 0,
      durationMs,
      ...results,
    },
    { status: success ? 200 : 207 },
  );
}
