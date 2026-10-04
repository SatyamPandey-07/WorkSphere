/**
 * Monthly partition upkeep + retention for high-volume time-series tables (#3362).
 *
 * WifiTelemetry (venue telemetry) and AdminAuditLog are range-partitioned by
 * month (migration 20261003000000_partition_telemetry_audit_logs). Each run:
 *
 *  1. Pre-creates partitions for the current and next `aheadMonths` months.
 *     Rows already sitting in the DEFAULT partition for such a month are moved
 *     into it (otherwise PostgreSQL refuses to create the partition).
 *  2. Detaches partitions older than the retention window and DROPs them
 *     (telemetry) or moves them to an archive schema (audit logs). Legacy rows
 *     past retention in the DEFAULT partition get the same treatment.
 *     Steps 1–2 run in ONE transaction per table: a failure rolls the table
 *     back untouched.
 *  3. VACUUM (ANALYZE)s the active partitions (outside any transaction, as
 *     PostgreSQL requires).
 *
 * It uses a dedicated connection (DIRECT_URL preferred) instead of the Prisma
 * pool: the pool's 10 s statement_timeout would abort VACUUM/DETACH on large
 * partitions, a pooled connection can't hold a session advisory lock, and
 * VACUUM can't run inside a transaction.
 */

import { getPartitionRetentionCutoff } from "@/lib/partitionMaintenance";

export type ExpiryAction = "drop" | "archive";

export interface PartitionedTableSpec {
  table: string;
  partitionKey: string;
  /** Months kept, counting the current month. */
  retentionMonths: number;
  expiry: ExpiryAction;
  /** Required when expiry is "archive". */
  archiveSchema?: string;
  /** Future months to pre-create beyond the current one. Default 2. */
  aheadMonths?: number;
}

export const PARTITIONED_TABLES: PartitionedTableSpec[] = [
  // ~180 days of venue telemetry; raw readings have no long-term value.
  { table: "WifiTelemetry", partitionKey: "timestamp", retentionMonths: 6, expiry: "drop" },
  // Audit trails are kept longer and archived, never silently deleted.
  {
    table: "AdminAuditLog",
    partitionKey: "createdAt",
    retentionMonths: 24,
    expiry: "archive",
    archiveSchema: "audit_log_archive",
  },
];

/** Minimal client surface (satisfied by `pg.Client`). */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>;
  end(): Promise<void>;
}

export interface TableMaintenanceReport {
  table: string;
  created: string[];
  dropped: string[];
  archived: string[];
  /** Rows moved out of the DEFAULT partition into a newly created month. */
  defaultRowsRehomed: number;
  /** Rows past retention removed (drop) or archived (archive) from DEFAULT. */
  defaultRowsExpired: number;
  vacuumed: string[];
  errors: string[];
}

export interface RetentionRunReport {
  skipped?: string;
  tables: TableMaintenanceReport[];
}

// Arbitrary constant: one maintenance run at a time across all instances.
const ADVISORY_LOCK_KEY = 3362_0001;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}

const monthStart = (d: Date, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));

/**
 * Bind value for a `timestamp without time zone` column. node-postgres
 * serialises a JS Date in the *server process's local zone* (e.g.
 * "…T05:30:00+05:30"), and PostgreSQL drops the offset for this column type,
 * shifting every boundary by the local UTC offset. Always bind UTC ISO text.
 */
const utc = (d: Date) => d.toISOString();

