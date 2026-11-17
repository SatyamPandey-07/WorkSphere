/**
 * @jest-environment node
 *
 * Weekly partition management cron for the nomad audit log / check-in
 * telemetry tables (#7489): pre-creates the next two weekly partitions,
 * detaches + archives partitions older than 90 days, and must stay
 * idempotent across overlapping runs.
 */
import { NextRequest } from "next/server";
import {
  WEEKLY_PARTITIONED_TABLES,
  isoWeekStart,
  isoYearAndWeek,
  parseWeekPartition,
  planWeeklyMaintenance,
  retentionDaysFor,
  runWeeklyPartitionMaintenance,
  weekStart,
  weeklyPartitionName,
  type SqlClient,
  type WeeklyPartitionedTableSpec,
} from "@/lib/database/partitionManager";

const audit = WEEKLY_PARTITIONED_TABLES.find(
  (t) => t.table === "AdminAuditLog",
)!;
const checkIn = WEEKLY_PARTITIONED_TABLES.find((t) => t.table === "CheckIn")!;

// Wednesday, 2026-11-11 — ISO week 46 (Monday 2026-11-09).
const NOW = new Date("2026-11-11T10:30:00Z");
const WEEK46 = new Date("2026-11-09T00:00:00Z");

// ─── Pure logic ───────────────────────────────────────────────────────────────

describe("ISO week math", () => {
  it("snaps any timestamp to its Monday 00:00 UTC week start", () => {
    expect(weekStart(NOW)).toEqual(WEEK46);
    // Sunday still belongs to the previous Monday.
    expect(weekStart(new Date("2026-11-15T23:59:59Z"))).toEqual(WEEK46);
    expect(weekStart(new Date("2026-11-16T00:00:01Z"))).toEqual(
      new Date("2026-11-16T00:00:00Z"),
    );
  });

  it("names partitions <table>_y{YYYY}w{WW} and parses them back", () => {
    expect(weeklyPartitionName("AdminAuditLog", NOW)).toBe(
      "AdminAuditLog_y2026w46",
    );
    expect(parseWeekPartition("AdminAuditLog", "AdminAuditLog_y2026w46")).toEqual(WEEK46);
    // ISO year can differ from the calendar year at the boundary.
    expect(weeklyPartitionName("AdminAuditLog", new Date("2027-01-01T12:00Z"))).toBe(
      "AdminAuditLog_y2026w53",
    );
    expect(parseWeekPartition("AdminAuditLog", "AdminAuditLog_y2026w53")).toEqual(
      new Date("2026-12-28T00:00:00Z"),
    );
  });

  it("rejects foreign tables, catch-all names, and impossible weeks", () => {
    expect(parseWeekPartition("AdminAuditLog", "CheckIn_y2026w46")).toBeNull();
    expect(parseWeekPartition("AdminAuditLog", "AdminAuditLog_default")).toBeNull();
    expect(parseWeekPartition("AdminAuditLog", "AdminAuditLog_y2026w00")).toBeNull();
    expect(parseWeekPartition("AdminAuditLog", "AdminAuditLog_y2026w54")).toBeNull();
    // 2025 has only 52 ISO weeks (week 53 would fall into 2026-w01).
    expect(parseWeekPartition("AdminAuditLog", "AdminAuditLog_y2025w53")).toBeNull();
    expect(isoWeekStart(2025, 53)).toBeNull();
    expect(isoWeekStart(2026, 46)).toEqual(WEEK46);
  });

  it("round-trips every week of a full year", () => {
    for (let monday = isoWeekStart(2026, 1)!; monday <= new Date("2026-12-31T23:59:59Z"); ) {
      const { year, week } = isoYearAndWeek(monday);
      expect(year).toBe(2026);
      expect(weeklyPartitionName("AdminAuditLog", monday)).toBe(
        `AdminAuditLog_y2026w${String(week).padStart(2, "0")}`,
      );
      expect(isoWeekStart(year, week)).toEqual(monday);
      monday = new Date(monday.getTime() + 7 * 86_400_000);
    }
  });
});

