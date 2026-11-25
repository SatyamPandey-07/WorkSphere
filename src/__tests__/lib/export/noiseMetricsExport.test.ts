import {
  formatNoiseMetricsJSON,
  generateNoiseMetricsJSON,
  generateNoiseMetricsFilename,
  downloadNoiseMetricsJSON,
  downloadNoiseMetricsCSV,
  type NoiseTelemetryRecord,
} from "@/lib/export/noiseMetricsExport";

describe("noiseMetricsExport helper (#9884)", () => {
  const sampleRecords: NoiseTelemetryRecord[] = [
    {
      timestamp: "2026-11-24T10:00:00.000Z",
      decibels: 48.5,
      peakDecibels: 62.0,
      peakFrequencyHz: 440,
    },
    {
      timestamp: "2026-11-24T09:00:00.000Z",
      avgDecibels: 42.1,
      peakDecibels: 55.4,
      peakFrequency: 320,
    },
    {
      timestamp: "2026-11-24T11:00:00.000Z",
      decibels: 58.2,
      peakDecibels: null,
      peakFrequencyHz: null,
    },
  ];

  describe("formatNoiseMetricsJSON", () => {
    it("preserves venue ID and formats representative telemetry records into expected JSON schema", () => {
      const fixedExportedAt = "2026-11-24T12:00:00.000Z";
      const payload = formatNoiseMetricsJSON("venue_42", sampleRecords, {
        exportedAt: fixedExportedAt,
      });

      expect(payload.venueId).toBe("venue_42");
      expect(payload.exportedAt).toBe(fixedExportedAt);
      expect(payload.totalRecords).toBe(3);
      expect(payload.readings).toHaveLength(3);

      // Verify chronological ordering (09:00, 10:00, 11:00)
      expect(payload.readings[0].timestamp).toBe("2026-11-24T09:00:00.000Z");
      expect(payload.readings[1].timestamp).toBe("2026-11-24T10:00:00.000Z");
      expect(payload.readings[2].timestamp).toBe("2026-11-24T11:00:00.000Z");
    });

    it("preserves decibel readings from decibels or avgDecibels", () => {
      const payload = formatNoiseMetricsJSON("v1", sampleRecords);
      expect(payload.readings[0].decibels).toBe(42.1);
      expect(payload.readings[1].decibels).toBe(48.5);
      expect(payload.readings[2].decibels).toBe(58.2);
    });

    it("correctly includes peak frequency from peakFrequencyHz or peakFrequency", () => {
      const payload = formatNoiseMetricsJSON("v1", sampleRecords);
      expect(payload.readings[0].peakFrequencyHz).toBe(320);
      expect(payload.readings[1].peakFrequencyHz).toBe(440);
      expect(payload.readings[2].peakFrequencyHz).toBeUndefined();
    });

    it("correctly includes peak decibels when available", () => {
      const payload = formatNoiseMetricsJSON("v1", sampleRecords);
      expect(payload.readings[0].peakDecibels).toBe(55.4);
      expect(payload.readings[1].peakDecibels).toBe(62.0);
      expect(payload.readings[2].peakDecibels).toBeUndefined();
    });

    it("handles missing or null optional values consistently", () => {
      const recordsWithMissing: NoiseTelemetryRecord[] = [
        {
          timestamp: "2026-11-24T08:00:00.000Z",
          decibels: null,
          peakDecibels: null,
          peakFrequencyHz: null,
        },
      ];
      const payload = formatNoiseMetricsJSON("v1", recordsWithMissing);
      expect(payload.readings[0]).toEqual({
        timestamp: "2026-11-24T08:00:00.000Z",
        decibels: null,
      });
    });

    it("handles empty telemetry records without throwing", () => {
      const payload = formatNoiseMetricsJSON("venue_empty", []);
      expect(payload.venueId).toBe("venue_empty");
      expect(payload.totalRecords).toBe(0);
      expect(payload.readings).toEqual([]);
    });

    it("skips records with malformed or invalid timestamps without crashing", () => {
      const mixedRecords: NoiseTelemetryRecord[] = [
        { timestamp: "not-a-date", decibels: 50 },
        { timestamp: "2026-11-24T10:00:00.000Z", decibels: 45 },
      ];
      const payload = formatNoiseMetricsJSON("v1", mixedRecords);
      expect(payload.totalRecords).toBe(1);
      expect(payload.readings[0].timestamp).toBe("2026-11-24T10:00:00.000Z");
    });
  });

  describe("generateNoiseMetricsJSON", () => {
    it("produces valid JSON formatted with readable indentation", () => {
      const jsonStr = generateNoiseMetricsJSON("v1", sampleRecords, {
        exportedAt: "2026-11-24T12:00:00.000Z",
      });
      expect(jsonStr).toContain('  "venueId": "v1"');
      expect(jsonStr).toContain('  "readings": [');
      const parsed = JSON.parse(jsonStr);
      expect(parsed.venueId).toBe("v1");
      expect(parsed.readings).toHaveLength(3);
    });
  });

  describe("generateNoiseMetricsFilename", () => {
    it("follows the pattern noise-metrics-<venueId>-<timestamp>.json", () => {
      const testDate = new Date("2026-11-24T14:30:00.000Z");
      const filename = generateNoiseMetricsFilename("venue-123", testDate, "json");
      expect(filename).toBe("noise-metrics-venue-123-2026-11-24T14-30-00-000Z.json");
    });

    it("sanitizes special characters in venueId for filesystem safety", () => {
      const testDate = new Date("2026-11-24T14:30:00.000Z");
      const filename = generateNoiseMetricsFilename("Cafe & Cowork / 1", testDate, "json");
      expect(filename).toMatch(/^noise-metrics-cafe___cowork___1-.*\.json$/);
    });
  });

  describe("downloadNoiseMetricsJSON and downloadNoiseMetricsCSV", () => {
    let originalCreateObjectURL: typeof window.URL.createObjectURL;
    let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;
    let mockCreateObjectURL: jest.Mock;
    let mockRevokeObjectURL: jest.Mock;

    beforeEach(() => {
      originalCreateObjectURL = window.URL.createObjectURL;
      originalRevokeObjectURL = window.URL.revokeObjectURL;
      mockCreateObjectURL = jest.fn(() => "blob:mock-url");
      mockRevokeObjectURL = jest.fn();
      window.URL.createObjectURL = mockCreateObjectURL;
      window.URL.revokeObjectURL = mockRevokeObjectURL;
    });

    afterEach(() => {
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
      jest.restoreAllMocks();
    });

    it("does not trigger download when telemetry records are empty", () => {
      const result = downloadNoiseMetricsJSON("v1", []);
      expect(result).toBe(false);
      expect(mockCreateObjectURL).not.toHaveBeenCalled();
    });

    it("triggers JSON download with application/json MIME type and cleans up temporary object URL and anchor", () => {
      const clickSpy = jest.fn();
      const realCreateElement = document.createElement.bind(document);
      jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const el = realCreateElement(tagName);
        if (tagName.toLowerCase() === "a") {
          el.click = clickSpy;
        }
        return el;
      });

      const appendChildSpy = jest.spyOn(document.body, "appendChild");
      const removeChildSpy = jest.spyOn(document.body, "removeChild");

      const result = downloadNoiseMetricsJSON("v1", sampleRecords);
      expect(result).toBe(true);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const createdBlob = mockCreateObjectURL.mock.calls[0][0] as Blob;
      expect(createdBlob).toBeInstanceOf(Blob);
      expect(createdBlob.type).toContain("application/json");

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });

    it("triggers CSV download preserving existing CSV functionality", () => {
      const clickSpy = jest.fn();
      const realCreateElement = document.createElement.bind(document);
      jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const el = realCreateElement(tagName);
        if (tagName.toLowerCase() === "a") {
          el.click = clickSpy;
        }
        return el;
      });

      const appendChildSpy = jest.spyOn(document.body, "appendChild");
      const removeChildSpy = jest.spyOn(document.body, "removeChild");

      const result = downloadNoiseMetricsCSV("v1", sampleRecords);
      expect(result).toBe(true);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const createdBlob = mockCreateObjectURL.mock.calls[0][0] as Blob;
      expect(createdBlob).toBeInstanceOf(Blob);
      expect(createdBlob.type).toContain("text/csv");

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });
  });
});
