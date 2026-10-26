/**
 * Venue Ratings and Reviews Exporter (CSV).
 *
 * Implements RFC-4180 CSV export with formula injection sanitization
 * for venue ratings, feedback, and user reviews.
 */

import { CsvBuilder, escapeCSVField, triggerBrowserDownload } from "../csvBuilder";

export interface VenueRatingRecord {
  id?: string;
  createdAt?: string | Date | null;
  date?: string | Date | null;
  venueName?: string | null;
  user?:
    | string
    | {
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
      }
    | null;
  wifiQuality: number | string;
  noiseLevel: string;
  hasOutlets: boolean | string;
  outletDensity?: string | null;
  comment?: string | null;
  reviewText?: string | null;
}

export interface DownloadRatingsOptions {
  venueName?: string | null;
  name?: string | null;
  filename?: string | null;
}

export function formatCSVDate(dateVal: string | Date | null | undefined): string {
  if (!dateVal) return "N/A";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return String(dateVal);
  }
}

export function formatCSVUser(user: VenueRatingRecord["user"]): string {
  if (!user) return "Anonymous";
  if (typeof user === "string") return user.trim() || "Anonymous";
  if (typeof user !== "object") return "Anonymous";
  const fullName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fullName) return fullName;
  if (user.email && typeof user.email === "string") return user.email.trim() || "Anonymous";
  return "Anonymous";
}

export function generateRatingsCSV(
  records: VenueRatingRecord[],
  defaultVenueName?: string | DownloadRatingsOptions,
): string {
  const resolvedVenueName =
    typeof defaultVenueName === "object" && defaultVenueName !== null
      ? defaultVenueName.venueName || defaultVenueName.name
      : typeof defaultVenueName === "string"
      ? defaultVenueName
      : undefined;

  const builder = new CsvBuilder<VenueRatingRecord>({ lineDelimiter: "\r\n" });

  builder.setColumns([
    {
      header: "Date",
      accessor: (r) => formatCSVDate(r.createdAt || r.date),
    },
    {
      header: "Venue Name",
      accessor: (r) => r.venueName || resolvedVenueName || "Workspace",
    },
    {
      header: "User",
      accessor: (r) => formatCSVUser(r.user),
    },
    {
      header: "WiFi Quality",
      accessor: (r) => r.wifiQuality ?? "N/A",
    },
    {
      header: "Noise Level",
      accessor: (r) => r.noiseLevel || "N/A",
    },
    {
      header: "Outlets",
      accessor: (r) =>
        r.hasOutlets === true || r.hasOutlets === "true" ? "Yes" : "No",
    },
    {
      header: "Review Text",
      accessor: (r) => r.comment || r.reviewText || "",
    },
  ]);

  if (Array.isArray(records)) {
    builder.addRows(records);
  }
  return builder.build();
}

export const exportRatingsToCSV = generateRatingsCSV;

export function downloadRatingsCSV(
  records: VenueRatingRecord[],
  defaultVenueName?: string | DownloadRatingsOptions,
  filename?: string,
): Blob {
  const resolvedVenueName =
    typeof defaultVenueName === "object" && defaultVenueName !== null
      ? defaultVenueName.venueName || defaultVenueName.name
      : typeof defaultVenueName === "string"
      ? defaultVenueName
      : undefined;

  const resolvedFilename =
    typeof defaultVenueName === "object" && defaultVenueName !== null
      ? filename || defaultVenueName.filename
      : filename;

  const csvContent = generateRatingsCSV(records, resolvedVenueName);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const safeVenueName =
    resolvedVenueName && typeof resolvedVenueName === "string"
      ? resolvedVenueName.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      : "venue";
  const today = new Date().toISOString().slice(0, 10);
  const downloadFileName =
    resolvedFilename || `${safeVenueName}-ratings-${today}.csv`;

  triggerBrowserDownload(blob, downloadFileName);
  return blob;
}
