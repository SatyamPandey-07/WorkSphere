import { prisma } from "@/lib/prisma";

const PUSH_PARTITION_PREFIX = "PushNotificationLog_y";
const PUSH_ARCHIVE_SCHEMA = "push_notification_archive";
const DEFAULT_PUSH_RETENTION_MONTHS = 6;

const TELEMETRY_PARTITION_PREFIX = "TelemetryRecord_y";
const TELEMETRY_ARCHIVE_SCHEMA = "telemetry_archive";
const DEFAULT_TELEMETRY_RETENTION_MONTHS = 12;

export interface PushNotificationPartition {
  name: string;
}

export interface TelemetryPartition {
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
    tableSizeBytes?: number;
    tableSizePretty?: string;
    isNearColdStorage?: boolean;
  }[];
}

/**
 * Cold storage detachment threshold in bytes (100 MB).
 */
export const COLD_STORAGE_THRESHOLD_BYTES = 100 * 1024 * 1024;

/**
 * Format raw byte size into human-readable string (e.g., "48 MB", "120 KB", "1.2 GB").
 */
export function formatPartitionBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(i, units.length - 1);
  const formattedVal = (bytes / Math.pow(1024, unitIndex));
  // Display integers directly, or with 1 decimal place if fractional
  const valString = formattedVal % 1 === 0 ? formattedVal.toString() : formattedVal.toFixed(1);
  return `${valString} ${units[unitIndex]}`;
}

// ─── PushNotificationLog Partition Helpers ──────────────────────────────────

/**
 * Returns the canonical monthly partition name used by PostgreSQL.
 */
export function getPushNotificationPartitionName(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${PUSH_PARTITION_PREFIX}${year}m${month}`;
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
 */
export function getPartitionRetentionCutoff(
  now: Date,
  retentionMonths = DEFAULT_PUSH_RETENTION_MONTHS,
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
  retentionMonths = DEFAULT_PUSH_RETENTION_MONTHS,
): boolean {
  const partitionMonth = parsePushNotificationPartitionMonth(partitionName);
  if (!partitionMonth) {
    return false;
  }

  return partitionMonth < getPartitionRetentionCutoff(now, retentionMonths);
}

function assertSafePushPartitionName(partitionName: string): void {
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
 * Detaches monthly PushNotificationLog partitions older than the retention window.
 */
export async function archiveExpiredPushNotificationPartitions(options?: {
  now?: Date;
  retentionMonths?: number;
}): Promise<PartitionArchiveResult> {
  const now = options?.now ?? new Date();
  const retentionMonths = options?.retentionMonths ?? DEFAULT_PUSH_RETENTION_MONTHS;

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
      `CREATE SCHEMA IF NOT EXISTS "${PUSH_ARCHIVE_SCHEMA}"`,
    );

    const results: ArchivedPartition[] = [];

    for (const partitionName of expired) {
      assertSafePushPartitionName(partitionName);

      await transaction.$executeRawUnsafe(
        `ALTER TABLE "PushNotificationLog" DETACH PARTITION "${partitionName}"`,
      );
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${partitionName}" SET SCHEMA "${PUSH_ARCHIVE_SCHEMA}"`,
      );

      results.push({
        name: partitionName,
        archivedSchema: PUSH_ARCHIVE_SCHEMA,
      });
    }

    return results;
  });

  return { archived, retained };
}

// ─── TelemetryRecord Range Partition Helpers (Issue #3528) ───────────────────

/**
 * Returns canonical monthly partition name for TelemetryRecord.
 */
export function getTelemetryPartitionName(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${TELEMETRY_PARTITION_PREFIX}${year}m${month}`;
}

/**
 * Parses a canonical monthly TelemetryRecord partition name and returns UTC month start.
 */
export function parseTelemetryPartitionMonth(partitionName: string): Date | null {
  const match = /^TelemetryRecord_y(\d{4})m(0[1-9]|1[0-2])$/.exec(partitionName);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/**
 * Returns the first UTC day of the month that must still be retained for TelemetryRecord.
 * Retains 12 months by default.
 */
export function getTelemetryPartitionRetentionCutoff(
  now: Date,
  retentionMonths = DEFAULT_TELEMETRY_RETENTION_MONTHS,
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
 * Returns true when a monthly telemetry partition falls outside the 12-month retention window.
 */
export function isTelemetryPartitionExpired(
  partitionName: string,
  now: Date,
  retentionMonths = DEFAULT_TELEMETRY_RETENTION_MONTHS,
): boolean {
  const partitionMonth = parseTelemetryPartitionMonth(partitionName);
  if (!partitionMonth) {
    return false;
  }
  return partitionMonth < getTelemetryPartitionRetentionCutoff(now, retentionMonths);
}

function assertSafeTelemetryPartitionName(partitionName: string): void {
  if (!parseTelemetryPartitionMonth(partitionName)) {
    throw new Error(`Unsafe or invalid telemetry partition name: ${partitionName}`);
  }
}

/**
 * Lists monthly partitions attached to the TelemetryRecord parent table.
 */
export async function listTelemetryPartitions(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<TelemetryPartition[]>(`
    SELECT child.relname AS "name"
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace parent_ns ON parent.relnamespace = parent_ns.oid
    WHERE parent_ns.nspname = 'public'
      AND parent.relname = 'TelemetryRecord'
      AND child.relname ~ '^TelemetryRecord_y[0-9]{4}m(0[1-9]|1[0-2])$'
    ORDER BY child.relname;
  `);

  return rows.map(({ name }) => name);
}

/**
 * Ensures monthly range partitions exist for TelemetryRecord for current and next two months.
 */
export async function autoCreateUpcomingTelemetryPartitions(
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
    const partitionName = getTelemetryPartitionName(rangeStart);

    assertSafeTelemetryPartitionName(partitionName);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${partitionName}"
      PARTITION OF "TelemetryRecord"
      FOR VALUES FROM ('${rangeStart.toISOString()}') TO ('${rangeEnd.toISOString()}')
    `);

    createdPartitions.push(partitionName);
  }

  return createdPartitions;
}

