/**
 * Weekly range-partition maintenance for the high-volume nomad audit log and
 * check-in telemetry tables (#7489).
 *
 * These tables ingest millions of rows weekly; without rolling partitions,
 * sequential scans and index b-trees degrade. Each maintenance run:
 *
 *  1. Pre-creates the current week plus the next `aheadWeeks` (default 2)
 *     weekly partitions (`<table>_y{YYYY}w{WW}`), so live inserts never fail
 *     and never spill into a catch-all DEFAULT partition. Rows already
 *     sitting in the DEFAULT partition for such a week are moved into the
 *     new partition first (PostgreSQL refuses the CREATE otherwise).
 *  2. Detaches partitions whose data is wholly older than `retentionDays`
 *     (default 90) and moves them to a cold-storage archive schema — or
 *     drops them when the table has no archival value.
 *
 * Execution is idempotent (#7489: "prevent duplicate DDL statement errors"):
 * the planning step skips partitions that already exist, every CREATE uses
 * `IF NOT EXISTS`, and a session advisory lock keeps overlapping cron runs /
 * multiple instances from issuing duplicate DDL concurrently.
 *
 * A dedicated connection (DIRECT_URL preferred) is used instead of the
 * Prisma pool: the pool's 10 s statement_timeout would abort DETACH/CREATE
 * on large partitions, a pooled connection can't hold a session advisory
 * lock, and BEGIN/COMMIT control must stay with this module.
 *
 * Tables listed here must be `PARTITION BY RANGE` on their partition key;
 * the weekly DDL lives in migrations, this module only maintains the
 * rolling window.
 */

export type ExpiryAction = "drop" | "archive";

export interface WeeklyPartitionedTableSpec {
  table: string;
  partitionKey: string;
  /** Days of data kept attached; partitions ending before the cutoff expire. */
  retentionDays: number;
  expiry: ExpiryAction;
  /** Required when expiry is "archive". */
  archiveSchema?: string;
  /** Weeks pre-created beyond the current one. Default 2. */
  aheadWeeks?: number;
}

export const WEEKLY_PARTITIONED_TABLES: WeeklyPartitionedTableSpec[] = [
  // Nomad audit trails: 90 days hot, then detached to cold storage.
  {
    table: "AdminAuditLog",
    partitionKey: "createdAt",
    retentionDays: 90,
    expiry: "archive",
    archiveSchema: "audit_log_archive",
  },
  // Check-in telemetry: same 90-day hot window, archived for analytics.
  {
    table: "CheckIn",
    partitionKey: "createdAt",
    retentionDays: 90,
    expiry: "archive",
    archiveSchema: "checkin_archive",
  },
];

/** Minimal client surface (satisfied by `pg.Client`). */
export interface SqlClient {
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
  end(): Promise<void>;
}

export interface WeeklyTableReport {
  table: string;
  created: string[];
  archived: string[];
  dropped: string[];
  /** Rows moved out of the DEFAULT partition into newly created weeks. */
  defaultRowsRehomed: number;
  errors: string[];
  /** Populated when the table was skipped entirely (e.g. lock contention). */
  skipped?: string;
}

export interface WeeklyMaintenanceRunReport {
  skipped?: string;
  tables: WeeklyTableReport[];
}

export interface WeeklyMaintenancePlan {
  create: Array<{ name: string; from: Date; to: Date }>;
  expire: string[];
  /** Partitions ending before this instant are past retention. */
  cutoff: Date;
}

// One maintenance run at a time across all instances (issue #7489).
const ADVISORY_LOCK_KEY = 7489_0001;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}

/** Bind value for `timestamp without time zone` columns: always UTC ISO text. */
const utc = (d: Date) => d.toISOString();

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function weekStart(date: Date): Date {
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  // 0 = Monday ... 6 = Sunday
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return new Date(midnight - mondayOffset * DAY_MS);
}

