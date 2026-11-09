/**
 * Regression tests: admin bulk partition archive / delete.
 *
 * Two bugs lived here and hid each other:
 *  1. `isSafePartitionName` accepted the bare parent table name (e.g.
 *     "AdminAuditLog"), so the "safe name" check let a request target the
 *     partitioned table itself.
 *  2. A failed DETACH was swallowed with try/catch inside the transaction. In
 *     PostgreSQL a failed statement aborts the whole transaction, so archiving a
 *     detached partition or deleting an already-archived one always failed with
 *     "current transaction is aborted". That failure was also the only thing that
 *     stopped bug 1 from dropping the parent table.
 *
 * The service now asks the catalog what a name really is before touching it.
 */
import {
  bulkArchiveVenuePartitions,
  bulkDeleteVenuePartitions,
  isSafePartitionName,
} from "@/lib/adminPartitionService";

const mockTx = {
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
};
const mockPrisma = {
  $transaction: jest.fn(),
  adminAuditLog: { create: jest.fn() },
};

jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return mockPrisma;
  },
}));

type Catalog = {
  /** parent the partition is attached to in `public` */
  attachedParent?: string;
  /** archive schemas holding a detached table with this name */
  archivedIn?: string[];
  size?: number;
};

function useCatalog(catalog: Catalog) {
  mockTx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_inherits")) {
      return catalog.attachedParent ? [{ parent: catalog.attachedParent }] : [];
    }
    if (sql.includes("relkind = 'r'")) {
      return (catalog.archivedIn ?? []).map((schema) => ({ schema }));
    }
    if (sql.includes("pg_total_relation_size")) {
      return [{ size: catalog.size ?? 4096 }];
    }
    return [];
  });
}

const executed = () => mockTx.$executeRawUnsafe.mock.calls.map(([sql]) => String(sql));

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(mockTx),
  );
  mockTx.$executeRawUnsafe.mockResolvedValue(0);
  mockPrisma.adminAuditLog.create.mockResolvedValue({});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isSafePartitionName", () => {
  it.each([
    "AdminAuditLog",
    "WifiTelemetry",
    "TelemetryRecord",
    "PushNotificationLog",
    "AcousticTelemetry",
  ])("rejects the bare parent table name %s", (name) => {
    expect(isSafePartitionName(name)).toBe(false);
  });

  it("rejects a parent prefix with an empty suffix", () => {
    expect(isSafePartitionName("WifiTelemetry_")).toBe(false);
  });

  it.each([
    "WifiTelemetry_y2025m01",
    "AdminAuditLog_2026_09",
    "PushNotificationLog_default",
  ])("accepts the partition name %s", (name) => {
    expect(isSafePartitionName(name)).toBe(true);
  });

  it.each(['WifiTelemetry_y2025m01"; DROP TABLE "User"; --', "Wifi Telemetry_x", "../x", "ab"])(
    "rejects unsafe or malformed name %p",
    (name) => {
      expect(isSafePartitionName(name)).toBe(false);
    },
  );

  it("rejects unrelated tables", () => {
    expect(isSafePartitionName("User_y2025m01")).toBe(false);
  });
});

