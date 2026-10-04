import { prisma } from "@/lib/prisma";

const TELEMETRY_TABLES = ["WifiTelemetry", "AcousticTelemetry"] as const;
const PARTMAN_SCHEMA = "partman";
const ARCHIVE_SCHEMA = "telemetry_archive";
const RETENTION_INTERVAL = "90 days";
const PREMAKE_MONTHS = 2;

export type TelemetryTable = (typeof TELEMETRY_TABLES)[number];

export interface TelemetryPartitionRange {
  start: string;
  end: string;
}

export interface PartitionMaintenanceResult {
  maintained: string[];
  plannedPartitions: string[];
  activePartitions: string[];
  skippedTables: string[];
}

function getMonthCode(date: Date): string {
  return `${date.getUTCFullYear()}m${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getTelemetryPartitionName(
  tableName: TelemetryTable,
  date: Date,
): string {
  return `${tableName}_y${getMonthCode(date)}`;
}

export function getTelemetryPartitionRange(date: Date): TelemetryPartitionRange {
  const monthStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const nextMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  );

  return {
    start: monthStart.toISOString().slice(0, 10),
    end: nextMonth.toISOString().slice(0, 10),
  };
}

export function getUpcomingTelemetryPartitionNames(now: Date): string[] {
  return TELEMETRY_TABLES.flatMap((tableName) =>
    Array.from({ length: PREMAKE_MONTHS }, (_, index) => {
      const targetMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index + 1, 1),
      );
      return getTelemetryPartitionName(tableName, targetMonth);
    }),
  );
}

export function buildPartmanRetentionConfigSql(): string {
  return `UPDATE partman.part_config
    SET premake = ${PREMAKE_MONTHS},
        retention = '${RETENTION_INTERVAL}',
        retention_keep_table = true,
        retention_schema = '${ARCHIVE_SCHEMA}'
    WHERE parent_table = $1`;
}

export async function runPartmanPartitionMaintenance(
  now = new Date(),
): Promise<PartitionMaintenanceResult> {
  const setup = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(3483, 1)",
    );

    const partmanRows = await transaction.$queryRawUnsafe<
      { installed: boolean }[]
    >("SELECT to_regnamespace($1) IS NOT NULL AS installed", PARTMAN_SCHEMA);
    if (!partmanRows[0]?.installed) {
      throw new Error(
        "pg_partman must be installed in the partman schema before partition maintenance can run",
      );
    }

    await transaction.$executeRawUnsafe(
      `CREATE SCHEMA IF NOT EXISTS "${ARCHIVE_SCHEMA}"`,
    );

    const maintained: string[] = [];
    const skippedTables: string[] = [];
    const plannedPartitions = getUpcomingTelemetryPartitionNames(now);
    const activePartitions: string[] = [];

    for (const tableName of TELEMETRY_TABLES) {
      const parentTable = `public."${tableName}"`;
      const parentRows = await transaction.$queryRawUnsafe<
        { exists: boolean; validPartitionKey: boolean }[]
      >(
        `SELECT relation.oid IS NOT NULL AS "exists",
                relation.relkind = 'p'
                  AND replace(replace(pg_get_partkeydef(relation.oid), '"', ''), ' ', '')
                    = 'RANGE(timestamp)' AS "validPartitionKey"
         FROM (SELECT to_regclass($1) AS oid) target
         LEFT JOIN pg_class relation ON relation.oid = target.oid`,
        parentTable,
      );
      const parent = parentRows[0];

      if (!parent?.exists) {
        skippedTables.push(tableName);
        continue;
      }

      if (!parent.validPartitionKey) {
        throw new Error(
          `${tableName} must be partitioned by RANGE ("timestamp") before pg_partman can manage it`,
        );
      }

      const configuredRows = await transaction.$queryRawUnsafe<
        { configured: boolean }[]
      >(
        `SELECT EXISTS (
           SELECT 1 FROM partman.part_config WHERE parent_table = $1
         ) AS configured`,
        parentTable,
      );

      if (!configuredRows[0]?.configured) {
        await transaction.$queryRawUnsafe(
          `SELECT partman.create_parent(
            $1,
            'timestamp',
            '1 month',
            p_type := 'range',
            p_premake := ${PREMAKE_MONTHS}
          )`,
          parentTable,
        );
      }

      const updatedRows = await transaction.$executeRawUnsafe(
        buildPartmanRetentionConfigSql(),
        parentTable,
      );
      if (updatedRows === 0) {
        throw new Error(`pg_partman configuration was not found for ${tableName}`);
      }

      maintained.push(tableName);
    }

    return { maintained, plannedPartitions, activePartitions, skippedTables };
  });

  for (const tableName of setup.maintained) {
    await prisma.$queryRawUnsafe(
      "SELECT partman.run_maintenance($1)",
      `public."${tableName}"`,
    );
  }

  const activePartitions: string[] = [];
  for (const tableName of setup.maintained) {
    const partitionRows = await prisma.$queryRawUnsafe<
      { partitionName: string }[]
    >(
      `SELECT child.relname AS "partitionName"
       FROM pg_inherits
       JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
       JOIN pg_class child ON child.oid = pg_inherits.inhrelid
       WHERE parent.oid = to_regclass($1)
       ORDER BY child.relname`,
      `public."${tableName}"`,
    );
    activePartitions.push(...partitionRows.map(({ partitionName }) => partitionName));
  }

  return { ...setup, activePartitions };
}