import {
  formatAuditTimestamp,
  formatSeatLabel,
  formatCheckInDuration,
  formatAverageDecibels,
  formatAuditCsvRow,
  escapeAuditCsvField,
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

  describe("RFC 4180 Escaping Requirements (#10120)", () => {
    // Standard RFC 4180 CSV parser helper for test validation
    function parseRFC4180CSV(csv: string): string[][] {
      const records: string[][] = [];
      let currentRow: string[] = [];
      let currentField = "";
      let inQuotes = false;
      let i = 0;

      while (i < csv.length) {
        const char = csv[i];
        if (inQuotes) {
          if (char === '"') {
            if (i + 1 < csv.length && csv[i + 1] === '"') {
              currentField += '"';
              i += 2;
              continue;
            } else {
              inQuotes = false;
              i++;
              continue;
            }
          } else {
            currentField += char;
            i++;
            continue;
          }
        } else {
          if (char === '"') {
            inQuotes = true;
            i++;
            continue;
          } else if (char === ",") {
            currentRow.push(currentField);
            currentField = "";
            i++;
            continue;
          } else if (char === "\r") {
            if (i + 1 < csv.length && csv[i + 1] === "\n") {
              i++;
            }
            currentRow.push(currentField);
            records.push(currentRow);
            currentRow = [];
            currentField = "";
            i++;
            continue;
          } else if (char === "\n") {
            currentRow.push(currentField);
            records.push(currentRow);
            currentRow = [];
            currentField = "";
            i++;
            continue;
          } else {
            currentField += char;
            i++;
            continue;
          }
        }
      }

      if (currentRow.length > 0 || currentField.length > 0) {
        currentRow.push(currentField);
        records.push(currentRow);
      }

      return records;
    }

    it("1. leaves normal fields without special characters unchanged", () => {
      expect(escapeAuditCsvField("desk-101")).toBe("desk-101");
      expect(escapeAuditCsvField("user_abcdef")).toBe("user_abcdef");
    });

    it("2. quotes fields containing commas", () => {
      expect(escapeAuditCsvField("Chrome, Windows")).toBe('"Chrome, Windows"');
    });

    it("3. doubles double quotes and quotes the field", () => {
      expect(escapeAuditCsvField('Mozilla "Test" Agent')).toBe(
        '"Mozilla ""Test"" Agent"',
      );
    });

    it("4. encloses fields containing LF (\\n) in quotes preserving the newline", () => {
      const input = "Mozilla/5.0\nChrome/120";
      const escaped = escapeAuditCsvField(input);
      expect(escaped).toBe('"Mozilla/5.0\nChrome/120"');
    });

    it("5. encloses fields containing CR (\\r) in quotes preserving carriage return", () => {
      const input = "Mozilla/5.0\rSafari/605";
      const escaped = escapeAuditCsvField(input);
      expect(escaped).toBe('"Mozilla/5.0\rSafari/605"');
    });

    it("6. encloses fields containing CRLF (\\r\\n) in quotes preserving the line break", () => {
      const input = "Mozilla/5.0\r\nChrome/120";
      const escaped = escapeAuditCsvField(input);
      expect(escaped).toBe('"Mozilla/5.0\r\nChrome/120"');
    });

    it("7. correctly escapes multiline fields containing both quotes and commas", () => {
      const input = 'Error: Failed to connect,\r\ndetail: "timeout after 30s"';
      const escaped = escapeAuditCsvField(input);
      expect(escaped).toBe(
        '"Error: Failed to connect,\r\ndetail: ""timeout after 30s"""',
      );
    });

    it("8. handles multiple special characters without shifting subsequent columns", () => {
      const row: VenueAuditExportRow = {
        timestamp: "2026-11-24T12:00:00.000Z",
        userId: 'admin,"super"\r\nlevel-2',
        seatLabel: 'Zone "A", Floor\n2',
        checkInDuration: 120,
        averageDecibels: 55.4,
      };

      const line = formatAuditCsvRow(row);
      const parsed = parseRFC4180CSV(line);

      expect(parsed.length).toBe(1);
      expect(parsed[0].length).toBe(5);
      expect(parsed[0][0]).toBe("2026-11-24T12:00:00.000Z");
      expect(parsed[0][1]).toBe('admin,"super"\r\nlevel-2');
      expect(parsed[0][2]).toBe('Zone "A", Floor\n2');
      expect(parsed[0][3]).toBe("120 mins");
      expect(parsed[0][4]).toBe("55.4");
    });

    it("9. preserves expected behavior for empty, null, and undefined values", () => {
      expect(escapeAuditCsvField(null)).toBe("");
      expect(escapeAuditCsvField(undefined)).toBe("");
      expect(escapeAuditCsvField("")).toBe("");

      const row: VenueAuditExportRow = {
        timestamp: "",
        userId: "",
        seatLabel: null,
        checkInDuration: null,
        averageDecibels: undefined,
      };

      const line = formatAuditCsvRow(row);
      expect(line).toBe(',,Hot Desk,N/A,N/A\r\n');
    });

    it("10. ensures formula-injection protection composes correctly with quoting", () => {
      const formulaWithComma = "=HYPERLINK(\"http://evil.com\", \"Click\")";
      const escaped = escapeAuditCsvField(formulaWithComma);
      // Leading '=' triggers formula sanitization prepending "'", and the comma and quotes trigger RFC 4180 wrapping
      expect(escaped).toBe('"\'=HYPERLINK(""http://evil.com"", ""Click"")"');

      const parsed = parseRFC4180CSV(escaped);
      expect(parsed[0][0]).toBe('\'=HYPERLINK("http://evil.com", "Click")');
    });

    it("parses full CSV output with multiline user agents and notes using RFC 4180 parser", () => {
      const rows: VenueAuditExportRow[] = [
        {
          timestamp: "2026-11-24T10:00:00.000Z",
          userId: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nAppleWebKit/537.36 (KHTML, like Gecko)\r\nChrome/120.0.0.0",
          seatLabel: 'Desk #12, "Executive Suite"',
          checkInDuration: 90,
          averageDecibels: 42.5,
        },
        {
          timestamp: "2026-11-24T11:00:00.000Z",
          userId: "user_normal",
          seatLabel: "Desk 3",
          checkInDuration: 60,
          averageDecibels: 50.0,
        },
      ];

      const csv = generateVenueAuditCSV(rows);
      const parsed = parseRFC4180CSV(csv);

      // Header row + 2 data rows = 3 records
      expect(parsed.length).toBe(3);
      expect(parsed[0]).toEqual([
        "Timestamp",
        "User ID",
        "Seat Label",
        "Check-in Duration",
        "Average Decibels",
      ]);

      expect(parsed[1][0]).toBe("2026-11-24T10:00:00.000Z");
      expect(parsed[1][1]).toBe(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nAppleWebKit/537.36 (KHTML, like Gecko)\r\nChrome/120.0.0.0",
      );
      expect(parsed[1][2]).toBe('Desk #12, "Executive Suite"');
      expect(parsed[1][3]).toBe("90 mins");
      expect(parsed[1][4]).toBe("42.5");

      expect(parsed[2]).toEqual([
        "2026-11-24T11:00:00.000Z",
        "user_normal",
        "Desk 3",
        "60 mins",
        "50.0",
      ]);
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
