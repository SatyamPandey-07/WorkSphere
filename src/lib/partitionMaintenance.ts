import { prisma } from "@/lib/prisma";

const PARTITION_PREFIX = "PushNotificationLog_y";
const ARCHIVE_SCHEMA = "push_notification_archive";
const DEFAULT_RETENTION_MONTHS = 6;

export interface PushNotificationPartition {
  name: string;
}

export interface ArchivedPartition {
  name: string;
  archivedSchema: string;
}

export interface PartitionArchiveResult {
  archived: ArchivedPartition[];
  retained: string[];
}

export interface PartitionHealthReport {
  status: "HEALTHY" | "CRITICAL";
  checkedAt: string;
  partitions: {
    name: string;
    exists: boolean;
    rowCount: number;
  }[];
}

/**
 * Returns the canonical monthly partition name used by PostgreSQL.
 */
export function getPushNotificationPartitionName(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${PARTITION_PREFIX}${year}m${month}`;
}

/**
 * Parses a canonical monthly partition name and returns its UTC month start.
 * Invalid or unrelated table names return `null`.
 */
export function parsePushNotificationPartitionMonth(
  partitionName: string,
): Date | null {
  const match = /^PushNotificationLog_y(\d{4})m(0[1-9]|1[0-2])$/.exec(
    partitionName,
  );

  if (!match) {
    return null;
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/**
 * Returns the first UTC day of the month that must still be retained.
 * A six-month policy keeps the current month and the previous five months.
 */
export function getPartitionRetentionCutoff(
  now: Date,
  retentionMonths = DEFAULT_RETENTION_MONTHS,
): Date {
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1) {
    throw new RangeError("retentionMonths must be a positive integer");
  }

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (retentionMonths - 1),
      1,
    ),
  );
}

/**
 * Returns true when a monthly partition falls completely outside retention.
 */
export function isPartitionExpired(
  partitionName: string,
  now: Date,
  retentionMonths = DEFAULT_RETENTION_MONTHS,
): boolean {
  const partitionMonth = parsePushNotificationPartitionMonth(partitionName);
  if (!partitionMonth) {
    return false;
  }

  return partitionMonth < getPartitionRetentionCutoff(now, retentionMonths);
}

function assertSafePartitionName(partitionName: string): void {
  if (!parsePushNotificationPartitionMonth(partitionName)) {
    throw new Error(`Unsafe or invalid partition name: ${partitionName}`);
  }
}

/**
 * Lists monthly partitions attached to the PushNotificationLog parent table.
 */
export async function listPushNotificationPartitions(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<PushNotificationPartition[]>(`
    SELECT child.relname AS "name"
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace parent_ns ON parent.relnamespace = parent_ns.oid
    WHERE parent_ns.nspname = 'public'
      AND parent.relname = 'PushNotificationLog'
      AND child.relname ~ '^PushNotificationLog_y[0-9]{4}m(0[1-9]|1[0-2])$'
    ORDER BY child.relname;
  `);

  return rows.map(({ name }) => name);
}

/**
 * Detaches monthly PushNotificationLog partitions older than the configured
 * retention window and moves them into a dedicated archive schema.
 *
 * Detaching preserves the data while removing it from normal notification
 * queries. The operation is idempotent because only currently attached
 * partitions are discovered.
 */
export async function archiveExpiredPushNotificationPartitions(options?: {
  now?: Date;
  retentionMonths?: number;
}): Promise<PartitionArchiveResult> {
  const now = options?.now ?? new Date();
  const retentionMonths = options?.retentionMonths ?? DEFAULT_RETENTION_MONTHS;

  // Validate before performing any database work.
  getPartitionRetentionCutoff(now, retentionMonths);

  const partitions = await listPushNotificationPartitions();
  const expired = partitions.filter((name) =>
    isPartitionExpired(name, now, retentionMonths),
  );
  const retained = partitions.filter(
    (name) => !isPartitionExpired(name, now, retentionMonths),
  );

  if (expired.length === 0) {
    return { archived: [], retained };
  }

  const archived = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `CREATE SCHEMA IF NOT EXISTS "${ARCHIVE_SCHEMA}"`,
    );

    const results: ArchivedPartition[] = [];

    for (const partitionName of expired) {
      assertSafePartitionName(partitionName);

      await transaction.$executeRawUnsafe(
        `ALTER TABLE "PushNotificationLog" DETACH PARTITION "${partitionName}"`,
      );
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${partitionName}" SET SCHEMA "${ARCHIVE_SCHEMA}"`,
      );

      results.push({
        name: partitionName,
        archivedSchema: ARCHIVE_SCHEMA,
      });
    }

    return results;
  });

  return { archived, retained };
}

/**
 * Ensures monthly range partitions exist for the current and next two months.
 */
export async function autoCreateUpcomingPartitions(
  now = new Date(),
): Promise<string[]> {
  const createdPartitions: string[] = [];

  for (let offset = 0; offset <= 2; offset += 1) {
    const rangeStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    const rangeEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1),
    );
    const partitionName = getPushNotificationPartitionName(rangeStart);

    assertSafePartitionName(partitionName);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${partitionName}"
      PARTITION OF "PushNotificationLog"
      FOR VALUES FROM ('${rangeStart.toISOString()}') TO ('${rangeEnd.toISOString()}')
    `);

    createdPartitions.push(partitionName);
  }

  return createdPartitions;
}

export async function checkPartitionHealth(): Promise<PartitionHealthReport> {
  const now = new Date();
  const partitions: PartitionHealthReport["partitions"] = [];
  let isCritical = false;

  for (let offset = 0; offset <= 1; offset += 1) {
    const targetDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    const partitionName = getPushNotificationPartitionName(targetDate);

    const result = await prisma.$queryRawUnsafe<
      { relname: string; n_live_tup: number }[]
    >(`
      SELECT relname, n_live_tup::int AS n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
        AND relname = '${partitionName}'
      LIMIT 1;
    `);

    const exists = result.length > 0;
    const rowCount = exists ? result[0].n_live_tup : 0;

    if (offset === 1 && !exists) {
      isCritical = true;
    }

    partitions.push({ name: partitionName, exists, rowCount });
  }

  return {
    status: isCritical ? "CRITICAL" : "HEALTHY",
    checkedAt: new Date().toISOString(),
    partitions,
  };
}