describe("planning", () => {
  it("pre-creates only the missing current + 2 upcoming weeks", () => {
    const existing = [
      "AdminAuditLog_y2026w30",
      "AdminAuditLog_y2026w31",
      "AdminAuditLog_y2026w32",
      "AdminAuditLog_y2026w33",
      "AdminAuditLog_y2026w46", // current week already exists
    ];
    const plan = planWeeklyMaintenance(audit, existing, NOW);
    expect(plan.create.map((c) => c.name)).toEqual([
      "AdminAuditLog_y2026w47",
      "AdminAuditLog_y2026w48",
    ]);
    expect(plan.create[0].from).toEqual(new Date("2026-11-16T00:00:00Z"));
    expect(plan.create[0].to).toEqual(new Date("2026-11-23T00:00:00Z"));
  });

  it("expires partitions older than 90 days and keeps boundary weeks", () => {
    const existing = [
      "AdminAuditLog_y2026w30", // ends 2026-07-27 — expired
      "AdminAuditLog_y2026w31", // ends 2026-08-03 — expired
      "AdminAuditLog_y2026w32", // ends 2026-08-10 — expired
      "AdminAuditLog_y2026w33", // ends 2026-08-17 — after cutoff, kept
      "AdminAuditLog_y2026w46",
    ];
    const plan = planWeeklyMaintenance(audit, existing, NOW);
    expect(plan.cutoff).toEqual(new Date("2026-08-13T10:30:00Z"));
    expect(plan.expire).toEqual([
      "AdminAuditLog_y2026w30",
      "AdminAuditLog_y2026w31",
      "AdminAuditLog_y2026w32",
    ]);
    // Irrelevant/non-weekly children are never expired.
    expect(
      planWeeklyMaintenance(audit, [...existing, "AdminAuditLog_default"], NOW).expire,
    ).toHaveLength(3);
  });

  it("reads retention-day overrides from the environment and validates them", () => {
    expect(retentionDaysFor(audit, {})).toBe(90);
    expect(retentionDaysFor(checkIn, {})).toBe(90);
    expect(
      retentionDaysFor(audit, { PARTITION_RETENTION_DAYS_ADMINAUDITLOG: "45" }),
    ).toBe(45);
    expect(() =>
      retentionDaysFor(audit, { PARTITION_RETENTION_DAYS_ADMINAUDITLOG: "0" }),
    ).toThrow(RangeError);
    expect(() =>
      retentionDaysFor(audit, { PARTITION_RETENTION_DAYS_ADMINAUDITLOG: "1.5" }),
    ).toThrow(RangeError);
  });

  it("archives audit + check-in partitions by default", () => {
    expect(audit).toMatchObject({
      expiry: "archive",
      archiveSchema: "audit_log_archive",
    });
    expect(checkIn).toMatchObject({
      expiry: "archive",
      archiveSchema: "checkin_archive",
    });
  });
});

// ─── Maintenance run against a fake pg client ──────────────────────────────────

interface Query {
  text: string;
  params?: unknown[];
}

function fakeClient(
  handle: (
    text: string,
    params?: unknown[],
  ) => { rows: Record<string, unknown>[]; rowCount?: number | null },
): { client: SqlClient; queries: Query[] } {
  const queries: Query[] = [];
  const client: SqlClient = {
    query: async (text, params) => {
      queries.push({ text, params });
      return handle(text, params);
    },
    end: async () => {},
  };
  return { client, queries };
}

/** Default fake answers: partitioned parent, no DEFAULT partition, empty lists. */
function standardHandlers(
  overrides: Record<
    string,
    (
      text: string,
      params?: unknown[],
    ) => { rows: Record<string, unknown>[]; rowCount?: number | null }
  > = {},
) {
  return (
    text: string,
    params?: unknown[],
  ): { rows: Record<string, unknown>[]; rowCount?: number | null } => {
    for (const [needle, handler] of Object.entries(overrides)) {
      if (text.includes(needle)) return handler(text, params);
    }
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (text.includes("relkind")) return { rows: [{ kind: "p" }] };
    if (text.includes("pg_inherits")) return { rows: [] };
    if (text.includes("relname = $1")) return { rows: [] }; // no DEFAULT partition
    return { rows: [], rowCount: 0 };
  };
}

