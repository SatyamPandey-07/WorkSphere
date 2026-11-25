/**
 * Acoustics and historical noise level export utility (#10005).
 * Generates RFC 4180 compliant CSV format for venue historical noise readings.
 */

import { escapeRFC4180Cell, type RFC4180Options } from "./csvExporter";

export const ACOUSTICS_HISTORY_CSV_HEADERS = [
  "timestamp",
  "average_db",
  "peak_db",
  "dominant_frequency_hz",
  "quiet_score",
] as const;

export interface AcousticsHistoryRow {
  timestamp: string | Date;
  average_db?: number | null;
  peak_db?: number | null;
  dominant_frequency_hz?: number | null;
  quiet_score?: number | null;
}

/**
 * Calculates a 0-100 quiet score from decibel reading.
 * 100 = <= 30 dB (pin-drop quiet), 0 = >= 90 dB (very loud).
 */
export function calculateQuietScore(
  averageDb: number | null | undefined
): number | null {
  if (
    averageDb === null ||
    averageDb === undefined ||
    !Number.isFinite(averageDb)
  ) {
    return null;
  }
  const score = Math.round(100 - ((averageDb - 30) / (90 - 30)) * 100);
  return Math.max(0, Math.min(100, score));
}

/**
 * Generates the standardized filename: venue-<id>-noise-history-<date>.csv
 */
export function formatAcousticsHistoryFilename(
  venueId: string,
  date: Date | string = new Date()
): string {
  const safeId = (venueId || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");

  let dateStr: string;
  if (date instanceof Date) {
    dateStr = Number.isNaN(date.getTime())
      ? new Date().toISOString().split("T")[0]
      : date.toISOString().split("T")[0];
  } else if (typeof date === "string") {
    dateStr = date.includes("T") ? date.split("T")[0] : date.trim();
  } else {
    dateStr = new Date().toISOString().split("T")[0];
  }

  return `venue-${safeId}-noise-history-${dateStr}.csv`;
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") {
    return Number.isFinite(val) ? String(val) : "";
  }
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? "" : val.toISOString();
  }
  return escapeRFC4180Cell(val);
}

/**
 * Builds RFC 4180 compliant CSV string from acoustics history rows.
 */
export function exportAcousticsHistoryToCSV(
  rows: AcousticsHistoryRow[],
  options: Pick<RFC4180Options, "lineDelimiter" | "includeBOM"> = {}
): string {
  const delimiter = options.lineDelimiter ?? "\r\n";
  const bom = options.includeBOM ? "\uFEFF" : "";
  const header = ACOUSTICS_HISTORY_CSV_HEADERS.join(",");

  const lines: string[] = [bom + header];

  for (const row of rows) {
    let timestampStr = "";
    if (row.timestamp instanceof Date) {
      timestampStr = Number.isNaN(row.timestamp.getTime())
        ? ""
        : row.timestamp.toISOString();
    } else if (row.timestamp !== null && row.timestamp !== undefined) {
      timestampStr = String(row.timestamp);
    }

    const avgDb =
      row.average_db !== undefined &&
      row.average_db !== null &&
      Number.isFinite(row.average_db)
        ? Number(row.average_db)
        : null;

    const peakDb =
      row.peak_db !== undefined &&
      row.peak_db !== null &&
      Number.isFinite(row.peak_db)
        ? Number(row.peak_db)
        : null;

    const domFreq =
      row.dominant_frequency_hz !== undefined &&
      row.dominant_frequency_hz !== null &&
      Number.isFinite(row.dominant_frequency_hz)
        ? Number(row.dominant_frequency_hz)
        : null;

    const quietScore =
      row.quiet_score !== undefined &&
      row.quiet_score !== null &&
      Number.isFinite(row.quiet_score)
        ? Number(row.quiet_score)
        : avgDb !== null
          ? calculateQuietScore(avgDb)
          : null;

    const cells = [
      formatCell(timestampStr),
      formatCell(avgDb),
      formatCell(peakDb),
      formatCell(domFreq),
      formatCell(quietScore),
    ];

    lines.push(cells.join(","));
  }

  return lines.join(delimiter) + delimiter;
}

/**
 * Triggers a browser download using Blob and URL.createObjectURL without external heavy dependencies.
 */
export function downloadAcousticsHistoryCSV(
  venueId: string,
  rows: AcousticsHistoryRow[],
  date?: Date | string
): boolean {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !window.Blob ||
    !window.URL?.createObjectURL
  ) {
    return false;
  }

  const csv = exportAcousticsHistoryToCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const filename = formatAcousticsHistoryFilename(venueId, date);

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
  return true;
}
