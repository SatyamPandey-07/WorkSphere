import {
  createTelemetryCsvStream,
  parseRangeToStartDate,
} from "@/lib/export/domain/systemVitalsExporter";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    telemetryRecord: {
      findMany: jest.fn(),
    },
  },
}));

describe("System Vitals & Telemetry Streaming CSV Export (#5038)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses time range strings to start dates properly", () => {
    const start24h = parseRangeToStartDate("24h");
    expect(start24h.getTime()).toBeLessThan(Date.now());

    const start7d = parseRangeToStartDate("7d");
    expect(start7d.getTime()).toBeLessThan(start24h.getTime());

    const startAll = parseRangeToStartDate("all");
    expect(startAll.getTime()).toBe(0);
  });

  it("streams CSV chunks with Prisma cursor pagination (batch size 1000)", async () => {
    const mockBatch1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `rec-${i + 1}`,
      venueId: `venue-${(i % 5) + 1}`,
      download: 85.5,
      upload: 35.2,
      latency: 18,
      noiseLevel: 45.2,
      occupancy: 12,
      presence: true,
      crowdLevel: "moderate",
      timestamp: new Date(1700000000000 + i * 1000),
    }));

    const mockBatch2 = Array.from({ length: 250 }, (_, i) => ({
      id: `rec-${i + 1001}`,
      venueId: `venue-${(i % 5) + 1}`,
      download: 92.1,
      upload: 40.0,
      latency: 15,
      noiseLevel: 42.0,
      occupancy: 10,
      presence: true,
      crowdLevel: "quiet",
      timestamp: new Date(1700001000000 + i * 1000),
    }));

    const findManyMock = (prisma as any).telemetryRecord.findMany as jest.Mock;
    findManyMock
      .mockResolvedValueOnce(mockBatch1)
      .mockResolvedValueOnce(mockBatch2);

    const stream = createTelemetryCsvStream({ batchSize: 1000, range: "7d" });
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let chunksCount = 0;
    let totalCsv = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunksCount++;
      totalCsv += decoder.decode(value);
    }

    // 1 header chunk + 2 batch chunks = 3 chunks
    expect(chunksCount).toBe(3);
    expect(totalCsv).toContain("id,venueId,download_mbps,upload_mbps,latency_ms");
    expect(totalCsv).toContain("rec-1,venue-1");
    expect(totalCsv).toContain("rec-1001,venue-1");

    // Verify cursor pagination was invoked with batch size 1000
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(findManyMock.mock.calls[0][0].take).toBe(1000);
    expect(findManyMock.mock.calls[1][0].cursor).toEqual({
      id_timestamp: {
        id: "rec-1000",
        timestamp: mockBatch1[999].timestamp,
      },
    });
  });

  it("handles empty database table gracefully without crashing", async () => {
    const findManyMock = (prisma as any).telemetryRecord.findMany as jest.Mock;
    findManyMock.mockResolvedValueOnce([]);

    const stream = createTelemetryCsvStream({ batchSize: 1000 });
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    expect(output).toBe(
      "id,venueId,download_mbps,upload_mbps,latency_ms,noise_level,occupancy,presence,crowd_level,timestamp\r\n",
    );
  });
});
