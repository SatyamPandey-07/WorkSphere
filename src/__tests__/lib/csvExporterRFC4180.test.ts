import {
  escapeRFC4180Cell,
  sanitizeCsvCell,
  buildRFC4180CSV,
  exportVenueDataToCSV,
  VenueExportRow,
} from "../../lib/export/csvExporter";

describe("RFC 4180 CSV Cell Escaping & Exporter Engine (#4377)", () => {
  describe("escapeRFC4180Cell", () => {
    it("returns empty string for null or undefined values", () => {
      expect(escapeRFC4180Cell(null)).toBe("");
      expect(escapeRFC4180Cell(undefined)).toBe("");
    });

    it("returns unquoted numbers and booleans", () => {
      expect(escapeRFC4180Cell(123)).toBe("123");
      expect(escapeRFC4180Cell(45.67)).toBe("45.67");
      expect(escapeRFC4180Cell(true)).toBe("true");
      expect(escapeRFC4180Cell(false)).toBe("false");
    });

    it("formats Date objects into ISO 8601 strings", () => {
      const date = new Date("2026-10-10T12:00:00.000Z");
      expect(escapeRFC4180Cell(date)).toBe("2026-10-10T12:00:00.000Z");
    });

    it("formats arrays as semicolon-separated strings", () => {
      expect(escapeRFC4180Cell(["quiet", "wifi", "coffee"])).toBe("quiet; wifi; coffee");
    });

    it("encloses cells containing commas in double quotes according to RFC 4180 Rule 6", () => {
      expect(escapeRFC4180Cell("Blue Bottle Cafe, Downtown")).toBe(
        '"Blue Bottle Cafe, Downtown"'
      );
    });

    it("escapes internal double quotes as double double-quotes ('\"\"') and encloses in quotes according to RFC 4180 Rule 7", () => {
      expect(escapeRFC4180Cell('The "Best" Coworking')).toBe(
        '"The ""Best"" Coworking"'
      );
      expect(escapeRFC4180Cell('"Quoted"')).toBe('"""Quoted"""');
    });

    it("encloses cells containing line feeds (\\n) in double quotes", () => {
      expect(escapeRFC4180Cell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    });

    it("encloses cells containing carriage returns (\\r) in double quotes", () => {
      expect(escapeRFC4180Cell("Line 1\r\nLine 2")).toBe('"Line 1\r\nLine 2"');
    });

    it("handles cells containing commas, double quotes, AND newlines simultaneously", () => {
      const complexString = 'Header: "Title",\nDetails: "Room 101"';
      const expected = '"Header: ""Title"",\nDetails: ""Room 101"""';
      expect(escapeRFC4180Cell(complexString)).toBe(expected);
    });

    it("sanitizes formula injection triggers (=, +, -, @, \\t, \\r) by prepending a single quote", () => {
      expect(escapeRFC4180Cell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(escapeRFC4180Cell("+123456789")).toBe("'+123456789");
      expect(escapeRFC4180Cell("-100")).toBe("'-100");
      expect(escapeRFC4180Cell("@cmd.exe")).toBe("'@cmd.exe");
      expect(escapeRFC4180Cell("\tTabValue")).toBe("'\tTabValue");
    });

    it("sanitizes formula triggers when formula trigger is followed by quotes or commas", () => {
      expect(escapeRFC4180Cell('=1+1, "evil"')).toBe('"\'=1+1, ""evil"""');
    });

    it("bypasses formula sanitization when sanitizeFormulas option is set to false", () => {
      expect(escapeRFC4180Cell("=SUM(A1:A10)", false)).toBe("=SUM(A1:A10)");
      expect(escapeRFC4180Cell("+100", false)).toBe("+100");
    });

    it("provides alias function sanitizeCsvCell", () => {
      expect(sanitizeCsvCell("Test, Value")).toBe('"Test, Value"');
    });
  });

  describe("buildRFC4180CSV", () => {
    it("builds a basic CSV string with headers and rows", () => {
      const headers = ["id", "name", "price"];
      const rows = [
        { id: "1", name: "Desk A", price: 15 },
        { id: "2", name: "Desk B", price: 20 },
      ];

      const csv = buildRFC4180CSV(headers, rows);
      const expected = "id,name,price\r\n1,Desk A,15\r\n2,Desk B,20";
      expect(csv).toBe(expected);
    });

    it("handles array rows as well as object rows", () => {
      const headers = ["Col1", "Col2"];
      const rows = [
        ["Val1", "Val2"],
        ["Val3, Comma", 'Val4 "Quote"'],
      ];

      const csv = buildRFC4180CSV(headers, rows);
      expect(csv).toContain('Col1,Col2\r\nVal1,Val2\r\n"Val3, Comma","Val4 ""Quote"""');
    });

    it("supports custom line delimiters (e.g. \\n)", () => {
      const headers = ["a", "b"];
      const rows = [{ a: 1, b: 2 }];
      const csv = buildRFC4180CSV(headers, rows, { lineDelimiter: "\n" });
      expect(csv).toBe("a,b\n1,2");
    });

    it("prepends UTF-8 BOM (\\uFEFF) when includeBOM option is enabled", () => {
      const headers = ["Name"];
      const rows = [{ Name: "Cafe" }];
      const csv = buildRFC4180CSV(headers, rows, { includeBOM: true });
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toBe("\uFEFFName\r\nCafe");
    });
  });

  describe("exportVenueDataToCSV", () => {
    it("correctly escapes venue names containing commas", () => {
      const venues: VenueExportRow[] = [
        {
          id: "v_01",
          name: "Blue Bottle, Downtown",
          address: "123 Main St",
          category: "cafe",
          hourlyRate: 12.5,
          noiseLevel: "quiet",
        },
      ];

      const csv = exportVenueDataToCSV(venues);
      expect(csv).toContain('"Blue Bottle, Downtown"');
      expect(csv).toContain("123 Main St");
    });

    it("correctly escapes venue names and descriptions containing double quotes", () => {
      const venues: VenueExportRow[] = [
        {
          id: "v_02",
          name: 'The "VIP" Hub',
          description: 'A "premium" space with "silent" booths.',
        },
      ];

      const csv = exportVenueDataToCSV(venues);
      expect(csv).toContain('"The ""VIP"" Hub"');
      expect(csv).toContain('"A ""premium"" space with ""silent"" booths."');
    });

    it("correctly escapes venue descriptions containing multiline newlines", () => {
      const venues: VenueExportRow[] = [
        {
          id: "v_03",
          name: "CoWork MultiFloor",
          description: "Floor 1: Main Desk\nFloor 2: Quiet Pods\nFloor 3: Conference Room",
        },
      ];

      const csv = exportVenueDataToCSV(venues);
      expect(csv).toContain('"Floor 1: Main Desk\nFloor 2: Quiet Pods\nFloor 3: Conference Room"');
    });

    it("escapes tags arrays as semicolon-separated quoted strings if tags contain commas", () => {
      const venues: VenueExportRow[] = [
        {
          id: "v_04",
          name: "TechSpace",
          tags: ["fast-wifi", "espresso, organic", "24/7"],
        },
      ];

      const csv = exportVenueDataToCSV(venues);
      expect(csv).toContain('"fast-wifi; espresso, organic; 24/7"');
    });

    it("sanitizes formula injection in venue export fields", () => {
      const venues: VenueExportRow[] = [
        {
          id: "v_05",
          name: "=HYPERLINK(\"http://malicious.com\")",
          address: "+1 (555) 019-2831",
        },
      ];

      const csv = exportVenueDataToCSV(venues);
      expect(csv).toContain('"\u0027=HYPERLINK(""http://malicious.com"")"');
      expect(csv).toContain("'+1 (555) 019-2831");
    });
  });

  describe("RFC 4180 Edge Case Matrix Compliance", () => {
    const testCases = [
      { input: "simple", expected: "simple" },
      { input: "with,comma", expected: '"with,comma"' },
      { input: 'with "quote"', expected: '"with ""quote"""' },
      { input: "with\nnewline", expected: '"with\nnewline"' },
      { input: "with\r\ncrlf", expected: '"with\r\ncrlf"' },
      { input: 'combo, "quote"\nnewline', expected: '"combo, ""quote""\nnewline"' },
      { input: "   leading spaces   ", expected: "   leading spaces   " },
      { input: '   leading spaces, "quotes"   ', expected: '"   leading spaces, ""quotes""   "' },
      { input: "123.456", expected: "123.456" },
      { input: "", expected: "" },
    ];

    testCases.forEach(({ input, expected }, idx) => {
      it(`passes edge case #${idx + 1}: ${JSON.stringify(input)}`, () => {
        expect(escapeRFC4180Cell(input, false)).toBe(expected);
      });
    });
  });
});