/** Monday 00:00 UTC of ISO week 1 of `year` (the week containing Jan 4th). */
function isoWeek1Monday(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const mondayOffset = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - mondayOffset * DAY_MS;
}

/** ISO year and week number of the week whose Monday is `weekMonday`. */
export function isoYearAndWeek(weekMonday: Date): {
  year: number;
  week: number;
} {
  // The Thursday of that week decides the ISO year.
  const year = new Date(weekMonday.getTime() + 3 * DAY_MS).getUTCFullYear();
  const week =
    Math.round((weekMonday.getTime() - isoWeek1Monday(year)) / WEEK_MS) + 1;
  return { year, week };
}

/** Monday of ISO `week` in `year`; null when year/week is not a valid ISO week. */
export function isoWeekStart(year: number, week: number): Date | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(week) ||
    week < 1 ||
    week > 53
  ) {
    return null;
  }
  const candidate = new Date(isoWeek1Monday(year) + (week - 1) * WEEK_MS);
  // Round-trip: rejects week 53 in years that only have 52, etc.
  const round = isoYearAndWeek(candidate);
  return round.year === year && round.week === week ? candidate : null;
}

/** `<table>_y{YYYY}w{WW}` for the ISO week containing `date`. */
export function weeklyPartitionName(table: string, date: Date): string {
  const { year, week } = isoYearAndWeek(weekStart(date));
  return `${table}_y${year}w${String(week).padStart(2, "0")}`;
}

/** Inverse of `weeklyPartitionName`; null for other tables / junk names. */
export function parseWeekPartition(
  table: string,
  name: string,
): Date | null {
  if (!name.startsWith(`${table}_y`)) return null;
  const match = /^(\d{4})w(0[1-9]|[1-4]\d|5[0-3])$/.exec(
    name.slice(table.length + 2),
  );
  if (!match) return null;
  return isoWeekStart(Number(match[1]), Number(match[2]));
}

export function retentionDaysFor(
  spec: WeeklyPartitionedTableSpec,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[`PARTITION_RETENTION_DAYS_${spec.table.toUpperCase()}`];
  const days = raw === undefined ? spec.retentionDays : Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(
      `Retention for ${spec.table} must be a positive integer number of days`,
    );
  }
  return days;
}

/** Pure planning step: which weekly partitions to create and to expire. */
export function planWeeklyMaintenance(
  spec: WeeklyPartitionedTableSpec,
  existing: string[],
  now: Date,
  retentionDays = spec.retentionDays,
): WeeklyMaintenancePlan {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const have = new Set(existing);
  const create: WeeklyMaintenancePlan["create"] = [];
  const currentWeek = weekStart(now);
  for (let offset = 0; offset <= (spec.aheadWeeks ?? 2); offset++) {
    const from = new Date(currentWeek.getTime() + offset * WEEK_MS);
    const name = weeklyPartitionName(spec.table, from);
    if (!have.has(name)) {
      create.push({ name, from, to: new Date(from.getTime() + WEEK_MS) });
    }
  }
  const expire = existing.filter((name) => {
    const from = parseWeekPartition(spec.table, name);
    return from !== null && from.getTime() + WEEK_MS <= cutoff.getTime();
  });
  return { create, expire, cutoff };
}

async function listWeeklyPartitions(
  client: SqlClient,
  table: string,
): Promise<string[]> {
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
  return rows
    .map((r) => r.name)
    .filter((n) => parseWeekPartition(table, n) !== null);
}

