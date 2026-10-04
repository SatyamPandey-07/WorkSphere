import {
  escapeCSV,
  formatCSVDate,
  formatCSVUser,
  generateRatingsCSV,
  downloadRatingsCSV,
  VenueRatingRecord,
} from "@/lib/venueRatingsCsvExport";

describe("venueRatingsCsvExport", () => {
  describe("escapeCSV", () => {
    it("returns empty string for null or undefined", () => {
      expect(escapeCSV(null)).toBe("");
      expect(escapeCSV(undefined)).toBe("");
    });

    it("returns simple strings unchanged", () => {
      expect(escapeCSV("Downtown Cafe")).toBe("Downtown Cafe");
      expect(escapeCSV(42)).toBe("42");
      expect(escapeCSV(true)).toBe("true");
    });

    it("wraps string in quotes when it contains a comma", () => {
      expect(escapeCSV("Seattle, WA")).toBe('"Seattle, WA"');
    });

    it("escapes quotes by doubling them and wrapping in quotes", () => {
      expect(escapeCSV('Joe\'s "Special" Blend')).toBe(
        '"Joe\'s ""Special"" Blend"',
      );
    });

    it("wraps strings containing newlines in quotes", () => {
      expect(escapeCSV("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCSV("Line 1\r\nLine 2")).toBe('"Line 1\r\nLine 2"');
    });
  });

  describe("formatCSVDate", () => {
    it("formats Date object as YYYY-MM-DD", () => {
      const d = new Date("2026-10-02T12:00:00Z");
      expect(formatCSVDate(d)).toBe("2026-10-02");
    });

    it("formats ISO string as YYYY-MM-DD", () => {
      expect(formatCSVDate("2026-05-15T08:30:00Z")).toBe("2026-05-15");
    });

    it("returns N/A when null or undefined", () => {
      expect(formatCSVDate(null)).toBe("N/A");
      expect(formatCSVDate(undefined)).toBe("N/A");
    });
  });

  describe("formatCSVUser", () => {
    it("combines firstName and lastName", () => {
      expect(
        formatCSVUser({ firstName: "Alice", lastName: "Smith" }),
      ).toBe("Alice Smith");
    });

    it("falls back to email if name is empty", () => {
      expect(formatCSVUser({ email: "alice@example.com" })).toBe(
        "alice@example.com",
      );
    });

    it("handles string user format", () => {
      expect(formatCSVUser("Bob Builder")).toBe("Bob Builder");
    });

    it("returns Anonymous for null or missing user", () => {
      expect(formatCSVUser(null)).toBe("Anonymous");
      expect(formatCSVUser(undefined)).toBe("Anonymous");
    });
  });

  describe("generateRatingsCSV", () => {
    const mockRecords: VenueRatingRecord[] = [
      {
        createdAt: "2026-10-01T10:00:00Z",
        venueName: "Artisan Roasters",
        user: { firstName: "Sarah", lastName: "Connor" },
        wifiQuality: 5,
        noiseLevel: "quiet",
        hasOutlets: true,
        comment: "Fast gigabit fiber, delicious latte!",
      },
      {
        createdAt: "2026-10-02T14:30:00Z",
        venueName: "Tech Hub, Downtown",
        user: "John Doe",
        wifiQuality: 3,
        noiseLevel: "moderate",
        hasOutlets: false,
        comment: 'Great tables, but "busy" during peak hours, loud callers.',
      },
    ];

    it("generates correct header row matching specification", () => {
      const csv = generateRatingsCSV([]);
      expect(csv).toBe(
        "Date,Venue Name,User,WiFi Quality,Noise Level,Outlets,Review Text",
      );
    });

    it("formats records into properly escaped CSV rows", () => {
      const csv = generateRatingsCSV(mockRecords);
      const lines = csv.split("\r\n");

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe(
        "Date,Venue Name,User,WiFi Quality,Noise Level,Outlets,Review Text",
      );

      // Row 1
      expect(lines[1]).toBe(
        '2026-10-01,Artisan Roasters,Sarah Connor,5,quiet,Yes,"Fast gigabit fiber, delicious latte!"',
      );

      // Row 2: contains comma in venue name and quotes in comment
      expect(lines[2]).toBe(
        '2026-10-02,"Tech Hub, Downtown",John Doe,3,moderate,No,"Great tables, but ""busy"" during peak hours, loud callers."',
      );
    });

    it("uses default venue name when record omits it", () => {
      const records: VenueRatingRecord[] = [
        {
          createdAt: "2026-09-20T12:00:00Z",
          wifiQuality: 4,
          noiseLevel: "quiet",
          hasOutlets: true,
          comment: "Cozy spot",
        },
      ];
      const csv = generateRatingsCSV(records, "Fallback Cafe");
      expect(csv).toContain("Fallback Cafe");
    });
  });

  describe("downloadRatingsCSV", () => {
    beforeAll(() => {
      global.URL.createObjectURL = jest
        .fn()
        .mockReturnValue("blob:http://localhost/mock-blob");
      global.URL.revokeObjectURL = jest.fn();
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("creates a CSV blob with correct MIME type", () => {
      const records: VenueRatingRecord[] = [
        {
          createdAt: "2026-10-01",
          venueName: "Cafe Central",
          wifiQuality: 4,
          noiseLevel: "quiet",
          hasOutlets: true,
        },
      ];

      const blob = downloadRatingsCSV(records, { venueName: "Cafe Central" });
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("text/csv;charset=utf-8;");
    });

    it("triggers DOM anchor click and cleans up URL", () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const appendSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(document.body, "removeChild");

      downloadRatingsCSV(
        [
          {
            createdAt: "2026-10-01",
            venueName: "Workspace 1",
            wifiQuality: 5,
            noiseLevel: "quiet",
            hasOutlets: true,
          },
        ],
        { venueName: "Workspace 1" },
      );

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(appendSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:http://localhost/mock-blob",
      );

      clickSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});