export function partitionName(table: string, month: Date): string {
  return `${table}_y${month.getUTCFullYear()}m${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parsePartitionMonth(table: string, name: string): Date | null {
  if (!name.startsWith(`${table}_y`)) return null;
  const match = /^(\d{4})m(0[1-9]|1[0-2])$/.exec(name.slice(table.length + 2));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : null;
}

export function retentionMonthsFor(spec: PartitionedTableSpec, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[`PARTITION_RETENTION_MONTHS_${spec.table.toUpperCase()}`];
  const months = raw === undefined ? spec.retentionMonths : Number(raw);
  if (!Number.isInteger(months) || months < 1) {
    throw new RangeError(`Retention for ${spec.table} must be a positive integer number of months`);
  }
  return months;
}

export interface MaintenancePlan {
  create: Array<{ name: string; from: Date; to: Date }>;
  expire: string[];
  /** Rows with partitionKey < cutoff are past retention. */
  cutoff: Date;
}

/** Pure planning step: what to create and what to expire. */
export function planTableMaintenance(
  spec: PartitionedTableSpec,
  existing: string[],
  now: Date,
  retentionMonths = spec.retentionMonths,
): MaintenancePlan {
  const cutoff = getPartitionRetentionCutoff(now, retentionMonths);
  const have = new Set(existing);
  const create: MaintenancePlan["create"] = [];
  for (let offset = 0; offset <= (spec.aheadMonths ?? 2); offset++) {
    const from = monthStart(now, offset);
    const name = partitionName(spec.table, from);
    if (!have.has(name)) create.push({ name, from, to: monthStart(now, offset + 1) });
  }
  const expire = existing.filter((name) => {
    const month = parsePartitionMonth(spec.table, name);
    return month !== null && month < cutoff;
  });
  return { create, expire, cutoff };
}

async function listMonthlyPartitions(client: SqlClient, table: string): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT child.relname AS name
       FROM pg_inherits
       JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
       JOIN pg_class child ON pg_inherits.inhrelid = child.oid
       JOIN pg_namespace ns ON parent.relnamespace = ns.oid
      WHERE ns.nspname = 'public' AND parent.relname = $1
      ORDER BY child.relname`,
    [table],
  );
  return rows.map((r) => r.name).filter((n) => parsePartitionMonth(table, n) !== null);
}