async function isPartitioned(
  client: SqlClient,
  table: string,
): Promise<boolean> {
  const { rows } = await client.query<{ kind: string }>(
    `SELECT c.relkind AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [table],
  );
  return rows[0]?.kind === "p";
}

async function hasDefaultPartition(
  client: SqlClient,
  table: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [`${table}_default`],
  );
  return rows.length > 0;
}

/** Create upcoming + expire past partitions for one table, transactionally. */
async function maintainWeeklyTable(
  client: SqlClient,
  spec: WeeklyPartitionedTableSpec,
  now: Date,
  report: WeeklyTableReport,
): Promise<void> {
  const retention = retentionDaysFor(spec);
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
    const plan = planWeeklyMaintenance(
      spec,
      await listWeeklyPartitions(client, spec.table),
      now,
      retention,
    );

    // 1. Upcoming weeks (moving matching DEFAULT rows into them first).
    for (const { name, from, to } of plan.create) {
      const part = ident(name);
      let moved = 0;
      if (withDefault) {
        await client.query(`LOCK TABLE ${def} IN ACCESS EXCLUSIVE MODE`);
        const res = await client.query(
          `CREATE TEMP TABLE partition_move_7489 ON COMMIT DROP AS
             SELECT * FROM ${def} WHERE ${key} >= $1 AND ${key} < $2`,
          [utc(from), utc(to)],
        );
        moved = res.rowCount ?? 0;
        if (moved > 0) {
          await client.query(
            `DELETE FROM ${def} WHERE ${key} >= $1 AND ${key} < $2`,
            [utc(from), utc(to)],
          );
        }
      }
      // IF NOT EXISTS keeps re-runs/races free of duplicate DDL errors.
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${part} PARTITION OF ${parent} FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`,
      );
      if (withDefault) {
        if (moved > 0) {
          await client.query(
            `INSERT INTO ${parent} SELECT * FROM partition_move_7489`,
          );
        }
        await client.query(`DROP TABLE partition_move_7489`);
      }
      report.created.push(name);
      report.defaultRowsRehomed += moved;
    }

    // 2. Retention: detach expired weekly partitions, then archive or drop.
    if (plan.expire.length > 0 && spec.expiry === "archive") {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${ident(spec.archiveSchema!)}`);
    }
    for (const name of plan.expire) {
      await client.query(`ALTER TABLE ${parent} DETACH PARTITION ${ident(name)}`);
      if (spec.expiry === "drop") {
        await client.query(`DROP TABLE ${ident(name)}`);
        report.dropped.push(name);
      } else {
        await client.query(
          `ALTER TABLE ${ident(name)} SET SCHEMA ${ident(spec.archiveSchema!)}`,
        );
        report.archived.push(name);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Nothing above took effect.
    report.created = [];
    report.archived = [];
    report.dropped = [];
    report.defaultRowsRehomed = 0;
    throw err;
  }
}

async function defaultConnect(): Promise<SqlClient> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });
  await client.connect();
  return client;
}

/** Run weekly partition upkeep and retention for every configured table. */
export async function runWeeklyPartitionMaintenance(options: {
  now?: Date;
  tables?: WeeklyPartitionedTableSpec[];
  connect?: () => Promise<SqlClient>;
} = {}): Promise<WeeklyMaintenanceRunReport> {
  const now = options.now ?? new Date();
  const tables = options.tables ?? WEEKLY_PARTITIONED_TABLES;
  const client = await (options.connect ?? defaultConnect)();

  try {
    // Maintenance may legitimately run long; but never queue behind live
    // traffic for exclusive locks (DETACH/LOCK) — fail fast, retry next run.
    await client.query("SET statement_timeout = 0");
    await client.query("SET lock_timeout = '5s'");

    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      return {
        skipped: "Another weekly partition maintenance run is in progress",
        tables: [],
      };
    }

    try {
      const reports: WeeklyTableReport[] = [];
      for (const spec of tables) {
        const report: WeeklyTableReport = {
          table: spec.table,
          created: [],
          archived: [],
          dropped: [],
          defaultRowsRehomed: 0,
          errors: [],
        };
        try {
          await maintainWeeklyTable(client, spec, now, report);
        } catch (err) {
          report.errors.push(err instanceof Error ? err.message : String(err));
        }
        reports.push(report);
      }
      return { tables: reports };
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
        .catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}
