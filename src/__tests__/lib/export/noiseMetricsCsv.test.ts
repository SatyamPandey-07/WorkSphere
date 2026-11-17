import {
  NOISE_METRICS_CSV_HEADERS,
  buildNoiseMetricRows,
  crowdLevelToDensityScore,
  exportNoiseMetricsToCSV,
  iterateNoiseMetricsCsv,
} from "@/lib/export/csvExporter";

describe("noise metrics CSV export (#7674)", () => {
  it("writes the required header row in order", () => {
    const csv = exportNoiseMetricsToCSV([]);
    expect(csv).toBe(
      "timestamp,venueId,avgDecibels,peakDecibels,crowdDensityScore,wifiLatencyMs\r\n",
    );
    expect([...NOISE_METRICS_CSV_HEADERS]).toEqual([
      "timestamp",
      "venueId",
      "avgDecibels",
      "peakDecibels",
      "crowdDensityScore",
      "wifiLatencyMs",
    ]);
  });

  it("formats rows with ISO timestamps, CRLF endings and empty cells for missing values", () => {
    const csv = exportNoiseMetricsToCSV([
      {
        timestamp: new Date("2026-11-10T09:30:00.000Z"),
        venueId: "v1",
        avgDecibels: 52.4,
        peakDecibels: 71,
      },
      { timestamp: "2026-11-10T10:00:00.000Z", venueId: "v1", crowdDensityScore: 75, wifiLatencyMs: 23.5 },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "timestamp,venueId,avgDecibels,peakDecibels,crowdDensityScore,wifiLatencyMs",
      "2026-11-10T09:30:00.000Z,v1,52.4,71,,",
      "2026-11-10T10:00:00.000Z,v1,,,75,23.5",
      "",
    ]);
  });

  it("escapes commas, quotes and line breaks per RFC 4180", () => {
    const csv = exportNoiseMetricsToCSV([
      { timestamp: "t", venueId: 'Cafe "Quiet", Ltd\nSecond line' },
    ]);
    expect(csv).toContain('"Cafe ""Quiet"", Ltd\nSecond line"');
  });

  it("neutralises spreadsheet formulas in text but keeps negative numbers numeric", () => {
    const csv = exportNoiseMetricsToCSV([
      { timestamp: "t", venueId: "=HYPERLINK(\"http://evil\")", avgDecibels: -3.5, wifiLatencyMs: -1 },
    ]);
    const row = csv.split("\r\n")[1];
    expect(row.startsWith("t,\"'=HYPERLINK(")).toBe(true);
    expect(row.endsWith(",-3.5,,,-1")).toBe(true);
  });

  it("leaves NaN and Infinity cells empty", () => {
    const row = exportNoiseMetricsToCSV([
      { timestamp: "t", venueId: "v", avgDecibels: NaN, peakDecibels: Infinity },
    ]).split("\r\n")[1];
    expect(row).toBe("t,v,,,,");
  });

  it("supports LF line endings and an optional BOM", () => {
    const csv = exportNoiseMetricsToCSV([], { lineDelimiter: "\n", includeBOM: true });
    expect(csv.startsWith("\uFEFFtimestamp,")).toBe(true);
    expect(csv.endsWith("wifiLatencyMs\n")).toBe(true);
  });

  it("can be consumed lazily one line at a time", () => {
    const lines = iterateNoiseMetricsCsv([{ timestamp: "t", venueId: "v" }]);
    expect(lines.next().value).toMatch(/^timestamp,/);
    expect(lines.next().value).toBe("t,v,,,,\r\n");
    expect(lines.next().done).toBe(true);
  });

  it("maps crowd labels to density scores and never invents unknown ones", () => {
    expect(crowdLevelToDensityScore("Busy")).toBe(75);
    expect(crowdLevelToDensityScore(" very busy ")).toBe(90);
    expect(crowdLevelToDensityScore("packed")).toBe(100);
    expect(crowdLevelToDensityScore("mystery")).toBeNull();
    expect(crowdLevelToDensityScore(null)).toBeNull();
  });

  it("merges decibel readings and WiFi samples in time order", () => {
    const rows = buildNoiseMetricRows(
      "v1",
      [
        { createdAt: new Date("2026-11-10T12:00:00Z"), avgDecibels: 60, peakDecibels: 80 },
        { createdAt: new Date("2026-11-10T08:00:00Z"), avgDecibels: 45, peakDecibels: null },
      ],
      [{ timestamp: new Date("2026-11-10T10:00:00Z"), latency: 20, crowdLevel: "moderate" }],
    );
    expect(rows.map((r) => new Date(r.timestamp).toISOString())).toEqual([
      "2026-11-10T08:00:00.000Z",
      "2026-11-10T10:00:00.000Z",
      "2026-11-10T12:00:00.000Z",
    ]);
    expect(rows[1]).toMatchObject({ crowdDensityScore: 50, wifiLatencyMs: 20 });
    expect(rows[2]).toMatchObject({ avgDecibels: 60, peakDecibels: 80 });
  });
});