describe("runWeeklyPartitionMaintenance", () => {
  it("creates the next two weekly partitions and archives expired ones", async () => {
    const existing = [
      "AdminAuditLog_y2026w30",
      "AdminAuditLog_y2026w31",
      "AdminAuditLog_y2026w32",
      "AdminAuditLog_y2026w33",
      "AdminAuditLog_y2026w46",
    ];
    const { client, queries } = fakeClient(
      standardHandlers({
        "pg_inherits": () => ({ rows: existing.map((name) => ({ name })) }),
      }),
    );

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [audit],
      connect: async () => client,
    });

    expect(report.skipped).toBeUndefined();
    expect(report.tables).toHaveLength(1);
    const table = report.tables[0];
    expect(table.errors).toEqual([]);
    expect(table.created).toEqual(["AdminAuditLog_y2026w47", "AdminAuditLog_y2026w48"]);
    expect(table.archived).toEqual([
      "AdminAuditLog_y2026w30",
      "AdminAuditLog_y2026w31",
      "AdminAuditLog_y2026w32",
    ]);

    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).toContain(
      `CREATE TABLE IF NOT EXISTS "AdminAuditLog_y2026w47" PARTITION OF "AdminAuditLog" FOR VALUES FROM ('2026-11-16T00:00:00.000Z') TO ('2026-11-23T00:00:00.000Z')`,
    );
    expect(sql).toContain(
      `CREATE TABLE IF NOT EXISTS "AdminAuditLog_y2026w48" PARTITION OF "AdminAuditLog" FOR VALUES FROM ('2026-11-23T00:00:00.000Z') TO ('2026-11-30T00:00:00.000Z')`,
    );
    expect(sql).toContain(`ALTER TABLE "AdminAuditLog" DETACH PARTITION "AdminAuditLog_y2026w30"`);
    expect(sql).toContain(`CREATE SCHEMA IF NOT EXISTS "audit_log_archive"`);
    expect(sql).toContain(`ALTER TABLE "AdminAuditLog_y2026w30" SET SCHEMA "audit_log_archive"`);
    // Boundary week and current week are left untouched.
    expect(sql).not.toContain("AdminAuditLog_y2026w33");
    expect(sql).not.toContain(`DETACH PARTITION "AdminAuditLog_y2026w46"`);
    // One transaction per table, lock taken and released.
    expect(queries.filter((q) => q.text === "BEGIN")).toHaveLength(1);
    expect(sql).toContain("pg_try_advisory_lock");
    expect(sql).toContain("pg_advisory_unlock");
  });

  it("is idempotent: a re-run with the partitions present issues no DDL", async () => {
    const existing = [
      "AdminAuditLog_y2026w33",
      "AdminAuditLog_y2026w46",
      "AdminAuditLog_y2026w47",
      "AdminAuditLog_y2026w48",
    ];
    const { client, queries } = fakeClient(
      standardHandlers({
        "pg_inherits": () => ({ rows: existing.map((name) => ({ name })) }),
      }),
    );

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [audit],
      connect: async () => client,
    });

    const table = report.tables[0];
    expect(table.errors).toEqual([]);
    expect(table.created).toEqual([]);
    expect(table.archived).toEqual([]);
    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).not.toMatch(/CREATE TABLE (IF NOT EXISTS )?"AdminAuditLog_y2026/);
    expect(sql).not.toMatch(/DETACH PARTITION/);
  });

  it("skips the run entirely when another instance holds the advisory lock", async () => {
    const { client, queries } = fakeClient(
      standardHandlers({
        "pg_try_advisory_lock": () => ({ rows: [{ locked: false }] }),
      }),
    );

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [audit],
      connect: async () => client,
    });

    expect(report.skipped).toMatch(/in progress/);
    expect(report.tables).toEqual([]);
    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).not.toContain("BEGIN");
    expect(sql).not.toMatch(/CREATE TABLE/);
    expect(sql).not.toMatch(/DETACH PARTITION/);
  });

  it("moves DEFAULT-partition rows into the new weekly partition before creating it", async () => {
    const { client, queries } = fakeClient(
      standardHandlers({
        "pg_inherits": () => ({ rows: [{ name: "AdminAuditLog_y2026w46" }] }),
        "SELECT 1 FROM pg_class": () => ({ rows: [{ "?column?": 1 }] }), // DEFAULT partition exists
        "CREATE TEMP TABLE": () => ({ rows: [], rowCount: 5 }),
      }),
    );

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [audit],
      connect: async () => client,
    });

    const table = report.tables[0];
    expect(table.errors).toEqual([]);
    // Both created weeks rehomed 5 rows each from the DEFAULT partition.
    expect(table.defaultRowsRehomed).toBe(10);
    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).toContain(`CREATE TEMP TABLE partition_move_7489`);
    expect(sql).toContain(`DELETE FROM "AdminAuditLog_default"`);
    expect(sql).toContain(`INSERT INTO "AdminAuditLog" SELECT * FROM partition_move_7489`);
    // Boundaries are bound as UTC ISO strings (never local-zone Dates).
    const deleteQueries = queries.filter((q) => q.text.startsWith("DELETE FROM"));
    expect(deleteQueries).toHaveLength(2);
    expect(deleteQueries[0].params).toEqual([
      "2026-11-16T00:00:00.000Z",
      "2026-11-23T00:00:00.000Z",
    ]);
  });

  it("drops instead of archiving when expiry is drop", async () => {
    const noise: WeeklyPartitionedTableSpec = {
      table: "NoiseMetric",
      partitionKey: "recordedAt",
      retentionDays: 90,
      expiry: "drop",
    };
    const existing = ["NoiseMetric_y2026w30", "NoiseMetric_y2026w46"];
    const { client, queries } = fakeClient(
      standardHandlers({
        "pg_inherits": () => ({ rows: existing.map((name) => ({ name })) }),
      }),
    );

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [noise],
      connect: async () => client,
    });

    const table = report.tables[0];
    expect(table.dropped).toEqual(["NoiseMetric_y2026w30"]);
    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).toContain(`DROP TABLE "NoiseMetric_y2026w30"`);
    expect(sql).not.toContain("SET SCHEMA");
  });

  it("records an error for unpartitioned parents and keeps processing other tables", async () => {
    const legacy: WeeklyPartitionedTableSpec = {
      table: "LegacyLog",
      partitionKey: "createdAt",
      retentionDays: 90,
      expiry: "drop",
    };
    const existing = ["AdminAuditLog_y2026w46"];
    const { client, queries } = fakeClient(
      standardHandlers({
        "relkind": (_text, params) => ({
          rows: [{ kind: params?.[0] === "LegacyLog" ? "r" : "p" }],
        }),
        "pg_inherits": () => ({ rows: existing.map((name) => ({ name })) }),
      }),
    );

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [legacy, audit],
      connect: async () => client,
    });

    expect(report.tables).toHaveLength(2);
    expect(report.tables[0].errors[0]).toMatch(/LegacyLog is not partitioned/);
    expect(report.tables[1].errors).toEqual([]);
    expect(report.tables[1].created).toEqual([
      "AdminAuditLog_y2026w47",
      "AdminAuditLog_y2026w48",
    ]);
    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).not.toContain(`"LegacyLog"`);
  });

  it("rolls the table back and reports the error when a statement fails", async () => {
    const existing = ["AdminAuditLog_y2026w30", "AdminAuditLog_y2026w46"];
    const { client, queries } = fakeClient((text) => {
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (text.includes("relkind")) return { rows: [{ kind: "p" }] };
      if (text.includes("pg_inherits")) return { rows: existing.map((name) => ({ name })) };
      if (text.includes("relname = $1")) return { rows: [] };
      if (text.startsWith("CREATE TABLE")) {
        throw new Error('relation "AdminAuditLog_y2026w47" already exists');
      }
      return { rows: [], rowCount: 0 };
    });

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [audit],
      connect: async () => client,
    });

    const table = report.tables[0];
    expect(table.errors[0]).toMatch(/already exists/);
    expect(table.created).toEqual([]);
    expect(table.archived).toEqual([]);
    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("DETACH PARTITION");
  });

  it("rejects unsafe identifiers before touching the database", async () => {
    const evil: WeeklyPartitionedTableSpec = {
      table: 'x"; DROP TABLE "User',
      partitionKey: "createdAt",
      retentionDays: 90,
      expiry: "drop",
    };
    const { client, queries } = fakeClient(standardHandlers());

    const report = await runWeeklyPartitionMaintenance({
      now: NOW,
      tables: [evil],
      connect: async () => client,
    });

    expect(report.tables[0].errors[0]).toMatch(/Unsafe SQL identifier/);
    expect(
      queries.some((q) => q.text.includes('DROP TABLE "User')),
    ).toBe(false);
  });
});

