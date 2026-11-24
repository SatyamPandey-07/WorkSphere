import {
  formatAuditTimestamp,
  formatSeatLabel,
  formatCheckInDuration,
  formatAverageDecibels,
  formatAuditCsvRow,
  parseDateRange,
  createVenueAuditCsvStream,
  generateVenueAuditCSV,
  generateVenueAuditPDF,
  fetchVenueAuditRows,
  AUDIT_EXPORT_COLUMNS,
  VenueAuditExportRow,
} from "@/lib/export/auditExporter";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    checkIn: {
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
    noiseTelemetryRelease: {
      findFirst: jest.fn(),
    },
  },
}));

describe("auditExporter Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Column Definitions", () => {
    it("defines the exact required 5 columns", () => {
      expect(AUDIT_EXPORT_COLUMNS).toEqual([
        "Timestamp",
        "User ID",
        "Seat Label",
        "Check-in Duration",
        "Average Decibels",
      ]);
    });
  });

  describe("Field Formatters", () => {
    it("formats timestamps properly", () => {
      const d = new Date("2026-11-24T12:00:00.000Z");
      expect(formatAuditTimestamp(d)).toBe("2026-11-24T12:00:00.000Z");
      expect(formatAuditTimestamp("2026-11-24T12:00:00.000Z")).toBe(
        "2026-11-24T12:00:00.000Z",
      );
      expect(formatAuditTimestamp(null)).toBe("");
      expect(formatAuditTimestamp(undefined)).toBe("");
    });

    it("formats seat labels with hot desk fallback", () => {
      expect(formatSeatLabel("Desk 42")).toBe("Desk 42");
      expect(formatSeatLabel("")).toBe("Hot Desk");
      expect(formatSeatLabel("   ")).toBe("Hot Desk");
      expect(formatSeatLabel(null)).toBe("Hot Desk");
      expect(formatSeatLabel(undefined)).toBe("Hot Desk");
    });

    it("formats check-in duration", () => {
      expect(formatCheckInDuration(120)).toBe("120 mins");
      expect(formatCheckInDuration("90")).toBe("90 mins");
      expect(formatCheckInDuration("2 hours")).toBe("2 hours");
      expect(formatCheckInDuration(-10)).toBe("0 mins");
      expect(formatCheckInDuration(null)).toBe("N/A");
      expect(formatCheckInDuration(undefined)).toBe("N/A");
    });

    it("formats average decibels", () => {
      expect(formatAverageDecibels(45.67)).toBe("45.7");
      expect(formatAverageDecibels("52.3")).toBe("52.3");
      expect(formatAverageDecibels(null)).toBe("N/A");
      expect(formatAverageDecibels(undefined)).toBe("N/A");
      expect(formatAverageDecibels(NaN)).toBe("N/A");
    });
  });

  describe("RFC 4180 Row Formatting", () => {
    it("formats row with commas and quotes correctly according to RFC 4180", () => {
      const row: VenueAuditExportRow = {
        timestamp: "2026-11-24T12:00:00.000Z",
        userId: "user_123",
        seatLabel: 'Zone A, Desk "Corner"',
        checkInDuration: 180,
        averageDecibels: 48.2,
      };

      const line = formatAuditCsvRow(row);
      expect(line.endsWith("\r\n")).toBe(true);
      expect(line).toContain('"Zone A, Desk ""Corner"""');
      expect(line).toContain("user_123");
      expect(line).toContain("180 mins");
      expect(line).toContain("48.2");
    });

    it("neutralizes formula injection characters", () => {
      const row: VenueAuditExportRow = {
        timestamp: "2026-11-24T12:00:00.000Z",
        userId: "=cmd|' /C calc'!A0",
        seatLabel: "+12345",
        checkInDuration: 60,
        averageDecibels: 50.0,
      };

      const line = formatAuditCsvRow(row);
      expect(line).toContain("'=cmd");
      expect(line).toContain("'+12345");
    });
  });

  describe("parseDateRange", () => {
    it("parses monthly date ranges correctly", () => {
      const range = parseDateRange({ month: "2026-11" });
      expect(range.start).toEqual(new Date(Date.UTC(2026, 10, 1)));
      expect(range.end).toEqual(new Date(Date.UTC(2026, 11, 1)));
    });

    it("handles explicit startDate and endDate", () => {
      const start = new Date("2026-11-01T00:00:00Z");
      const end = new Date("2026-11-15T00:00:00Z");
      const range = parseDateRange({ startDate: start, endDate: end });
      expect(range.start).toEqual(start);
      expect(range.end).toEqual(end);
    });

    it("returns empty object when options are omitted", () => {
      expect(parseDateRange()).toEqual({});
    });
  });

  describe("createVenueAuditCsvStream", () => {
    it("streams CSV data with header and data chunks", async () => {
      const rows: VenueAuditExportRow[] = [
        {
          timestamp: "2026-11-24T10:00:00.000Z",
          userId: "user_a",
          seatLabel: "Desk 1",
          checkInDuration: 120,
          averageDecibels: 45.0,
        },
        {
          timestamp: "2026-11-24T11:00:00.000Z",
          userId: "user_b",
          seatLabel: "Desk 2",
          checkInDuration: 60,
          averageDecibels: 50.5,
        },
      ];

      const stream = createVenueAuditCsvStream(rows);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let csvContent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        csvContent += decoder.decode(value);
      }

      const lines = csvContent.split("\r\n").filter(Boolean);
      expect(lines.length).toBe(3); // Header + 2 data rows
      expect(lines[0]).toBe(
        "Timestamp,User ID,Seat Label,Check-in Duration,Average Decibels",
      );
      expect(lines[1]).toContain("user_a");
      expect(lines[2]).toContain("user_b");
    });
  });

  describe("generateVenueAuditCSV", () => {
    it("generates synchronous CSV string", () => {
      const rows: VenueAuditExportRow[] = [
        {
          timestamp: "2026-11-24T10:00:00.000Z",
          userId: "user_1",
          seatLabel: "Hot Desk",
          checkInDuration: 60,
          averageDecibels: 42.0,
        },
      ];

      const csv = generateVenueAuditCSV(rows);
      expect(csv).toContain("Timestamp,User ID,Seat Label");
      expect(csv).toContain("user_1");
      expect(csv).toContain("60 mins");
    });
  });

  describe("generateVenueAuditPDF", () => {
    it("generates valid PDF byte stream with metadata and rows", async () => {
      const rows: VenueAuditExportRow[] = [
        {
          timestamp: "2026-11-24T10:00:00.000Z",
          userId: "user_pdf",
          seatLabel: "Desk A-1",
          checkInDuration: 240,
          averageDecibels: 46.2,
        },
      ];

      const pdfBytes = await generateVenueAuditPDF(rows, {
        venueName: "Green Workspace",
        venueId: "ven_123",
        month: "2026-11",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(500);

      const headerText = Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8");
      expect(headerText).toBe("%PDF-");
    });

    it("generates valid PDF when rows are empty", async () => {
      const pdfBytes = await generateVenueAuditPDF([], {
        venueName: "Empty Venue",
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      const headerText = Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8");
      expect(headerText).toBe("%PDF-");
    });
  });

  describe("fetchVenueAuditRows", () => {
    it("fetches and maps check-ins, bookings, and noise telemetry from prisma", async () => {
      (prisma.checkIn.findMany as jest.Mock).mockResolvedValue([
        {
          id: "ci_1",
          userId: "user_checkin",
          venueId: "venue_1",
          createdAt: new Date("2026-11-24T09:00:00Z"),
          expiresAt: new Date("2026-11-24T13:00:00Z"),
        },
      ]);

      (prisma.booking.findMany as jest.Mock).mockResolvedValue([
        {
          id: "bk_1",
          userId: "user_booking",
          venueId: "venue_1",
          date: "2026-11-24",
          time: "14:00",
          seatNumber: "Seat 10",
          duration: 90,
          createdAt: new Date("2026-11-24T14:00:00Z"),
          seat: { seatNumber: "Seat 10", zoneName: "Quiet" },
        },
      ]);

      (prisma.noiseTelemetryRelease.findFirst as jest.Mock).mockResolvedValue({
        avgDecibels: 44.5,
      });

      const rows = await fetchVenueAuditRows("venue_1", { month: "2026-11" });

      expect(rows.length).toBe(2);
      expect(rows[0].userId).toBe("user_booking");
      expect(rows[0].seatLabel).toBe("Seat 10");
      expect(rows[0].checkInDuration).toBe(90);
      expect(rows[0].averageDecibels).toBe(44.5);

      expect(rows[1].userId).toBe("user_checkin");
      expect(rows[1].seatLabel).toBe("Hot Desk");
      expect(rows[1].checkInDuration).toBe(240); // 4 hours = 240 mins
    });
  });
});
