import { prisma } from "@/lib/prisma";

const TELEMETRY_TABLES = ["WifiTelemetry", "NoiseMetric"] as const;
const ARCHIVE_SCHEMA = "telemetry_archive";
const RETENTION_DAYS = 90;

type TelemetryTable = (typeof TELEMETRY_TABLES)[number];

interface TelemetryPartition {
  tableName: TelemetryTable;
  partitionName: string;
}

function formatMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}m${month}`;
}

export function getTelemetryPartitionName(
  tableName: TelemetryTable,
  date: Date,
): string {
  return `${tableName}_y${formatMonth(date)}`;
}

export function getTelemetryPartitionRange(date: Date): {
  start: string;
  end: string;
} {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  );

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function buildCreateTelemetryPartitionSql(
  tableName: TelemetryTable,
  date: Date,
): string {
  const partitionName = getTelemetryPartitionName(tableName, date);
  const range = getTelemetryPartitionRange(date);

  return `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "${tableName}" FOR VALUES FROM ('${range.start}') TO ('${range.end}')`;
}

function getPartitionMonth(partitionName: string): Date | null {
  const match = /^(WifiTelemetry|NoiseMetric)_y(\d{4})m(0[1-9]|1[0-2])$/.exec(
    partitionName,
  );

  if (!match) {
    return null;
  }

  return new Date(Date.UTC(Number(match[2]), Number(match[3]) - 1, 1));
}

function isOlderThanRetention(partitionName: string, cutoff: Date): boolean {
  const start = getPartitionMonth(partitionName);
  if (!start) {
    return false;
  }

  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return end <= cutoff;
}

async function listAttachedTelemetryPartitions(): Promise<TelemetryPartition[]> {
  return prisma.$queryRawUnsafe<TelemetryPartition[]>(`
    SELECT parent.relname AS "tableName", child.relname AS "partitionName"
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace parent_ns ON parent.relnamespace = parent_ns.oid
    WHERE parent_ns.nspname = 'public'
      AND parent.relname IN ('WifiTelemetry', 'NoiseMetric')
      AND child.relname ~ '^(WifiTelemetry|NoiseMetric)_y[0-9]{4}m(0[1-9]|1[0-2])$'
    ORDER BY parent.relname, child.relname;
  `);
}

async function withPartitionLock<T>(
  callback: (transaction: typeof prisma) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(3445, 1)",
    );
    return callback(transaction as typeof prisma);
  });
}

export async function runTelemetryPartitionMaintenance(
  now = new Date(),
): Promise<{
  created: string[];
  archived: string[];
  vacuumed: string[];
}> {
  const created = await withPartitionLock(async (transaction) => {
    const names: string[] = [];

    for (const tableName of TELEMETRY_TABLES) {
      for (const offset of [1, 2]) {
        const date = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
        );
        const partitionName = getTelemetryPartitionName(tableName, date);
        await transaction.$executeRawUnsafe(
          buildCreateTelemetryPartitionSql(tableName, date),
        );
        names.push(partitionName);
      }
    }

    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const partitions = await transaction.$queryRawUnsafe<TelemetryPartition[]>(`
      SELECT parent.relname AS "tableName", child.relname AS "partitionName"
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child ON pg_inherits.inhrelid = child.oid
      JOIN pg_namespace parent_ns ON parent.relnamespace = parent_ns.oid
      WHERE parent_ns.nspname = 'public'
        AND parent.relname IN ('WifiTelemetry', 'NoiseMetric')
        AND child.relname ~ '^(WifiTelemetry|NoiseMetric)_y[0-9]{4}m(0[1-9]|1[0-2])$'
      ORDER BY parent.relname, child.relname;
    `);
    const expired = partitions.filter(({ partitionName }) =>
      isOlderThanRetention(partitionName, cutoff),
    );

    if (expired.length > 0) {
      await transaction.$executeRawUnsafe(
        `CREATE SCHEMA IF NOT EXISTS "${ARCHIVE_SCHEMA}"`,
      );
    }

    for (const { tableName, partitionName } of expired) {
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${tableName}" DETACH PARTITION "${partitionName}"`,
      );
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${partitionName}" SET SCHEMA "${ARCHIVE_SCHEMA}"`,
      );
    }

    return { names, archived: expired.map(({ partitionName }) => partitionName) };
  });

  const attached = await listAttachedTelemetryPartitions();
  const vacuumed: string[] = [];
  for (const { partitionName } of attached) {
    await prisma.$executeRawUnsafe(`VACUUM ANALYZE "${partitionName}"`);
    vacuumed.push(partitionName);
  }

  return { created: created.names, archived: created.archived, vacuumed };
}