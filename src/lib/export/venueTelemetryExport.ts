import { escapeRFC4180Cell, crowdLevelToDensityScore } from "@/lib/export/csvExporter";

/** Column order of the venue telemetry export (CSV header and JSON keys). */
export const TELEMETRY_EXPORT_COLUMNS = [
  "timestamp",
  "decibel_avg",
  "decibel_peak",
  "occupancy_ratio",
  "wifi_speed_mbps",
] as const;

export interface TelemetryExportRow {
  timestamp: string;
  decibel_avg: number | null;
  decibel_peak: number | null;
  occupancy_ratio: number | null;
  wifi_speed_mbps: number | null;
}

/** Noise readings stored with a venue rating. */
export interface TelemetryNoiseReading {
  createdAt: Date;
  avgDecibels: number | null;
  peakDecibels: number | null;
}

/** Rows from the dedicated telemetry table (noise, headcount, download speed). */
export interface TelemetryRecordSample {
  timestamp: Date;
  noiseLevel: number | null;
  occupancy: number | null;
  download: number | null;
}

/** WiFi telemetry samples (download speed plus a coarse crowd label). */
export interface TelemetryWifiSample {
  timestamp: Date;
  download: number | null;
  crowdLevel: string | null;
}

export interface BuildTelemetryRowsInput {
  readings?: TelemetryNoiseReading[];
  records?: TelemetryRecordSample[];
  wifiSamples?: TelemetryWifiSample[];
  /** Used to turn a headcount into an occupancy ratio. */
  maxCapacity?: number | null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Headcount divided by capacity, clamped to 0..1. Null when capacity is unknown. */
export function toOccupancyRatio(
  occupancy: number | null | undefined,
  maxCapacity: number | null | undefined,
): number | null {
  const count = finiteOrNull(occupancy);
  const capacity = finiteOrNull(maxCapacity);
  if (count === null || capacity === null || capacity <= 0) return null;
  return round(Math.min(1, Math.max(0, count / capacity)), 3);
}

function emptyRow(iso: string): TelemetryExportRow {
  return {
    timestamp: iso,
    decibel_avg: null,
    decibel_peak: null,
    occupancy_ratio: null,
    wifi_speed_mbps: null,
  };
}

function toIso(date: Date): string | null {
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Merges the three telemetry sources into one time ordered list. Each source
 * fills only the columns it can provide, the rest stay empty instead of guessed.
 */
export function buildTelemetryRows(input: BuildTelemetryRowsInput): TelemetryExportRow[] {
  const rows: TelemetryExportRow[] = [];

  for (const reading of input.readings ?? []) {
    const iso = toIso(reading.createdAt);
    if (!iso) continue;
    rows.push({
      ...emptyRow(iso),
      decibel_avg: finiteOrNull(reading.avgDecibels),
      decibel_peak: finiteOrNull(reading.peakDecibels),
    });
  }

  for (const record of input.records ?? []) {
    const iso = toIso(record.timestamp);
    if (!iso) continue;
    rows.push({
      ...emptyRow(iso),
      decibel_avg: finiteOrNull(record.noiseLevel),
      occupancy_ratio: toOccupancyRatio(record.occupancy, input.maxCapacity),
      wifi_speed_mbps: finiteOrNull(record.download),
    });
  }

  for (const sample of input.wifiSamples ?? []) {
    const iso = toIso(sample.timestamp);
    if (!iso) continue;
    const density = crowdLevelToDensityScore(sample.crowdLevel);
    rows.push({
      ...emptyRow(iso),
      occupancy_ratio: density === null ? null : round(density / 100, 3),
      wifi_speed_mbps: finiteOrNull(sample.download),
    });
  }

  return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function mean(values: number[], decimals: number): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, v) => sum + v, 0) / values.length, decimals);
}

function numbers(values: Array<number | null>): number[] {
  return values.filter((v): v is number => v !== null);
}

/**
 * Anonymized view for non managers: individual samples are folded into one row
 * per UTC hour (mean noise, peak of peaks, mean occupancy and WiFi speed) with
 * rounded values, so single submissions cannot be picked out.
 */
export function anonymizeTelemetryRows(rows: TelemetryExportRow[]): TelemetryExportRow[] {
  const buckets = new Map<string, TelemetryExportRow[]>();
  for (const row of rows) {
    const hour = `${row.timestamp.slice(0, 13)}:00:00.000Z`;
    const bucket = buckets.get(hour);
    if (bucket) bucket.push(row);
    else buckets.set(hour, [row]);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, bucket]) => {
      const peaks = numbers(bucket.map((r) => r.decibel_peak));
      return {
        timestamp,
        decibel_avg: mean(numbers(bucket.map((r) => r.decibel_avg)), 1),
        decibel_peak: peaks.length ? round(Math.max(...peaks), 1) : null,
        occupancy_ratio: mean(numbers(bucket.map((r) => r.occupancy_ratio)), 2),
        wifi_speed_mbps: mean(numbers(bucket.map((r) => r.wifi_speed_mbps)), 1),
      };
    });
}

function telemetryCell(value: unknown): string {
  // Numbers cannot carry spreadsheet formulas, so skip the leading "-" guard.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return escapeRFC4180Cell(value);
}

/** Yields the CSV one line at a time, header first, each ending in CRLF. */
export function* iterateTelemetryCsv(
  rows: Iterable<TelemetryExportRow>,
  options: { lineDelimiter?: string; includeBOM?: boolean } = {},
): Generator<string, void, undefined> {
  const eol = options.lineDelimiter ?? "\r\n";
  yield (options.includeBOM ? "\uFEFF" : "") + TELEMETRY_EXPORT_COLUMNS.join(",") + eol;
  for (const row of rows) {
    yield TELEMETRY_EXPORT_COLUMNS.map((column) => telemetryCell(row[column])).join(",") + eol;
  }
}

/** Whole telemetry CSV as one RFC 4180 string. */
export function exportTelemetryToCsv(
  rows: Iterable<TelemetryExportRow>,
  options: { lineDelimiter?: string; includeBOM?: boolean } = {},
): string {
  return Array.from(iterateTelemetryCsv(rows, options)).join("");
}