/**
 * Detaches monthly TelemetryRecord partitions older than 12 months and moves
 * them to cold storage / telemetry_archive schema, avoiding query degradation.
 */
export async function archiveExpiredTelemetryPartitions(options?: {
  now?: Date;
  retentionMonths?: number;
}): Promise<PartitionArchiveResult> {
  const now = options?.now ?? new Date();
  const retentionMonths =
    options?.retentionMonths ?? DEFAULT_TELEMETRY_RETENTION_MONTHS;

  getTelemetryPartitionRetentionCutoff(now, retentionMonths);

  const partitions = await listTelemetryPartitions();
  const expired = partitions.filter((name) =>
    isTelemetryPartitionExpired(name, now, retentionMonths),
  );
  const retained = partitions.filter(
    (name) => !isTelemetryPartitionExpired(name, now, retentionMonths),
  );

  if (expired.length === 0) {
    return { archived: [], retained };
  }

  const archived = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `CREATE SCHEMA IF NOT EXISTS "${TELEMETRY_ARCHIVE_SCHEMA}"`,
    );

    const results: ArchivedPartition[] = [];

    for (const partitionName of expired) {
      assertSafeTelemetryPartitionName(partitionName);

      await transaction.$executeRawUnsafe(
        `ALTER TABLE "TelemetryRecord" DETACH PARTITION "${partitionName}"`,
      );
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${partitionName}" SET SCHEMA "${TELEMETRY_ARCHIVE_SCHEMA}"`,
      );

      results.push({
        name: partitionName,
        archivedSchema: TELEMETRY_ARCHIVE_SCHEMA,
      });
    }

    return results;
  });

  return { archived, retained };
}

// ─── Unified Maintenance Functions ──────────────────────────────────────────

/**
 * Ensures monthly range partitions exist for the current and next two months
 * for both PushNotificationLog and TelemetryRecord.
 */
export async function autoCreateUpcomingPartitions(
  now = new Date(),
): Promise<string[]> {
  const pushPartitions = await autoCreateUpcomingPushPartitionsInternal(now);
  let telemetryPartitions: string[] = [];
  try {
    telemetryPartitions = await autoCreateUpcomingTelemetryPartitions(now);
  } catch (err) {
    console.warn("[PartitionMaintenance] Telemetry upcoming partition warning:", err);
  }
  return [...pushPartitions, ...telemetryPartitions];
}

async function autoCreateUpcomingPushPartitionsInternal(
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

    assertSafePushPartitionName(partitionName);

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
      { relname: string; n_live_tup: number; total_bytes?: string | number }[]
    >(`
      SELECT 
        relname, 
        n_live_tup::int AS n_live_tup,
        pg_total_relation_size(relid)::bigint AS total_bytes
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
        AND relname = '${partitionName}'
      LIMIT 1;
    `);

    const exists = result.length > 0;
    const rowCount = exists ? result[0].n_live_tup : 0;
    const rawBytes = exists && result[0].total_bytes != null ? Number(result[0].total_bytes) : 0;
    const tableSizeBytes = isNaN(rawBytes) ? 0 : rawBytes;
    const tableSizePretty = formatPartitionBytes(tableSizeBytes);
    const isNearColdStorage = tableSizeBytes >= COLD_STORAGE_THRESHOLD_BYTES;

    if (!exists) {
      isCritical = true;
    }

    partitions.push({
      name: partitionName,
      exists,
      rowCount,
      tableSizeBytes,
      tableSizePretty,
      isNearColdStorage,
    });
  }

  return {
    status: isCritical ? "CRITICAL" : "HEALTHY",
    checkedAt: new Date().toISOString(),
    partitions,
  };
}
