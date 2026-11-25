/**
 * Helper for exporting venue noise telemetry metrics as JSON or CSV.
 */

import { triggerBrowserDownload } from "@/lib/export/csvBuilder";
import {
  exportNoiseMetricsToCSV,
  type NoiseMetricExportRow,
} from "@/lib/export/csvExporter";

export interface NoiseTelemetryRecord {
  timestamp: string | Date;
  decibels?: number | null;
  avgDecibels?: number | null;
  peakDecibels?: number | null;
  peakFrequencyHz?: number | null;
  peakFrequency?: number | null;
  [key: string]: unknown;
}

export interface FormattedNoiseTelemetryPoint {
  timestamp: string;
  decibels: number | null;
  peakDecibels?: number | null;
  peakFrequencyHz?: number | null;
}

export interface VenueNoiseMetricsExportPayload {
  venueId: string;
  exportedAt: string;
  totalRecords: number;
  readings: FormattedNoiseTelemetryPoint[];
}

/**
 * Normalizes a timestamp to a valid ISO string. Returns null if invalid.
 */
function toIsoTimestamp(raw: string | Date | unknown): string | null {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Validates finite number or null.
 */
function toFiniteOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * Formats raw noise telemetry items into a clean, predictable JSON payload.
 * Preserves chronological order, handles optional fields, and skips invalid timestamps.
 */
export function formatNoiseMetricsJSON(
  venueId: string,
  records: NoiseTelemetryRecord[],
  options?: { exportedAt?: string | Date }
): VenueNoiseMetricsExportPayload {
  const safeId = (venueId || "unknown").trim();
  const exportTimestamp = options?.exportedAt
    ? toIsoTimestamp(options.exportedAt) || new Date().toISOString()
    : new Date().toISOString();

  if (!Array.isArray(records) || records.length === 0) {
    return {
      venueId: safeId,
      exportedAt: exportTimestamp,
      totalRecords: 0,
      readings: [],
    };
  }

  const formatted: FormattedNoiseTelemetryPoint[] = [];

  for (const item of records) {
    if (!item) continue;
    const iso = toIsoTimestamp(item.timestamp);
    if (!iso) continue; // skip entries with invalid timestamps

    const dbVal = toFiniteOrNull(
      item.decibels !== undefined ? item.decibels : item.avgDecibels
    );
    const peakDbVal = toFiniteOrNull(item.peakDecibels);
    const peakFreqVal = toFiniteOrNull(
      item.peakFrequencyHz !== undefined
        ? item.peakFrequencyHz
        : item.peakFrequency
    );

    const point: FormattedNoiseTelemetryPoint = {
      timestamp: iso,
      decibels: dbVal,
    };

    if (peakDbVal !== null) {
      point.peakDecibels = peakDbVal;
    }
    if (peakFreqVal !== null) {
      point.peakFrequencyHz = peakFreqVal;
    }

    formatted.push(point);
  }

  // Preserve chronological order (ascending)
  formatted.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    venueId: safeId,
    exportedAt: exportTimestamp,
    totalRecords: formatted.length,
    readings: formatted,
  };
}

/**
 * Generates formatted JSON string with 2-space indentation.
 */
export function generateNoiseMetricsJSON(
  venueId: string,
  records: NoiseTelemetryRecord[],
  options?: { exportedAt?: string | Date }
): string {
  const payload = formatNoiseMetricsJSON(venueId, records, options);
  return JSON.stringify(payload, null, 2);
}

/**
 * Generates filesystem-safe filename pattern:
 * noise-metrics-<venueId>-<timestamp>.json
 */
export function generateNoiseMetricsFilename(
  venueId: string,
  date: Date = new Date(),
  extension: "json" | "csv" = "json"
): string {
  const safeVenueId = (venueId || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");

  const iso = date.toISOString(); // e.g. 2026-11-24T14:30:00.000Z
  const formattedDate = iso.replace(/[:.]/g, "-");

  return `noise-metrics-${safeVenueId}-${formattedDate}.${extension}`;
}

/**
 * Triggers a client-side download of the venue noise metrics JSON file.
 * Returns true if download was triggered, false if skipped due to empty data or error.
 */
export function downloadNoiseMetricsJSON(
  venueId: string,
  records: NoiseTelemetryRecord[],
  options?: { filename?: string; exportedAt?: string | Date }
): boolean {
  if (!Array.isArray(records) || records.length === 0) {
    return false;
  }

  const jsonString = generateNoiseMetricsJSON(venueId, records, options);
  const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
  const filename =
    options?.filename ||
    generateNoiseMetricsFilename(venueId, new Date(), "json");

  triggerBrowserDownload(blob, filename);
  return true;
}

/**
 * Triggers a client-side download of the venue noise metrics CSV file.
 */
export function downloadNoiseMetricsCSV(
  venueId: string,
  records: NoiseTelemetryRecord[],
  options?: { filename?: string }
): boolean {
  if (!Array.isArray(records) || records.length === 0) {
    return false;
  }

  const rows: NoiseMetricExportRow[] = records.map((r) => ({
    timestamp: r.timestamp,
    venueId,
    avgDecibels: r.avgDecibels !== undefined ? r.avgDecibels : r.decibels,
    peakDecibels: r.peakDecibels ?? null,
  }));

  const csv = exportNoiseMetricsToCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const filename =
    options?.filename ||
    generateNoiseMetricsFilename(venueId, new Date(), "csv");

  triggerBrowserDownload(blob, filename);
  return true;
}
