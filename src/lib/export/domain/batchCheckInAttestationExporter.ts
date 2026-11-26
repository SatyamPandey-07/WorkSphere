/**
 * Batch Check-in Attestation CSV Summary Exporter
 *
 * Allows venue operators to export verified vs rejected batch check-in
 * attestation results as an RFC-4180 compliant CSV file with formula injection protection.
 */

import { CsvBuilder, escapeCSVField, triggerBrowserDownload } from "../csvBuilder";

export type AttestationStatus = "verified" | "rejected";

export interface BatchCheckInAttestationRecord {
  /** Booking or check-in request identifier */
  bookingId?: string | null;
  /** Attendee or user identifier */
  userId?: string | null;
  /** Attendee display name or email */
  userName?: string | null;
  /** Venue identifier */
  venueId?: string | null;
  /** Venue name */
  venueName?: string | null;
  /** Attestation outcome: "verified" or "rejected" */
  status: AttestationStatus | string;
  /** Reason for rejection or verification remarks */
  reason?: string | null;
  /** Confidence score between 0.0 and 1.0 */
  confidence?: number | null;
  /** Geofence GPS distance or age or sensor info */
  sensorDetails?: string | null;
  /** Timestamp of attestation evaluation */
  timestamp?: string | Date | number | null;
}

export interface BatchAttestationCsvExportOptions {
  /** Optional custom filename */
  filename?: string | null;
  /** Include byte-order mark for Excel compatibility */
  includeBOM?: boolean;
}

export const ATTESTATION_CSV_HEADERS = [
  "Booking ID",
  "User ID",
  "User Name",
  "Venue ID",
  "Venue Name",
  "Status",
  "Confidence",
  "Reason / Details",
  "Sensor Details",
  "Timestamp",
] as const;

/**
 * Formats timestamps into ISO format safely.
 */
export function formatAttestationTimestamp(ts: string | Date | number | null | undefined): string {
  if (ts === null || ts === undefined || ts === "") return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toISOString();
  } catch {
    return String(ts);
  }
}

/**
 * Normalizes status to standard uppercase / lowercase readable token.
 */
export function normalizeAttestationStatus(status: string | null | undefined): string {
  if (!status) return "REJECTED";
  const s = String(status).trim().toLowerCase();
  if (s === "verified" || s === "valid" || s === "true" || s === "success") {
    return "VERIFIED";
  }
  return "REJECTED";
}

/**
 * Generates an RFC-4180 compliant CSV string representing batch check-in attestation results.
 * Sanitizes formula-injection characters (=, +, -, @, \t, \r) in all user-controlled cells.
 */
export function generateBatchCheckInAttestationCSV(
  records: BatchCheckInAttestationRecord[],
  options?: { includeBOM?: boolean }
): string {
  const builder = new CsvBuilder<BatchCheckInAttestationRecord>({
    includeBOM: options?.includeBOM ?? false,
    sanitizeFormulas: true,
  });

  builder
    .addColumn("Booking ID", (r) => r.bookingId ?? "")
    .addColumn("User ID", (r) => r.userId ?? "")
    .addColumn("User Name", (r) => r.userName ?? "")
    .addColumn("Venue ID", (r) => r.venueId ?? "")
    .addColumn("Venue Name", (r) => r.venueName ?? "")
    .addColumn("Status", (r) => normalizeAttestationStatus(r.status))
    .addColumn("Confidence", (r) =>
      r.confidence !== null && r.confidence !== undefined
        ? Number(r.confidence).toFixed(2)
        : ""
    )
    .addColumn("Reason / Details", (r) => r.reason ?? "")
    .addColumn("Sensor Details", (r) => r.sensorDetails ?? "")
    .addColumn("Timestamp", (r) => formatAttestationTimestamp(r.timestamp));

  builder.addRows(records);
  return builder.build();
}

/**
 * Exports batch check-in attestation records as a CSV Blob.
 */
export function exportBatchCheckInAttestationToCSV(
  records: BatchCheckInAttestationRecord[],
  options?: BatchAttestationCsvExportOptions
): Blob {
  const csvContent = generateBatchCheckInAttestationCSV(records, {
    includeBOM: options?.includeBOM ?? true,
  });
  return new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
}

/**
 * Triggers a browser download of the batch check-in attestation CSV summary.
 */
export function downloadBatchCheckInAttestationCSV(
  records: BatchCheckInAttestationRecord[],
  options?: BatchAttestationCsvExportOptions
): void {
  const filename =
    options?.filename?.trim() ||
    `batch-checkin-attestation-${new Date().toISOString().slice(0, 10)}.csv`;
  const blob = exportBatchCheckInAttestationToCSV(records, options);
  triggerBrowserDownload(blob, filename);
}
