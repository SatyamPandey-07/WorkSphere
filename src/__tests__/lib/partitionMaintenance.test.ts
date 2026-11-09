import { prisma } from "@/lib/prisma";
import {
  buildPartmanRetentionConfigSql,
  getTelemetryPartitionName,
  getTelemetryPartitionRange,
  getUpcomingTelemetryPartitionNames,
} from "@/lib/db/partitionMaintenance";
import {
  archiveExpiredPushNotificationPartitions,
  autoCreateUpcomingPartitions,
  checkPartitionHealth,
  formatPartitionBytes,
  getPartitionRetentionCutoff,
  getPushNotificationPartitionName,
  isPartitionExpired,
  listPushNotificationPartitions,
  parsePushNotificationPartitionMonth,
  COLD_STORAGE_THRESHOLD_BYTES,
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

describe("partition naming and retention helpers", () => {
  it("formats and parses canonical monthly partition names", () => {
    const date = new Date("2026-07-15T10:00:00.000Z");

    expect(getPushNotificationPartitionName(date)).toBe(
      "PushNotificationLog_y2026m07",
    );
    expect(
      parsePushNotificationPartitionMonth("PushNotificationLog_y2026m07"),
    ).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });

  it("rejects malformed or unrelated partition names", () => {
    expect(
      parsePushNotificationPartitionMonth("PushNotificationLog_y2026m13"),
    ).toBeNull();
    expect(parsePushNotificationPartitionMonth("User_y2026m07")).toBeNull();
  });

  it("keeps the current month and previous five months for six-month retention", () => {
    const now = new Date("2026-07-25T00:00:00.000Z");

    expect(getPartitionRetentionCutoff(now, 6)).toEqual(
      new Date("2026-02-01T00:00:00.000Z"),
    );
    expect(isPartitionExpired("PushNotificationLog_y2026m01", now, 6)).toBe(
      true,
    );
    expect(isPartitionExpired("PushNotificationLog_y2026m02", now, 6)).toBe(
      false,
    );
  });

  it("validates the configured retention period", () => {
    expect(() =>
      getPartitionRetentionCutoff(new Date("2026-07-25T00:00:00.000Z"), 0),
    ).toThrow("retentionMonths must be a positive integer");
  });
});

describe("pg_partman telemetry partition helpers", () => {
  it("generates monthly partition names across year boundaries", () => {
    expect(
      getTelemetryPartitionName(
        "WifiTelemetry",
        new Date("2026-12-15T12:00:00.000Z"),
      ),
    ).toBe("WifiTelemetry_y2026m12");
    expect(
      getTelemetryPartitionName(
        "AcousticTelemetry",
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe("AcousticTelemetry_y2027m01");
  });

  it("calculates UTC half-open monthly ranges at leap-year boundaries", () => {
    expect(getTelemetryPartitionRange(new Date("2028-02-29T23:59:00.000Z"))).toEqual({
      start: "2028-02-01",
      end: "2028-03-01",
    });
  });

  it("plans the next two months for both telemetry parents", () => {
    expect(getUpcomingTelemetryPartitionNames(new Date("2026-12-31T23:59:00Z"))).toEqual([
      "WifiTelemetry_y2027m01",
      "WifiTelemetry_y2027m02",
      "AcousticTelemetry_y2027m01",
      "AcousticTelemetry_y2027m02",
    ]);
  });

  it("configures pg_partman to retain detached partitions in the archive schema", () => {
    const sql = buildPartmanRetentionConfigSql();

    expect(sql).toContain("retention = '90 days'");
    expect(sql).toContain("retention_keep_table = true");
    expect(sql).toContain("retention_schema = 'telemetry_archive'");
  });
});

describe("listPushNotificationPartitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns attached monthly child partitions", async () => {
    queryRawUnsafe.mockResolvedValue([
      { name: "PushNotificationLog_y2026m01" },
      { name: "PushNotificationLog_y2026m02" },
    ]);

    await expect(listPushNotificationPartitions()).resolves.toEqual([
      "PushNotificationLog_y2026m01",
      "PushNotificationLog_y2026m02",
    ]);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});

describe("archiveExpiredPushNotificationPartitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transactionExecuteRawUnsafe.mockResolvedValue(0);
  });

  it("detaches expired partitions and moves them to the archive schema", async () => {
    queryRawUnsafe.mockResolvedValue([
      { name: "PushNotificationLog_y2025m12" },
      { name: "PushNotificationLog_y2026m01" },
      { name: "PushNotificationLog_y2026m02" },
      { name: "PushNotificationLog_y2026m07" },
    ]);

    const result = await archiveExpiredPushNotificationPartitions({
      now: new Date("2026-07-25T00:00:00.000Z"),
      retentionMonths: 6,
    });

    expect(result.archived).toEqual([
      {
        name: "PushNotificationLog_y2025m12",
        archivedSchema: "push_notification_archive",
      },
      {
        name: "PushNotificationLog_y2026m01",
        archivedSchema: "push_notification_archive",
      },
    ]);
    expect(result.retained).toEqual([
      "PushNotificationLog_y2026m02",
      "PushNotificationLog_y2026m07",
    ]);

    expect(transactionExecuteRawUnsafe).toHaveBeenCalledWith(
      'CREATE SCHEMA IF NOT EXISTS "push_notification_archive"',
    );
    expect(transactionExecuteRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "PushNotificationLog" DETACH PARTITION "PushNotificationLog_y2026m01"',
    );
    expect(transactionExecuteRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "PushNotificationLog_y2026m01" SET SCHEMA "push_notification_archive"',
    );
  });

  it("does not open a transaction when no partition has expired", async () => {
    queryRawUnsafe.mockResolvedValue([
      { name: "PushNotificationLog_y2026m02" },
      { name: "PushNotificationLog_y2026m07" },
    ]);

    await expect(
      archiveExpiredPushNotificationPartitions({
        now: new Date("2026-07-25T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      archived: [],
      retained: [
        "PushNotificationLog_y2026m02",
        "PushNotificationLog_y2026m07",
      ],
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("autoCreateUpcomingPartitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executeRawUnsafe.mockResolvedValue(0);
  });

  it("creates current and next two monthly partitions", async () => {
    const result = await autoCreateUpcomingPartitions(
      new Date("2026-12-15T00:00:00.000Z"),
    );

    expect(result).toEqual([
      "PushNotificationLog_y2026m12",
      "PushNotificationLog_y2027m01",
      "PushNotificationLog_y2027m02",
    ]);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(3);
    expect(executeRawUnsafe.mock.calls[1][0]).toContain(
      'PARTITION OF "PushNotificationLog"',
    );
    expect(executeRawUnsafe.mock.calls[1][0]).toContain(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("partition disk storage gauge & size parsing (#3778)", () => {
  it("formats byte values into human-readable strings (formatPartitionBytes)", () => {
    expect(formatPartitionBytes(0)).toBe("0 B");
    expect(formatPartitionBytes(1024)).toBe("1 KB");
    expect(formatPartitionBytes(48 * 1024 * 1024)).toBe("48 MB");
    expect(formatPartitionBytes(100 * 1024 * 1024)).toBe("100 MB");
    expect(formatPartitionBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("verifies cold storage threshold is 100MB", () => {
    expect(COLD_STORAGE_THRESHOLD_BYTES).toBe(100 * 1024 * 1024);
  });

  it("parses pg_total_relation_size in checkPartitionHealth and flags partitions nearing 100MB", async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([
        {
          relname: "PushNotificationLog_y2026m07",
          n_live_tup: 5000,
          total_bytes: 50331648, // 48 MB
        },
      ])
      .mockResolvedValueOnce([
        {
          relname: "PushNotificationLog_y2026m08",
          n_live_tup: 12000,
          total_bytes: 125829120, // 120 MB (exceeds 100MB threshold)
        },
      ]);

    const report = await checkPartitionHealth();

    expect(report.partitions).toHaveLength(2);

    // First partition: 48 MB
    expect(report.partitions[0].name).toBeDefined();
    expect(report.partitions[0].exists).toBe(true);
    expect(report.partitions[0].tableSizeBytes).toBe(50331648);
    expect(report.partitions[0].tableSizePretty).toBe("48 MB");
    expect(report.partitions[0].isNearColdStorage).toBe(false);

    // Second partition: 120 MB (> 100 MB cold storage threshold)
    expect(report.partitions[1].exists).toBe(true);
    expect(report.partitions[1].tableSizeBytes).toBe(125829120);
    expect(report.partitions[1].tableSizePretty).toBe("120 MB");
    expect(report.partitions[1].isNearColdStorage).toBe(true);
  });
});
