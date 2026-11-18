import {
  TELEMETRY_EXPORT_COLUMNS,
  anonymizeTelemetryRows,
  buildTelemetryRows,
  exportTelemetryToCsv,
  iterateTelemetryCsv,
  toOccupancyRatio,
  type TelemetryExportRow,
} from "@/lib/export/venueTelemetryExport";

const row = (overrides: Partial<TelemetryExportRow> = {}): TelemetryExportRow => ({
  timestamp: "2026-11-10T08:00:00.000Z",
  decibel_avg: null,
  decibel_peak: null,
  occupancy_ratio: null,
  wifi_speed_mbps: null,
  ...overrides,
});

describe("venue telemetry export", () => {
  describe("CSV formatting", () => {
    it("uses the documented header order", () => {
      expect(TELEMETRY_EXPORT_COLUMNS.join(",")).toBe(
        "timestamp,decibel_avg,decibel_peak,occupancy_ratio,wifi_speed_mbps",
      );
      expect(exportTelemetryToCsv([])).toBe(
        "timestamp,decibel_avg,decibel_peak,occupancy_ratio,wifi_speed_mbps\r\n",
      );
    });

    it("writes values in column order and leaves missing values empty", () => {
      const csv = exportTelemetryToCsv([
        row({ decibel_avg: 48.5, decibel_peak: 70, occupancy_ratio: 0.42, wifi_speed_mbps: 95.2 }),
        row({ timestamp: "2026-11-10T09:00:00.000Z", wifi_speed_mbps: 80 }),
      ]);
      expect(csv.split("\r\n")).toEqual([
        "timestamp,decibel_avg,decibel_peak,occupancy_ratio,wifi_speed_mbps",
        "2026-11-10T08:00:00.000Z,48.5,70,0.42,95.2",
        "2026-11-10T09:00:00.000Z,,,,80",
        "",
      ]);
    });

    it("does not prefix negative numbers or turn NaN into text", () => {
      const csv = exportTelemetryToCsv([row({ decibel_avg: -3.5, decibel_peak: NaN })]);
      expect(csv.split("\r\n")[1]).toBe("2026-11-10T08:00:00.000Z,-3.5,,,");
    });

    it("escapes quotes, commas and newlines in text cells", () => {
      const csv = exportTelemetryToCsv([
        row({ timestamp: 'say "hi", ok\nnext' }),
      ]);
      expect(csv.split("\r\n")[1]).toBe('"say ""hi"", ok\nnext",,,,');
    });

    it("neutralizes spreadsheet formulas in text cells", () => {
      const csv = exportTelemetryToCsv([row({ timestamp: "=HYPERLINK(1)" })]);
      expect(csv.split("\r\n")[1]).toBe("'=HYPERLINK(1),,,,");
    });

    it("supports a BOM and a custom line delimiter", () => {
      const lines = Array.from(
        iterateTelemetryCsv([row({ wifi_speed_mbps: 1 })], {
          includeBOM: true,
          lineDelimiter: "\n",
        }),
      );
      expect(lines[0].startsWith("\uFEFF")).toBe(true);
      expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
    });
  });

  describe("toOccupancyRatio", () => {
    it("divides by capacity, clamps to 0..1 and rounds to 3 decimals", () => {
      expect(toOccupancyRatio(25, 50)).toBe(0.5);
      expect(toOccupancyRatio(1, 3)).toBe(0.333);
      expect(toOccupancyRatio(80, 50)).toBe(1);
      expect(toOccupancyRatio(-5, 50)).toBe(0);
    });

    it("returns null when headcount or capacity is unusable", () => {
      expect(toOccupancyRatio(null, 50)).toBeNull();
      expect(toOccupancyRatio(10, 0)).toBeNull();
      expect(toOccupancyRatio(10, null)).toBeNull();
      expect(toOccupancyRatio(Number.NaN, 50)).toBeNull();
    });
  });

  describe("buildTelemetryRows", () => {
    it("merges all sources in time order and fills only what each source knows", () => {
      const rows = buildTelemetryRows({
        maxCapacity: 40,
        readings: [
          { createdAt: new Date("2026-11-10T10:00:00Z"), avgDecibels: 50, peakDecibels: 72 },
        ],
        records: [
          {
            timestamp: new Date("2026-11-10T08:00:00Z"),
            noiseLevel: 44,
            occupancy: 10,
            download: 120,
          },
        ],
        wifiSamples: [
          { timestamp: new Date("2026-11-10T09:00:00Z"), download: 90, crowdLevel: "Busy" },
        ],
      });

      expect(rows).toEqual([
        row({
          timestamp: "2026-11-10T08:00:00.000Z",
          decibel_avg: 44,
          occupancy_ratio: 0.25,
          wifi_speed_mbps: 120,
        }),
        row({
          timestamp: "2026-11-10T09:00:00.000Z",
          occupancy_ratio: 0.75,
          wifi_speed_mbps: 90,
        }),
        row({ timestamp: "2026-11-10T10:00:00.000Z", decibel_avg: 50, decibel_peak: 72 }),
      ]);
    });

    it("never invents values for unknown crowd labels or missing capacity", () => {
      const rows = buildTelemetryRows({
        records: [
          { timestamp: new Date("2026-11-10T08:00:00Z"), noiseLevel: null, occupancy: 5, download: null },
        ],
        wifiSamples: [
          { timestamp: new Date("2026-11-10T09:00:00Z"), download: null, crowdLevel: "weird" },
        ],
      });
      expect(rows.every((r) => r.occupancy_ratio === null)).toBe(true);
    });

    it("drops rows with invalid timestamps", () => {
      const rows = buildTelemetryRows({
        readings: [{ createdAt: new Date("nope"), avgDecibels: 40, peakDecibels: 50 }],
      });
      expect(rows).toEqual([]);
    });
  });

  describe("anonymizeTelemetryRows", () => {
    it("folds samples into one rounded row per UTC hour", () => {
      const rows = anonymizeTelemetryRows([
        row({ timestamp: "2026-11-10T08:05:00.000Z", decibel_avg: 40, decibel_peak: 60, wifi_speed_mbps: 100 }),
        row({ timestamp: "2026-11-10T08:40:00.000Z", decibel_avg: 45, decibel_peak: 71.26, occupancy_ratio: 0.5 }),
        row({ timestamp: "2026-11-10T09:10:00.000Z", wifi_speed_mbps: 50 }),
      ]);

      expect(rows).toEqual([
        {
          timestamp: "2026-11-10T08:00:00.000Z",
          decibel_avg: 42.5,
          decibel_peak: 71.3,
          occupancy_ratio: 0.5,
          wifi_speed_mbps: 100,
        },
        {
          timestamp: "2026-11-10T09:00:00.000Z",
          decibel_avg: null,
          decibel_peak: null,
          occupancy_ratio: null,
          wifi_speed_mbps: 50,
        },
      ]);
    });

    it("returns nothing for no input", () => {
      expect(anonymizeTelemetryRows([])).toEqual([]);
    });
  });
});