describe("bulkDeleteVenuePartitions", () => {
  it("never reaches the database for the bare parent table name", async () => {
    const result = await bulkDeleteVenuePartitions(["AdminAuditLog"], "admin-1");

    expect(result.success).toBe(false);
    expect(result.processed).toEqual([]);
    expect(result.failed[0].name).toBe("AdminAuditLog");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockTx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("refuses a name that passes the format check but is not a partition", async () => {
    useCatalog({}); // e.g. a regular table "AdminAuditLog_notes"

    const result = await bulkDeleteVenuePartitions(["AdminAuditLog_notes"], "admin-1");

    expect(result.success).toBe(false);
    expect(result.failed[0].error).toMatch(/refusing to drop/);
    expect(executed()).toEqual([]);
  });

  it("detaches and then drops an attached partition", async () => {
    useCatalog({ attachedParent: "WifiTelemetry", size: 8192 });

    const result = await bulkDeleteVenuePartitions(["WifiTelemetry_y2025m02"], "admin-1");

    expect(result).toMatchObject({ success: true, processed: ["WifiTelemetry_y2025m02"] });
    expect(result.freedBytes).toBe(8192);
    const sql = executed();
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain('"public"."WifiTelemetry" DETACH PARTITION "public"."WifiTelemetry_y2025m02"');
    expect(sql[1]).toContain('DROP TABLE "public"."WifiTelemetry_y2025m02"');
  });

  it("drops an already-archived partition without attempting a DETACH", async () => {
    useCatalog({ archivedIn: ["telemetry_archive"], size: 4096 });

    const result = await bulkDeleteVenuePartitions(["WifiTelemetry_y2025m01"], "admin-1");

    expect(result).toMatchObject({ success: true, processed: ["WifiTelemetry_y2025m01"] });
    expect(result.freedBytes).toBe(4096);
    const sql = executed();
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('DROP TABLE "telemetry_archive"."WifiTelemetry_y2025m01"');
    expect(sql.some((s) => s.includes("DETACH"))).toBe(false);
  });

  it("does not count bytes for a partition whose transaction failed", async () => {
    useCatalog({ attachedParent: "WifiTelemetry", size: 8192 });
    mockTx.$executeRawUnsafe.mockImplementation(async (sql: string) => {
      if (String(sql).includes("DROP TABLE")) throw new Error("lock timeout");
      return 0;
    });

    const result = await bulkDeleteVenuePartitions(["WifiTelemetry_y2025m02"], "admin-1");

    expect(result.success).toBe(false);
    expect(result.failed[0]).toEqual({
      name: "WifiTelemetry_y2025m02",
      error: "lock timeout",
    });
    expect(result.freedBytes).toBe(0);
    expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("records processed and failed partitions independently", async () => {
    mockTx.$queryRawUnsafe.mockImplementation(async (sql: string, name?: string) => {
      if (sql.includes("pg_inherits")) {
        return name === "WifiTelemetry_y2025m02" ? [{ parent: "WifiTelemetry" }] : [];
      }
      if (sql.includes("relkind = 'r'")) return [];
      return [{ size: 100 }];
    });

    const result = await bulkDeleteVenuePartitions(
      ["WifiTelemetry_y2025m02", "AdminAuditLog_notes", "AdminAuditLog"],
      "admin-1",
    );

    expect(result.processed).toEqual(["WifiTelemetry_y2025m02"]);
    expect(result.failed.map((f) => f.name)).toEqual(["AdminAuditLog_notes", "AdminAuditLog"]);
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe("bulkArchiveVenuePartitions", () => {
  it("never reaches the database for the bare parent table name", async () => {
    const result = await bulkArchiveVenuePartitions(["TelemetryRecord"], "admin-1");

    expect(result.success).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("detaches an attached partition and moves it into the archive schema", async () => {
    useCatalog({ attachedParent: "WifiTelemetry", size: 8192 });

    const result = await bulkArchiveVenuePartitions(["WifiTelemetry_y2025m02"], "admin-1");

    expect(result).toMatchObject({ success: true, processed: ["WifiTelemetry_y2025m02"] });
    expect(result.freedBytes).toBe(8192);
    expect(executed()).toEqual([
      'CREATE SCHEMA IF NOT EXISTS "telemetry_archive"',
      'ALTER TABLE "public"."WifiTelemetry" DETACH PARTITION "public"."WifiTelemetry_y2025m02"',
      'ALTER TABLE "public"."WifiTelemetry_y2025m02" SET SCHEMA "telemetry_archive"',
    ]);
  });

  it("archives push notification partitions into their own schema", async () => {
    useCatalog({ attachedParent: "PushNotificationLog" });

    await bulkArchiveVenuePartitions(["PushNotificationLog_y2025m02"], "admin-1");

    expect(executed()).toContain('CREATE SCHEMA IF NOT EXISTS "push_notification_archive"');
    expect(executed().at(-1)).toContain('SET SCHEMA "push_notification_archive"');
  });

  it("treats an already-archived partition as a successful no-op", async () => {
    useCatalog({ archivedIn: ["telemetry_archive"] });

    const result = await bulkArchiveVenuePartitions(["WifiTelemetry_y2025m01"], "admin-1");

    expect(result).toMatchObject({ success: true, processed: ["WifiTelemetry_y2025m01"] });
    expect(result.freedBytes).toBe(0);
    expect(executed()).toEqual([]);
  });

  it("refuses to archive something that is not an attached partition", async () => {
    useCatalog({});

    const result = await bulkArchiveVenuePartitions(["AdminAuditLog_notes"], "admin-1");

    expect(result.success).toBe(false);
    expect(result.failed[0].error).toMatch(/not an attached partition/);
    expect(executed()).toEqual([]);
  });

  it("does not count bytes when the move fails", async () => {
    useCatalog({ attachedParent: "WifiTelemetry", size: 8192 });
    mockTx.$executeRawUnsafe.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SET SCHEMA")) throw new Error("permission denied");
      return 0;
    });

    const result = await bulkArchiveVenuePartitions(["WifiTelemetry_y2025m02"], "admin-1");

    expect(result.success).toBe(false);
    expect(result.freedBytes).toBe(0);
  });

  it("returns per-table status summaries for partial batches", async () => {
    mockTx.$queryRawUnsafe.mockImplementation(async (sql: string, name?: string) => {
      if (sql.includes("pg_inherits")) {
        return name === "WifiTelemetry_y2025m02" ? [{ parent: "WifiTelemetry" }] : [];
      }
      if (sql.includes("relkind = 'r'")) return [];
      return [{ size: 2048 }];
    });

    const result = await bulkArchiveVenuePartitions(
      ["WifiTelemetry_y2025m02", "Invalid_Name_123"],
      "admin-1",
    );

    expect(result.tableSummaries).toBeDefined();
    expect(result.tableSummaries).toHaveLength(2);
    expect(result.tableSummaries?.[0]).toMatchObject({
      name: "WifiTelemetry_y2025m02",
      parentTable: "WifiTelemetry",
      status: "PROCESSED",
      action: "ARCHIVE",
      freedBytes: 2048,
    });
    expect(result.tableSummaries?.[1]).toMatchObject({
      name: "Invalid_Name_123",
      status: "FAILED",
      action: "ARCHIVE",
    });
  });

  it("rolls back all operations in atomic mode if a detach fails halfway", async () => {
    useCatalog({ attachedParent: "WifiTelemetry", size: 4096 });
    let detachCount = 0;
    mockTx.$executeRawUnsafe.mockImplementation(async (sql: string) => {
      if (String(sql).includes("DETACH PARTITION")) {
        detachCount++;
        if (detachCount === 2) {
          throw new Error("canceling statement due to lock timeout");
        }
      }
      return 0;
    });

    const result = await bulkArchiveVenuePartitions(
      ["WifiTelemetry_y2025m01", "WifiTelemetry_y2025m02"],
      "admin-1",
      { atomic: true },
    );

    expect(result.success).toBe(false);
    expect(result.processed).toEqual([]);
    expect(result.freedBytes).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.tableSummaries?.every((t) => t.status === "FAILED")).toBe(true);
    expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
