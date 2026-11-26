import { GET } from "@/app/api/cron/archive-telemetry/route";
import { archiveExpiredTelemetryPartitions } from "@/lib/partitionMaintenance";
import { NextRequest } from "next/server";

jest.mock("@/lib/partitionMaintenance", () => ({
  archiveExpiredTelemetryPartitions: jest.fn(),
}));

function makeRequest(secret?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/archive-telemetry", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("GET /api/cron/archive-telemetry", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it("rejects requests without the configured CRON_SECRET", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(archiveExpiredTelemetryPartitions).not.toHaveBeenCalled();
  });

  it("runs the 90-day archive and returns archived and retained partitions", async () => {
    (archiveExpiredTelemetryPartitions as jest.Mock).mockResolvedValueOnce({
      archived: [
        {
          name: "TelemetryRecord_y2026m06",
          archivedSchema: "telemetry_archive",
        },
      ],
      retained: ["TelemetryRecord_y2026m08"],
    });

    const response = await GET(makeRequest("test-cron-secret"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.retentionDays).toBe(90);
    expect(data.archivedPartitions).toHaveLength(1);
    expect(data.retainedPartitions).toEqual(["TelemetryRecord_y2026m08"]);
    expect(data.noiseSummaryTable).toBe(
      "telemetry_archive.noise_monthly_summary",
    );
    expect(archiveExpiredTelemetryPartitions).toHaveBeenCalledWith(
      expect.objectContaining({
        retentionDays: 90,
        now: expect.any(Date),
      }),
    );
  });

  it("returns a generic server error when archival fails", async () => {
    (archiveExpiredTelemetryPartitions as jest.Mock).mockRejectedValueOnce(
      new Error("database connection detail"),
    );

    const response = await GET(makeRequest("test-cron-secret"));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).not.toContain("database connection detail");
  });
});
