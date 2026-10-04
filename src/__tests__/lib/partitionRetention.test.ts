/**
 * @jest-environment node
 *
 * Partition upkeep + retention for WifiTelemetry / AdminAuditLog (#3362).
 *
 * The "PostgreSQL" suite runs the real migration and maintenance against a
 * live database. It is opt-in: set PARTITION_TEST_DATABASE_URL to a server
 * where the user may CREATE/DROP DATABASE, e.g.
 *
 *   docker run -d --rm -p 55433:5432 -e POSTGRES_PASSWORD=pw pgvector/pgvector:pg17
 *   PARTITION_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55433/postgres \
 *     npx jest src/__tests__/lib/partitionRetention.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";
import {
  PARTITIONED_TABLES,
  parsePartitionMonth,
  partitionName,
  planTableMaintenance,
  retentionMonthsFor,
  runPartitionRetention,
  type PartitionedTableSpec,
} from "@/lib/partitionRetention";

const telemetry = PARTITIONED_TABLES.find((t) => t.table === "WifiTelemetry")!;
const audit = PARTITIONED_TABLES.find((t) => t.table === "AdminAuditLog")!;

// ─── Pure logic ───────────────────────────────────────────────────────────────

describe("planning", () => {
  it("names and parses monthly partitions per table", () => {
    const d = new Date(Date.UTC(2027, 0, 1));
    expect(partitionName("WifiTelemetry", d)).toBe("WifiTelemetry_y2027m01");
    expect(parsePartitionMonth("WifiTelemetry", "WifiTelemetry_y2027m01")).toEqual(d);
    expect(parsePartitionMonth("WifiTelemetry", "AdminAuditLog_y2027m01")).toBeNull();
    expect(parsePartitionMonth("WifiTelemetry", "WifiTelemetry_default")).toBeNull();
    expect(parsePartitionMonth("WifiTelemetry", "WifiTelemetry_y2027m13")).toBeNull();
  });

  it("plans the missing current/next-two months and the expired ones", () => {
    const now = new Date("2026-12-15T10:00:00Z");
    const existing = ["WifiTelemetry_y2026m05", "WifiTelemetry_y2026m06", "WifiTelemetry_y2026m07", "WifiTelemetry_y2026m12"];
    const plan = planTableMaintenance(telemetry, existing, now);
    expect(plan.create.map((c) => c.name)).toEqual(["WifiTelemetry_y2027m01", "WifiTelemetry_y2027m02"]);
    expect(plan.create[0].to).toEqual(new Date(Date.UTC(2027, 1, 1)));
    // 6-month retention keeps Jul–Dec 2026
    expect(plan.expire).toEqual(["WifiTelemetry_y2026m05", "WifiTelemetry_y2026m06"]);
    expect(plan.cutoff).toEqual(new Date(Date.UTC(2026, 6, 1)));
  });

  it("reads retention overrides from the environment and validates them", () => {
    expect(retentionMonthsFor(telemetry, {})).toBe(6);
    expect(retentionMonthsFor(telemetry, { PARTITION_RETENTION_MONTHS_WIFITELEMETRY: "3" })).toBe(3);
    expect(() => retentionMonthsFor(audit, { PARTITION_RETENTION_MONTHS_ADMINAUDITLOG: "0" })).toThrow(RangeError);
    expect(() => retentionMonthsFor(audit, { PARTITION_RETENTION_MONTHS_ADMINAUDITLOG: "1.5" })).toThrow(RangeError);
  });

  it("archives audit logs and drops telemetry by default", () => {
    expect(telemetry).toMatchObject({ expiry: "drop", retentionMonths: 6 });
    expect(audit).toMatchObject({ expiry: "archive", archiveSchema: "audit_log_archive" });
  });

  it("binds timestamps as UTC ISO strings, never local-zone Dates", async () => {
    // node-postgres sends Date params in the process's local zone; for
    // `timestamp without time zone` that shifts every month boundary.
    const params: unknown[] = [];
    const fake = {
      query: async (text: string, p?: unknown[]) => {
        if (p) params.push(...p);
        if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (text.includes("relkind")) return { rows: [{ kind: "p" }] };
        if (text.includes("relname = $1") && p?.[0] === "WifiTelemetry_default") return { rows: [{ "?column?": 1 }] };
        return { rows: [], rowCount: 1 };
      },
      end: async () => {},
    };
    await runPartitionRetention({ now: new Date("2026-10-15T00:00:00Z"), tables: [telemetry], connect: async () => fake });
    const timestamps = params.filter((p) => p instanceof Date || (typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p)));
    expect(timestamps.length).toBeGreaterThan(0);
    for (const t of timestamps) expect(t).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });

  it("rejects unsafe identifiers before touching the database", async () => {
    const queries: string[] = [];
    const fake = {
      query: async (text: string) => {
        queries.push(text);
        if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (text.includes("relkind")) return { rows: [{ kind: "p" }] };
        return { rows: [] };
      },
      end: async () => {},
    };
    const evil: PartitionedTableSpec = { table: 'x"; DROP TABLE "User', partitionKey: "ts", retentionMonths: 1, expiry: "drop" };
    const report = await runPartitionRetention({ tables: [evil], connect: async () => fake });
    expect(report.tables[0].errors[0]).toMatch(/Unsafe SQL identifier/);
    expect(queries.some((q) => q.includes("DROP TABLE \"User"))).toBe(false);
  });
});

// ─── Real PostgreSQL ──────────────────────────────────────────────────────────

const ADMIN_URL = process.env.PARTITION_TEST_DATABASE_URL;
const describePg = ADMIN_URL ? describe : describe.skip;
const MIGRATION = readFileSync(
  join(process.cwd(), "prisma/migrations/20261003000000_partition_telemetry_audit_logs/migration.sql"),
  "utf8",
);

describePg("PostgreSQL: migration + maintenance", () => {
  jest.setTimeout(60_000);
  let dbName: string;
  let dbUrl: string;
  let db: Client;

  const monthOffset = (n: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1));
  };
  const connect = async () => {
    const c = new Client({ connectionString: dbUrl });
    await c.connect();
    return c;
  };
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await db.query(sql, params)).rows[0].n);
  const exists = async (schema: string, name: string) =>
    (await db.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`,
      [schema, name],
    )).rows.length > 0;
  const attached = async (table: string) =>
    (await db.query(
      `SELECT child.relname AS n FROM pg_inherits JOIN pg_class p ON inhparent=p.oid JOIN pg_class child ON inhrelid=child.oid WHERE p.relname=$1`,
      [table],
    )).rows.map((r) => r.n as string);

  beforeEach(async () => {
    dbName = `partition_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    dbUrl = u.toString();
    db = await connect();

    // Pre-#3362 schema: the exact unpartitioned DDL produced by earlier migrations.
    await db.query(`
      CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "Venue" ("id" TEXT PRIMARY KEY);
      INSERT INTO "User" VALUES ('u1'); INSERT INTO "Venue" VALUES ('v1');
      CREATE TABLE "WifiTelemetry" ("id" TEXT NOT NULL, "venueId" TEXT NOT NULL, "download" DOUBLE PRECISION NOT NULL,
        "upload" DOUBLE PRECISION NOT NULL, "latency" DOUBLE PRECISION NOT NULL, "crowdLevel" TEXT NOT NULL,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "WifiTelemetry_pkey" PRIMARY KEY ("id"));
      CREATE INDEX "WifiTelemetry_venueId_idx" ON "WifiTelemetry"("venueId");
      CREATE INDEX "WifiTelemetry_timestamp_idx" ON "WifiTelemetry"("timestamp");
      CREATE INDEX "WifiTelemetry_venueId_timestamp_idx" ON "WifiTelemetry"("venueId", "timestamp");
      ALTER TABLE "WifiTelemetry" ADD CONSTRAINT "WifiTelemetry_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      CREATE TABLE "AdminAuditLog" ("id" TEXT NOT NULL, "adminId" TEXT NOT NULL, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL, "details" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id"));
      CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
      ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      -- ~30 months of history and ~5 months of future-dated rows
      INSERT INTO "WifiTelemetry" (id, "venueId", download, upload, latency, "crowdLevel", "timestamp")
        SELECT 'w' || g, 'v1', 50, 10, 20, 'low', date_trunc('month', now()) + (g || ' days')::interval
        FROM generate_series(-900, 150, 3) g;
      INSERT INTO "AdminAuditLog" (id, "adminId", action, "entityType", "entityId", "createdAt")
        SELECT 'a' || g, 'u1', 'ban', 'User', 'x', date_trunc('month', now()) + (g || ' days')::interval
        FROM generate_series(-900, 150, 7) g;
    `);
  });

  afterEach(async () => {
    await db.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  const fingerprint = async (table: string, key: string) =>
    (await db.query(`SELECT count(*)::int AS n, md5(string_agg(id || "${key}"::text, ',' ORDER BY id)) AS h FROM "${table}"`)).rows[0];

  it("converts populated tables without losing a row, and is idempotent", async () => {
    const before = [await fingerprint("WifiTelemetry", "timestamp"), await fingerprint("AdminAuditLog", "createdAt")];
    await db.query(MIGRATION);
    await db.query(MIGRATION); // second run is a no-op
    expect([await fingerprint("WifiTelemetry", "timestamp"), await fingerprint("AdminAuditLog", "createdAt")]).toEqual(before);

    const kinds = (await db.query(`SELECT relname, relkind FROM pg_class WHERE relname IN ('WifiTelemetry','AdminAuditLog')`)).rows;
    expect(kinds.every((r) => r.relkind === "p")).toBe(true);
    expect(await attached("WifiTelemetry")).toContain("WifiTelemetry_default");
    expect(await exists("public", "WifiTelemetry_unpartitioned_3362")).toBe(false);
    const pk = (await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='WifiTelemetry_pkey'`)).rows[0].d;
    expect(pk).toBe('PRIMARY KEY (id, "timestamp")');
  });

  it("creates upcoming partitions, rehomes default rows and enforces retention in one run", async () => {
    await db.query(MIGRATION);
    // Run as if three months from now: three future months are new, and the
    // seeded future rows for them currently sit in the DEFAULT partition.
    const now = monthOffset(3);
    const telemetryRowsBefore = await count(`SELECT count(*) n FROM "WifiTelemetry"`);
    const report = await runPartitionRetention({ now, connect });
    const [t, a] = report.tables;
    expect(t.errors).toEqual([]);
    expect(a.errors).toEqual([]);

    // 1. upcoming partitions exist and hold their month's rows
    for (let i = 0; i <= 2; i++) {
      expect(await attached("WifiTelemetry")).toContain(partitionName("WifiTelemetry", monthOffset(3 + i)));
    }
    expect(t.defaultRowsRehomed).toBeGreaterThan(0);
    const misplaced = await count(
      `SELECT count(*) n FROM "WifiTelemetry_default" WHERE "timestamp" >= $1 AND "timestamp" < $2`,
      [monthOffset(3), monthOffset(6)],
    );
    expect(misplaced).toBe(0);

    // 2a. telemetry: partitions and default rows older than 6 months are gone
    const cutoff = monthOffset(3 - 5);
    expect(t.dropped.length).toBeGreaterThan(0);
    for (const name of t.dropped) expect(await exists("public", name)).toBe(false);
    expect(await count(`SELECT count(*) n FROM "WifiTelemetry" WHERE "timestamp" < $1`, [cutoff])).toBe(0);
    const expiredBefore = telemetryRowsBefore - (await count(`SELECT count(*) n FROM "WifiTelemetry"`));
    expect(expiredBefore).toBeGreaterThan(0); // something really was pruned

    // 2b. audit: nothing deleted — rows past 24 months moved to the archive schema
    const auditCutoff = monthOffset(3 - 23);
    expect(await count(`SELECT count(*) n FROM "AdminAuditLog" WHERE "createdAt" < $1`, [auditCutoff])).toBe(0);
    const archived = await count(`SELECT count(*) n FROM audit_log_archive."AdminAuditLog_default_expired"`);
    expect(archived).toBeGreaterThan(0);
    expect(archived).toBe(a.defaultRowsExpired);

    // 3. active partitions vacuumed + analyzed
    expect(t.vacuumed).toEqual([partitionName("WifiTelemetry", monthOffset(2)), partitionName("WifiTelemetry", now)]);

    // a second run has nothing left to do
    const again = await runPartitionRetention({ now, connect });
    expect(again.tables.map((r) => [r.created, r.dropped, r.archived, r.defaultRowsExpired])).toEqual([
      [[], [], [], 0],
      [[], [], [], 0],
    ]);
  });

  it("archives expired audit partitions instead of dropping them", async () => {
    await db.query(MIGRATION);
    // Shrink audit retention to 1 month so the migration's past partitions expire.
    const now = monthOffset(3);
    process.env.PARTITION_RETENTION_MONTHS_ADMINAUDITLOG = "1";
    try {
      const report = await runPartitionRetention({ now, connect, tables: [audit] });
      expect(report.tables[0].errors).toEqual([]);
      expect(report.tables[0].archived.length).toBeGreaterThan(0);
      for (const name of report.tables[0].archived) {
        expect(await exists("audit_log_archive", name)).toBe(true);
        expect(await exists("public", name)).toBe(false);
      }
    } finally {
      delete process.env.PARTITION_RETENTION_MONTHS_ADMINAUDITLOG;
    }
  });

  it("rolls the whole table back if any step fails", async () => {
    await db.query(MIGRATION);
    process.env.PARTITION_RETENTION_MONTHS_ADMINAUDITLOG = "1";
    const now = monthOffset(3);
    // Make archiving one expired partition collide with an existing table.
    const victim = partitionName("AdminAuditLog", monthOffset(-6));
    await db.query(`CREATE SCHEMA audit_log_archive; CREATE TABLE audit_log_archive."${victim}" (x int)`);
    const before = { parts: (await attached("AdminAuditLog")).sort(), rows: await fingerprint("AdminAuditLog", "createdAt") };
    try {
      const report = await runPartitionRetention({ now, connect, tables: [audit] });
      expect(report.tables[0].errors[0]).toMatch(/already exists/);
      expect(report.tables[0]).toMatchObject({ created: [], archived: [], defaultRowsExpired: 0 });
      // nothing changed: no new partitions, nothing detached, no rows moved
      expect((await attached("AdminAuditLog")).sort()).toEqual(before.parts);
      expect(await fingerprint("AdminAuditLog", "createdAt")).toEqual(before.rows);
    } finally {
      delete process.env.PARTITION_RETENTION_MONTHS_ADMINAUDITLOG;
    }
  });

  it("skips when another maintenance run holds the lock", async () => {
    await db.query(MIGRATION);
    await db.query("SELECT pg_advisory_lock(33620001)");
    const report = await runPartitionRetention({ connect });
    expect(report.skipped).toMatch(/in progress/);
    await db.query("SELECT pg_advisory_unlock(33620001)");
  });

  it("reports an unpartitioned table without blocking the others", async () => {
    // migration NOT applied
    const report = await runPartitionRetention({ connect });
    expect(report.tables.map((t) => t.errors[0])).toEqual([
      expect.stringMatching(/not partitioned/),
      expect.stringMatching(/not partitioned/),
    ]);
  });
});
