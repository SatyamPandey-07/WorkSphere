import { GET } from "../../../../app/api/admin/system/partitions/export/route";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

describe("Partition CSV Export Memory Footprint & Streaming (#5745)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("streams 50,000+ rows in cursor batches keeping memory footprint flat", async () => {
    (getAdminUser as jest.Mock).mockResolvedValue({
      id: "admin-1",
      email: "admin@worksphere.com",
    });

    const TOTAL_ROWS = 55000;
    const BATCH_SIZE = 1000;
    let fetchedRowsCount = 0;

    // Mock prisma.$queryRawUnsafe returning rows in batches of BATCH_SIZE
    (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(
      async (query: string, ...params: unknown[]) => {
        if (fetchedRowsCount >= TOTAL_ROWS) {
          return [];
        }

        const remaining = TOTAL_ROWS - fetchedRowsCount;
        const currentBatchSize = Math.min(BATCH_SIZE, remaining);
        const batch = [];

        for (let i = 0; i < currentBatchSize; i++) {
          const id = `tel-${fetchedRowsCount + i}`;
          batch.push({
            id,
            venueId: "ven-test",
            timestamp: new Date("2026-03-15T12:00:00Z"),
            download: 100.0,
            upload: 25.0,
            latency: 15.0,
            noiseLevel: 42.0,
            occupancy: 10,
            presence: true,
            crowdLevel: "moderate",
          });
        }

        fetchedRowsCount += currentBatchSize;
        return batch;
      },
    );

    const initialHeap = process.memoryUsage().heapUsed;

    const req = new NextRequest(
      "http://localhost:3000/api/admin/system/partitions/export?year=2026&month=2&type=telemetry",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Transfer-Encoding")).toBe("chunked");

    // Read the stream chunk-by-chunk using reader without accumulating everything in a massive buffer
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    let streamBytesRead = 0;
    let chunksCount = 0;
    const decoder = new TextDecoder();
    let sampleContent = "";

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          streamBytesRead += value.byteLength;
          chunksCount++;
          if (chunksCount === 1) {
            sampleContent = decoder.decode(value);
          }
        }
      }
    }

    const finalHeap = process.memoryUsage().heapUsed;
    const heapDiffMb = (finalHeap - initialHeap) / (1024 * 1024);

    // Verify all rows were processed via cursor batches
    expect(fetchedRowsCount).toBe(TOTAL_ROWS);
    expect(chunksCount).toBeGreaterThan(1);
    expect(sampleContent).toContain("id,venueId,timestamp");
    expect(streamBytesRead).toBeGreaterThan(0);

    // Verify memory delta remains constrained (< 50MB) during 55,000 row stream
    expect(heapDiffMb).toBeLessThan(50);
  });
});
