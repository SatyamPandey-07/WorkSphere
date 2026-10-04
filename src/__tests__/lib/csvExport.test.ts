import {
  AnalyticsMetric,
  exportAnalyticsToCSV,
  downloadAnalyticsCSV,
  escapeCSVField,
} from "@/lib/csvExport";

describe("csvExport utility", () => {
  describe("escapeCSVField", () => {
    it("returns empty string for null or undefined", () => {
      expect(escapeCSVField(null)).toBe("");
      expect(escapeCSVField(undefined)).toBe("");
    });

    it("returns plain numbers and simple strings unchanged", () => {
      expect(escapeCSVField(123)).toBe("123");
      expect(escapeCSVField("simple")).toBe("simple");
    });

    it("escapes fields containing commas by wrapping in double quotes", () => {
      expect(escapeCSVField("hello, world")).toBe('"hello, world"');
    });

    it("escapes fields containing newlines by wrapping in double quotes", () => {
      expect(escapeCSVField("line1\nline2")).toBe('"line1\nline2"');
      expect(escapeCSVField("line1\r\nline2")).toBe('"line1\r\nline2"');
    });

    it("escapes fields containing double quotes by doubling them and wrapping", () => {
      expect(escapeCSVField('hello "world"')).toBe('"hello ""world"""');
    });

    it("formats Date objects as ISO strings", () => {
      const date = new Date("2026-10-03T12:00:00.000Z");
      expect(escapeCSVField(date)).toBe("2026-10-03T12:00:00.000Z");
    });
  });

  describe("exportAnalyticsToCSV", () => {
    it("includes required RFC-4180 header columns", () => {
      const csv = exportAnalyticsToCSV([]);
      expect(csv).toBe("Timestamp,Visitor Count,Check Ins,Mean Decibel Level");
    });

    it("formats standard AnalyticsMetric records correctly", () => {
      const mockData: AnalyticsMetric[] = [
        {
          timestamp: "2026-10-03T08:00:00Z",
          visitorCount: 150,
          checkIns: 45,
          meanDecibelLevel: 58.5,
        },
        {
          timestamp: "2026-10-03T09:00:00Z",
          visitorCount: 200,
          checkIns: 80,
          meanDecibelLevel: 62.1,
        },
      ];

      const csv = exportAnalyticsToCSV(mockData);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe("Timestamp,Visitor Count,Check Ins,Mean Decibel Level");
      expect(lines[1]).toBe("2026-10-03T08:00:00Z,150,45,58.5");
      expect(lines[2]).toBe("2026-10-03T09:00:00Z,200,80,62.1");
    });

    it("handles Date objects in timestamp field", () => {
      const date = new Date("2026-10-03T10:00:00.000Z");
      const mockData: AnalyticsMetric[] = [
        {
          timestamp: date,
          visitorCount: 75,
          checkIns: 30,
          meanDecibelLevel: 45.0,
        },
      ];

      const csv = exportAnalyticsToCSV(mockData);
      expect(csv).toContain("2026-10-03T10:00:00.000Z,75,30,45");
    });

    it("escapes timestamps with commas, newlines, or quotes", () => {
      const mockData: AnalyticsMetric[] = [
        {
          timestamp: '2026-10-03, 10:00 AM "Morning"',
          visitorCount: 10,
          checkIns: 5,
          meanDecibelLevel: 50,
        },
        {
          timestamp: "2026-10-03\nShift 2",
          visitorCount: 20,
          checkIns: 10,
          meanDecibelLevel: 55,
        },
      ];

      const csv = exportAnalyticsToCSV(mockData);
      expect(csv).toContain('"2026-10-03, 10:00 AM ""Morning""",10,5,50');
      expect(csv).toContain('"2026-10-03\nShift 2",20,10,55');
    });

    it("handles missing or zero values gracefully", () => {
      const mockData: AnalyticsMetric[] = [
        {
          timestamp: "2026-10-03",
          visitorCount: 0,
          checkIns: 0,
          meanDecibelLevel: 0,
        },
      ];

      const csv = exportAnalyticsToCSV(mockData);
      expect(csv).toContain("2026-10-03,0,0,0");
    });
  });

  describe("downloadAnalyticsCSV", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("creates a Blob and triggers DOM download", () => {
      const createObjectURLMock = jest.fn(() => "blob:http://localhost/test-uuid");
      const revokeObjectURLMock = jest.fn();
      const clickMock = jest.fn();

      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      const appendChildSpy = jest.spyOn(document.body, "appendChild").mockImplementation((node) => node);
      const removeChildSpy = jest.spyOn(document.body, "removeChild").mockImplementation((node) => node);

      const mockAnchor = {
        href: "",
        download: "",
        click: clickMock,
      } as unknown as HTMLAnchorElement;

      jest.spyOn(document, "createElement").mockReturnValue(mockAnchor);

      const mockData: AnalyticsMetric[] = [
        {
          timestamp: "2026-10-03",
          visitorCount: 100,
          checkIns: 50,
          meanDecibelLevel: 60,
        },
      ];

      const blob = downloadAnalyticsCSV(mockData);

      expect(blob).toBeInstanceOf(Blob);
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(mockAnchor.download).toMatch(/^worksphere-analytics-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(clickMock).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor);
      expect(removeChildSpy).toHaveBeenCalledWith(mockAnchor);
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:http://localhost/test-uuid");

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });
  });
});
