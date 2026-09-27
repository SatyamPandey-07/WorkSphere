/**
 * Tests for the partition maintenance cron endpoint.
 * Tests authorization, success path, and partial failure path.
 */

import { GET } from "@/app/api/cron/partition-maintenance/route";
import { NextRequest } from "next/server";

// Mock the partition maintenance functions
jest.mock("@/lib/partitionMaintenance", () => ({
  autoCreateUpcomingPartitions: jest.fn().mockResolvedValue(["partition_2026_11"]),
  archiveExpiredPushNotificationPartitions: jest.fn().mockResolvedValue([]),
  checkPartitionHealth: jest.fn().mockResolvedValue({ status: "OK" }),
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
    const { autoCreateUpcomingPartitions } = require("@/lib/partitionMaintenance");
    autoCreateUpcomingPartitions.mockRejectedValueOnce(new Error("DB timeout"));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(207);
    expect(data.success).toBe(false);
    expect(data.errors.length).toBeGreaterThan(0);
  });
});
