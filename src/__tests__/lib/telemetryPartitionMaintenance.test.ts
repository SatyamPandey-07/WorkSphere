import { prisma } from "@/lib/prisma";
import {
  archiveExpiredTelemetryPartitions,
  autoCreateUpcomingTelemetryPartitions,
  getTelemetryPartitionRetentionCutoff,
  getTelemetryPartitionName,
  isTelemetryPartitionExpired,
  listTelemetryPartitions,
  parseTelemetryPartitionMonth,
} from "@/lib/partitionMaintenance";

const executeRawUnsafe = jest.fn();
const queryRawUnsafe = jest.fn();
const transactionExecuteRawUnsafe = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    $transaction: jest.fn(
      async (
        callback: (transaction: {
          $executeRawUnsafe: (...args: unknown[]) => Promise<number>;
        }) => Promise<unknown>,
      ) =>
        callback({
          $executeRawUnsafe: (...args: unknown[]) =>
            transactionExecuteRawUnsafe(...args),
        }),
    ),
  },
}));

describe("TelemetryRecord partition naming and retention helpers (#3528)", () => {
  it("formats and parses canonical monthly partition names", () => {
    const date = new Date("2026-10-15T12:00:00.000Z");

    expect(getTelemetryPartitionName(date)).toBe("TelemetryRecord_y2026m10");
    expect(parseTelemetryPartitionMonth("TelemetryRecord_y2026m10")).toEqual(
      new Date("2026-10-01T00:00:00.000Z"),
    );
  });

  it("rejects malformed or unrelated partition names", () => {
    expect(parseTelemetryPartitionMonth("TelemetryRecord_y2026m13")).toBeNull();
    expect(parseTelemetryPartitionMonth("WifiTelemetry_y2026m10")).toBeNull();
    expect(parseTelemetryPartitionMonth("random_table")).toBeNull();
  });

  it("calculates 12-month retention cutoff and flags expired partitions", () => {
    const now = new Date("2026-10-15T00:00:00.000Z");

    // 12 months retention: keeps Oct 2026 back to Nov 2025 (Nov 1 2025)
    const cutoff = getTelemetryPartitionRetentionCutoff(now, 12);
    expect(cutoff).toEqual(new Date("2025-11-01T00:00:00.000Z"));

    // Older than 12 months is expired
    expect(isTelemetryPartitionExpired("TelemetryRecord_y2025m10", now, 12)).toBe(true);
    // 12 months boundary is retained
    expect(isTelemetryPartitionExpired("TelemetryRecord_y2025m11", now, 12)).toBe(false);
    expect(isTelemetryPartitionExpired("TelemetryRecord_y2026m05", now, 12)).toBe(false);
  });
});

describe("listTelemetryPartitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns attached monthly telemetry partitions", async () => {
    queryRawUnsafe.mockResolvedValue([
      { name: "TelemetryRecord_y2026m09" },
      { name: "TelemetryRecord_y2026m10" },
    ]);

    await expect(listTelemetryPartitions()).resolves.toEqual([
      "TelemetryRecord_y2026m09",
      "TelemetryRecord_y2026m10",
    ]);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});

describe("autoCreateUpcomingTelemetryPartitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executeRawUnsafe.mockResolvedValue(0);
  });

  it("creates upcoming partitions for current and next two months", async () => {
    const result = await autoCreateUpcomingTelemetryPartitions(
      new Date("2026-10-01T00:00:00.000Z"),
    );

    expect(result).toEqual([
      "TelemetryRecord_y2026m10",
      "TelemetryRecord_y2026m11",
      "TelemetryRecord_y2026m12",
    ]);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(3);
    expect(executeRawUnsafe.mock.calls[0][0]).toContain('PARTITION OF "TelemetryRecord"');
  });
});

describe("archiveExpiredTelemetryPartitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transactionExecuteRawUnsafe.mockResolvedValue(0);
  });

  it("detaches expired telemetry partitions older than 12 months into telemetry_archive schema", async () => {
    queryRawUnsafe.mockResolvedValue([
      { name: "TelemetryRecord_y2025m08" },
      { name: "TelemetryRecord_y2025m09" },
      { name: "TelemetryRecord_y2026m01" },
      { name: "TelemetryRecord_y2026m10" },
    ]);

    const result = await archiveExpiredTelemetryPartitions({
      now: new Date("2026-10-01T00:00:00.000Z"),
      retentionMonths: 12,
    });

    expect(result.archived).toEqual([
      {
        name: "TelemetryRecord_y2025m08",
        archivedSchema: "telemetry_archive",
      },
      {
        name: "TelemetryRecord_y2025m09",
        archivedSchema: "telemetry_archive",
      },
    ]);
    expect(result.retained).toEqual([
      "TelemetryRecord_y2026m01",
      "TelemetryRecord_y2026m10",
    ]);

    expect(transactionExecuteRawUnsafe).toHaveBeenCalledWith(
      'CREATE SCHEMA IF NOT EXISTS "telemetry_archive"',
    );
    expect(transactionExecuteRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "TelemetryRecord" DETACH PARTITION "TelemetryRecord_y2025m08"',
    );
    expect(transactionExecuteRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "TelemetryRecord_y2025m08" SET SCHEMA "telemetry_archive"',
    );
  });

  it("skips transaction when no partitions are expired", async () => {
    queryRawUnsafe.mockResolvedValue([
      { name: "TelemetryRecord_y2026m05" },
      { name: "TelemetryRecord_y2026m10" },
    ]);

    const result = await archiveExpiredTelemetryPartitions({
      now: new Date("2026-10-01T00:00:00.000Z"),
      retentionMonths: 12,
    });

    expect(result.archived).toHaveLength(0);
    expect(result.retained).toEqual([
      "TelemetryRecord_y2026m05",
      "TelemetryRecord_y2026m10",
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
