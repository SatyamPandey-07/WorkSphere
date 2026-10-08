import {
  calculatePartitionDates,
  escapeCsv,
  validatePartitionDate,
  parsePartitionDate,
  isValidDateString,
  DATE_STRING_REGEX,
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

describe("Partition Date Calculations & Export (#3777, #4914)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("dateHelper validation (#4914)", () => {
    it("validates regex pattern ^\\d{4}-\\d{2}-\\d{2}$", () => {
      expect(DATE_STRING_REGEX.test("2026-03-15")).toBe(true);
      expect(DATE_STRING_REGEX.test("2026/03/15")).toBe(false);
      expect(DATE_STRING_REGEX.test("2026-3-15")).toBe(false);
      expect(DATE_STRING_REGEX.test("invalid")).toBe(false);
      expect(DATE_STRING_REGEX.test("")).toBe(false);
    });

    it("returns valid Date object for valid YYYY-MM-DD date strings", () => {
      const parsed = validatePartitionDate("2026-03-15");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.getUTCFullYear()).toBe(2026);
      expect(parsed?.getUTCMonth()).toBe(2);
      expect(parsed?.getUTCDate()).toBe(15);
      expect(isValidDateString("2026-03-15")).toBe(true);
    });

    it("returns null on invalid calendar date strings by default", () => {
      expect(validatePartitionDate("2026-13-45")).toBeNull();
      expect(validatePartitionDate("2026-02-30")).toBeNull();
      expect(validatePartitionDate("2025-02-29")).toBeNull(); // 2025 is not a leap year
      expect(validatePartitionDate("2026-00-10")).toBeNull();
      expect(validatePartitionDate("not-a-date")).toBeNull();
      expect(isValidDateString("2026-13-45")).toBe(false);
      expect(isValidDateString("2026-02-30")).toBe(false);
    });

    it("throws descriptive error when throwOnError is true or parsePartitionDate is called", () => {
      expect(() => validatePartitionDate("2026-13-45", true)).toThrow(
        /Invalid calendar date: "2026-13-45"/,
      );
      expect(() => parsePartitionDate("2026-13-45")).toThrow(
        /Invalid calendar date: "2026-13-45"/,
      );
      expect(() => parsePartitionDate("2026-02-30")).toThrow(
        /Invalid calendar date: "2026-02-30". Date does not exist on calendar/,
      );
      expect(() => parsePartitionDate("2026/03/15")).toThrow(
        /Invalid date format: "2026\/03\/15". Expected YYYY-MM-DD format/,
      );
    });

    it("computes partition dates from valid date strings", () => {
      const { start, end } = calculatePartitionDates("2026-03-15");
      expect(start.toISOString().substring(0, 10)).toBe("2026-03-01");
      expect(end.toISOString().substring(0, 10)).toBe("2026-04-01");
    });

    it("throws when calculating partition dates from invalid date strings", () => {
      expect(() => calculatePartitionDates("2026-13-45")).toThrow(
        /Invalid calendar date/,
      );
    });
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
      expect(escapeCsv('hello,"world"')).toBe('"hello,""world"""');
      expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
      expect(escapeCsv("normal")).toBe("normal");
      expect(escapeCsv(123)).toBe("123");
      expect(escapeCsv(null)).toBe("");
      expect(escapeCsv(new Date("2026-03-15T10:00:00.000Z"))).toBe(
        "2026-03-15T10:00:00.000Z",
      );
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
