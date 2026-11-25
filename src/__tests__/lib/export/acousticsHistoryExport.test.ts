import {
  ACOUSTICS_HISTORY_CSV_HEADERS,
  calculateQuietScore,
  exportAcousticsHistoryToCSV,
  formatAcousticsHistoryFilename,
  downloadAcousticsHistoryCSV,
} from "@/lib/export/acousticsHistoryExport";

describe("acousticsHistoryExport (#10005)", () => {
  describe("ACOUSTICS_HISTORY_CSV_HEADERS", () => {
    it("matches required CSV column header specification", () => {
      expect([...ACOUSTICS_HISTORY_CSV_HEADERS]).toEqual([
        "timestamp",
        "average_db",
        "peak_db",
        "dominant_frequency_hz",
        "quiet_score",
      ]);
    });
  });

  describe("calculateQuietScore", () => {
    it("computes 100 for <= 30 dB", () => {
      expect(calculateQuietScore(25)).toBe(100);
      expect(calculateQuietScore(30)).toBe(100);
    });

    it("computes 0 for >= 90 dB", () => {
      expect(calculateQuietScore(90)).toBe(0);
      expect(calculateQuietScore(95)).toBe(0);
    });

    it("computes intermediate scores correctly", () => {
      // 60 dB is halfway between 30 and 90 -> 50
      expect(calculateQuietScore(60)).toBe(50);
    });

    it("returns null for non-finite or nullish values", () => {
      expect(calculateQuietScore(null)).toBeNull();
      expect(calculateQuietScore(undefined)).toBeNull();
      expect(calculateQuietScore(NaN)).toBeNull();
    });
  });

  describe("formatAcousticsHistoryFilename", () => {
    it("generates venue-<id>-noise-history-<date>.csv", () => {
      const filename = formatAcousticsHistoryFilename(
        "venue-abc-123",
        "2026-11-24"
      );
      expect(filename).toBe("venue-venue-abc-123-noise-history-2026-11-24.csv");
    });

    it("handles Date instances and sanitizes venue ID", () => {
      const date = new Date("2026-11-24T12:00:00Z");
      const filename = formatAcousticsHistoryFilename("Venue #42!", date);
      expect(filename).toBe("venue-venue__42_-noise-history-2026-11-24.csv");
    });
  });

  describe("exportAcousticsHistoryToCSV", () => {
    it("exports empty rows with header only", () => {
      const csv = exportAcousticsHistoryToCSV([]);
      expect(csv).toBe(
        "timestamp,average_db,peak_db,dominant_frequency_hz,quiet_score\r\n"
      );
    });

    it("exports rows with proper formatting and line endings", () => {
      const rows = [
        {
          timestamp: "2026-11-24T10:00:00.000Z",
          average_db: 45.5,
          peak_db: 62.1,
          dominant_frequency_hz: 500,
          quiet_score: 74,
        },
        {
          timestamp: new Date("2026-11-24T11:00:00.000Z"),
          average_db: 70,
          peak_db: 85,
          dominant_frequency_hz: 1000,
          quiet_score: null, // should calculate auto quiet score
        },
      ];

      const csv = exportAcousticsHistoryToCSV(rows);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe(
        "timestamp,average_db,peak_db,dominant_frequency_hz,quiet_score"
      );
      expect(lines[1]).toBe("2026-11-24T10:00:00.000Z,45.5,62.1,500,74");
      // 70 dB -> 100 - (40/60)*100 = 33
      expect(lines[2]).toBe("2026-11-24T11:00:00.000Z,70,85,1000,33");
    });

    it("escapes fields per RFC 4180 rules", () => {
      const rows = [
        {
          timestamp: '2026-11-24, "Special" Time',
          average_db: 50,
          peak_db: 60,
          dominant_frequency_hz: 440,
          quiet_score: 67,
        },
      ];

      const csv = exportAcousticsHistoryToCSV(rows);
      expect(csv).toContain('"2026-11-24, ""Special"" Time",50,60,440,67');
    });

    it("sanitizes formula triggers in text fields", () => {
      const rows = [
        {
          timestamp: "=HYPERLINK('http://malicious.com')",
          average_db: 40,
          peak_db: 50,
          dominant_frequency_hz: 200,
          quiet_score: 83,
        },
      ];

      const csv = exportAcousticsHistoryToCSV(rows);
      expect(csv).toContain("timestamp,average_db,peak_db,dominant_frequency_hz,quiet_score");
      expect(csv).toContain("'=HYPERLINK('http://malicious.com'),40,50,200,83");
    });
  });

  describe("downloadAcousticsHistoryCSV", () => {
    it("creates an anchor and triggers click in DOM environment", () => {
      const createObjectURLMock = jest.fn(() => "blob:mock-url");
      const revokeObjectURLMock = jest.fn();
      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      const clickMock = jest.fn();
      const appendChildSpy = jest.spyOn(document.body, "appendChild");
      const removeChildSpy = jest.spyOn(document.body, "removeChild");

      jest.spyOn(document, "createElement").mockImplementationOnce(((tag: string) => {
        const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
        el.click = clickMock;
        return el;
      }) as any);

      const result = downloadAcousticsHistoryCSV(
        "test-venue",
        [
          {
            timestamp: "2026-11-24T12:00:00.000Z",
            average_db: 40,
            peak_db: 50,
            dominant_frequency_hz: 500,
            quiet_score: 83,
          },
        ],
        "2026-11-24"
      );

      expect(result).toBe(true);
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });
  });
});
