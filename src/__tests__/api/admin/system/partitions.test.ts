import {
  calculatePartitionDates,
  escapeCsv,
} from "../../../../app/api/admin/system/partitions/dateHelper";
import { GET } from "../../../../app/api/admin/system/partitions/export/route";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

jest.mock("../../../../lib/partitionMaintenance", () => ({
  checkPartitionHealth: jest.fn(),
}));

jest.mock("@/lib/admin", () => ({
  getAdminUser: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    pushNotificationLog: {
      findMany: jest.fn(),
    },
  },
}));

describe("Partition Date Calculations & Export (#3777)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("verifying leap year February partition range formatting (Feb 1 to Mar 1)", () => {
    // 2024 is a leap year, month 1 is February (0-indexed)
    const { start, end } = calculatePartitionDates(2024, 1);

    expect(start.toISOString().substring(0, 10)).toBe("2024-02-01");
    expect(end.toISOString().substring(0, 10)).toBe("2024-03-01");
  });

  describe("escapeCsv helper", () => {
    it("should escape commas, quotes, and newlines properly", () => {
      expect(escapeCsv("hello,world")).toBe('"hello,world"');
      expect(escapeCsv('foo"bar')).toBe('"foo""bar"');
      expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
      expect(escapeCsv("normal")).toBe("normal");
      expect(escapeCsv(123)).toBe("123");
      expect(escapeCsv(null)).toBe("");
    });
  });

  describe("Streaming CSV Partition Export API", () => {
    it("should reject non-admin access with 403", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/export",
      );
      const res = await GET(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Admin access required");
    });

    it("should stream telemetry partition logs with chunked transfer-encoding", async () => {
      (getAdminUser as jest.Mock).mockResolvedValue({
        id: "admin-1",
        email: "admin@worksphere.com",
      });
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: "tel-1",
            venueId: "ven-1",
            timestamp: new Date("2026-03-15T10:00:00Z"),
            download: 150.5,
            upload: 50.2,
            latency: 12.0,
            noiseLevel: 45.0,
            occupancy: 20,
            presence: true,
            crowdLevel: "moderate",
          },
        ])
        .mockResolvedValueOnce([]); // second batch empty

      const req = new NextRequest(
        "http://localhost:3000/api/admin/system/partitions/export?year=2026&month=2&type=telemetry",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("Transfer-Encoding")).toBe("chunked");
      expect(res.headers.get("Content-Disposition")).toContain(
        "telemetry-records-2026-03.csv",
      );

      // Read stream
      const text = await res.text();
      expect(text).toContain(
        "id,venueId,timestamp,download,upload,latency,noiseLevel,occupancy,presence,crowdLevel",
      );
      expect(text).toContain(
        "tel-1,ven-1,2026-03-15T10:00:00.000Z,150.5,50.2,12,45,20,true,moderate",
      );
    });
  });
});
