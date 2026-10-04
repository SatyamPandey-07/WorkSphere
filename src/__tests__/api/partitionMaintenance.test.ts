/**
 * Tests for the partition maintenance cron endpoint.
 * Tests authorization, success path, and partial failure path.
 */

import { GET } from "@/app/api/cron/partition-maintenance/route";
import { NextRequest } from "next/server";
import { autoCreateUpcomingPartitions } from "@/lib/partitionMaintenance";

jest.mock("@/lib/db/partitionManager", () => ({
  runTelemetryPartitionMaintenance: jest.fn().mockResolvedValue({
    created: [],
    archived: [],
    vacuumed: [],
  }),
}));

jest.mock("@/lib/db/partitionMaintenance", () => ({
  runPartmanPartitionMaintenance: jest.fn().mockResolvedValue({
    maintained: ["WifiTelemetry"],
    plannedPartitions: [],
    activePartitions: [],
    skippedTables: ["AcousticTelemetry"],
  }),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: "admin-test" }),
    },
    adminAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

// Mock the partition maintenance functions
jest.mock("@/lib/partitionMaintenance", () => ({
  autoCreateUpcomingPartitions: jest
    .fn()
    .mockResolvedValue(["partition_2026_11"]),
  archiveExpiredPushNotificationPartitions: jest
    .fn()
    .mockResolvedValue({ archived: [], retained: [] }),
  archiveExpiredTelemetryPartitions: jest
    .fn()
    .mockResolvedValue({ archived: [], retained: [] }),

  checkPartitionHealth: jest.fn().mockResolvedValue({ status: "OK" }),
}));

jest.mock("@/lib/partitionRetention", () => ({
  runPartitionRetention: jest.fn().mockResolvedValue({
    tables: [
      {
        table: "WifiTelemetry",
        created: [],
        dropped: ["WifiTelemetry_y2026m03"],
        archived: [],
        defaultRowsRehomed: 0,
        defaultRowsExpired: 0,
        vacuumed: [],
        errors: [],
      },
    ],
  }),
}));

function makeRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (secret) {
    headers["authorization"] = `Bearer ${secret}`;
  }
  return new NextRequest("http://localhost/api/cron/partition-maintenance", {
    headers,
  });
}

describe("GET /api/cron/partition-maintenance", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PARTITION_MAINTENANCE_ADMIN_ID = "admin-test";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns 200 and runs all steps when no CRON_SECRET is set", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.partitionsCreated).toHaveLength(1);
  });

  it("returns 401 when CRON_SECRET is set but no auth header provided", async () => {
    process.env.CRON_SECRET = "test-secret";
    const response = await GET(makeRequest()); // no secret in request
    expect(response.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET is set but wrong secret is provided", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await GET(makeRequest("wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("returns 200 when CRON_SECRET matches", async () => {
    process.env.CRON_SECRET = "my-secret";
    const response = await GET(makeRequest("my-secret"));
    expect(response.status).toBe(200);
  });

  it("returns durationMs in response", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(makeRequest());
    const data = await response.json();
    expect(typeof data.durationMs).toBe("number");
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns 207 and errors array when a step fails", async () => {
    delete process.env.CRON_SECRET;
    (
      autoCreateUpcomingPartitions as unknown as jest.Mock
    ).mockRejectedValueOnce(new Error("DB timeout"));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(207);
    expect(data.success).toBe(false);
    expect(data.errors.length).toBeGreaterThan(0);
  });
});

describe("GET /api/cron/partition-maintenance — telemetry retention (#3362)", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CRON_SECRET;
    jest.clearAllMocks();
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it("runs telemetry/audit retention and reports it", async () => {
    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.retention.tables[0].dropped).toEqual([
      "WifiTelemetry_y2026m03",
    ]);
  });

  it("returns 207 with a table-scoped error when retention fails for a table", async () => {
    const { runPartitionRetention } = jest.requireMock(
      "@/lib/partitionRetention",
    );
    runPartitionRetention.mockResolvedValueOnce({
      tables: [
        {
          table: "AdminAuditLog",
          created: [],
          dropped: [],
          archived: [],
          defaultRowsRehomed: 0,
          defaultRowsExpired: 0,
          vacuumed: [],
          errors: ["lock timeout"],
        },
      ],
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(207);
    expect((await res.json()).errors).toContain("AdminAuditLog: lock timeout");
  });
});