// ─── Cron endpoint ─────────────────────────────────────────────────────────────

import * as partitionManager from "@/lib/database/partitionManager";
import { GET, POST } from "@/app/api/admin/system/partitions/route";

function makeRequest(secret?: string, method: "GET" | "POST" = "GET"): NextRequest {
  return new NextRequest("http://localhost/api/admin/system/partitions", {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("POST/GET /api/admin/system/partitions (weekly cron #7489)", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeAll(() => {
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockRun = () =>
    jest.spyOn(partitionManager, "runWeeklyPartitionMaintenance");

  it("rejects requests without or with a wrong bearer secret", async () => {
    const res1 = await POST(makeRequest());
    expect(res1.status).toBe(401);
    const res2 = await GET(makeRequest("wrong-secret"));
    expect(res2.status).toBe(401);
  });

  it("runs weekly maintenance and reports created + archived partitions", async () => {
    const runMock = mockRun();
    runMock.mockResolvedValue({
      tables: [
        {
          table: "AdminAuditLog",
          created: ["AdminAuditLog_y2026w47", "AdminAuditLog_y2026w48"],
          archived: ["AdminAuditLog_y2026w30"],
          dropped: [],
          defaultRowsRehomed: 0,
          errors: [],
        },
        {
          table: "CheckIn",
          created: ["CheckIn_y2026w47"],
          archived: [],
          dropped: [],
          defaultRowsRehomed: 0,
          errors: [],
        },
      ],
    });

    const res = await POST(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(json.createdPartitions).toEqual([
      "AdminAuditLog_y2026w47",
      "AdminAuditLog_y2026w48",
      "CheckIn_y2026w47",
    ]);
    expect(json.archivedPartitions).toEqual(["AdminAuditLog_y2026w30"]);
    expect(json.tables).toHaveLength(2);
  });

  it("also answers GET for schedulers that cannot send POST", async () => {
    const runMock = mockRun();
    runMock.mockResolvedValue({ tables: [] });
    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("returns 207 multi-status when some tables fail", async () => {
    const runMock = mockRun();
    runMock.mockResolvedValue({
      tables: [
        {
          table: "CheckIn",
          created: [],
          archived: [],
          dropped: [],
          defaultRowsRehomed: 0,
          errors: ["CheckIn is not partitioned (migration not applied?)"],
        },
      ],
    });

    const res = await POST(makeRequest("test-cron-secret"));
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("reports a skipped run without failing", async () => {
    const runMock = mockRun();
    runMock.mockResolvedValue({
      skipped: "Another weekly partition maintenance run is in progress",
      tables: [],
    });

    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.skipped).toMatch(/in progress/);
  });

  it("returns 500 when maintenance throws", async () => {
    const runMock = mockRun();
    runMock.mockRejectedValue(new Error("connection refused"));
    const res = await POST(makeRequest("test-cron-secret"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("connection refused");
  });
});