async function isPartitioned(client: SqlClient, table: string): Promise<boolean> {
  const { rows } = await client.query<{ kind: string }>(
    `SELECT c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [table],
  );
  return rows[0]?.kind === "p";
}

async function hasDefaultPartition(client: SqlClient, table: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [`${table}_default`],
  );
  return rows.length > 0;
}

/** Steps 1–2 for one table, inside a single transaction. */
async function maintainTable(
  client: SqlClient,
  spec: PartitionedTableSpec,
  now: Date,
  report: TableMaintenanceReport,
): Promise<void> {
  const retention = retentionMonthsFor(spec);
  if (spec.expiry === "archive" && !spec.archiveSchema) {
    throw new Error(`${spec.table}: archive expiry needs an archiveSchema`);
  }
  if (!(await isPartitioned(client, spec.table))) {
    throw new Error(`${spec.table} is not partitioned (migration not applied?)`);
  }

  const parent = ident(spec.table);
  const key = ident(spec.partitionKey);
  const def = ident(`${spec.table}_default`);
  const withDefault = await hasDefaultPartition(client, spec.table);

  await client.query("BEGIN");
  try {
    const plan = planTableMaintenance(spec, await listMonthlyPartitions(client, spec.table), now, retention);

    // 1. Upcoming partitions (moving matching DEFAULT rows into them first).
    for (const { name, from, to } of plan.create) {
      const part = ident(name);
      let moved = 0;
      if (withDefault) {
        await client.query(`LOCK TABLE ${def} IN ACCESS EXCLUSIVE MODE`);
        const res = await client.query(
          `CREATE TEMP TABLE partition_move_3362 ON COMMIT DROP AS
             SELECT * FROM ${def} WHERE ${key} >= $1 AND ${key} < $2`,
          [utc(from), utc(to)],
        );
        moved = res.rowCount ?? 0;
        if (moved > 0) await client.query(`DELETE FROM ${def} WHERE ${key} >= $1 AND ${key} < $2`, [utc(from), utc(to)]);
      }
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${part} PARTITION OF ${parent} FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`,
      );
      if (withDefault) {
        if (moved > 0) await client.query(`INSERT INTO ${parent} SELECT * FROM partition_move_3362`);
        await client.query(`DROP TABLE partition_move_3362`);
      }
      report.created.push(name);
      report.defaultRowsRehomed += moved;
    }

    // 2. Retention: expired monthly partitions...
    if (spec.expiry === "archive") {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ident(spec.archiveSchema!)}`);
    }
    for (const name of plan.expire) {
      await client.query(`ALTER TABLE ${parent} DETACH PARTITION ${ident(name)}`);
      if (spec.expiry === "drop") {
        await client.query(`DROP TABLE ${ident(name)}`);
        report.dropped.push(name);
      } else {
        await client.query(`ALTER TABLE ${ident(name)} SET SCHEMA ${ident(spec.archiveSchema!)}`);
        report.archived.push(name);
      }
    }

    // ...and legacy rows past retention left in the DEFAULT partition.
    if (withDefault) {
      if (spec.expiry === "archive") {
        const archive = `${ident(spec.archiveSchema!)}.${ident(`${spec.table}_default_expired`)}`;
        await client.query(`CREATE TABLE IF NOT EXISTS ${archive} (LIKE ${parent} INCLUDING DEFAULTS)`);
        await client.query(`INSERT INTO ${archive} SELECT * FROM ${def} WHERE ${key} < $1`, [utc(plan.cutoff)]);
      }
      const res = await client.query(`DELETE FROM ${def} WHERE ${key} < $1`, [utc(plan.cutoff)]);
      report.defaultRowsExpired += res.rowCount ?? 0;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Nothing above took effect.
    report.created = [];
    report.dropped = [];
    report.archived = [];
    report.defaultRowsRehomed = 0;
    report.defaultRowsExpired = 0;
    throw err;
  }
}

/** Step 3: refresh planner stats / reclaim space on the partitions being written. */
async function vacuumActive(client: SqlClient, spec: PartitionedTableSpec, now: Date, report: TableMaintenanceReport) {
  const attached = new Set(await listMonthlyPartitions(client, spec.table));
  const ahead = spec.aheadMonths ?? 2;
  for (let offset = 0; offset <= ahead; offset++) {
    const name = partitionName(spec.table, monthStart(now, offset));
    if (!attached.has(name)) continue;
    try {
      await client.query(`VACUUM (ANALYZE) ${ident(name)}`);
      report.vacuumed.push(name);
    } catch (err) {
      report.errors.push(`VACUUM ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function defaultConnect(): Promise<SqlClient> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** Run partition upkeep and retention for every configured table. */
export async function runPartitionRetention(options: {
  now?: Date;
  tables?: PartitionedTableSpec[];
  connect?: () => Promise<SqlClient>;
} = {}): Promise<RetentionRunReport> {
  const now = options.now ?? new Date();
  const tables = options.tables ?? PARTITIONED_TABLES;
  const client = await (options.connect ?? defaultConnect)();

  try {
    // Maintenance may legitimately run long; but never queue behind live
    // traffic for exclusive locks (DETACH/LOCK) — fail fast, retry next run.
    await client.query("SET statement_timeout = 0");
    await client.query("SET lock_timeout = '5s'");

    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [ADVISORY_LOCK_KEY]);
    if (!rows[0]?.locked) {
      return { skipped: "Another partition maintenance run is in progress", tables: [] };
    }

    try {
      const reports: TableMaintenanceReport[] = [];
      for (const spec of tables) {
        const report: TableMaintenanceReport = {
          table: spec.table,
          created: [],
          dropped: [],
          archived: [],
          defaultRowsRehomed: 0,
          defaultRowsExpired: 0,
          vacuumed: [],
          errors: [],
        };
        try {
          await maintainTable(client, spec, now, report);
          await vacuumActive(client, spec, now, report);
        } catch (err) {
          report.errors.push(err instanceof Error ? err.message : String(err));
        }
        reports.push(report);
      }
      return { tables: reports };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}
