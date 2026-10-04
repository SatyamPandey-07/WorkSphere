/**
 * venueRatingsCsvExport.ts
 *
 * Client-side CSV generation and download utility for venue ratings and feedback (#3345).
 */

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

/**
 * Escapes a cell value according to RFC 4180 CSV specifications:
 * - If the value contains quotes, commas, or newlines, escape quotes by doubling them ("")
 *   and wrap the entire field in double quotes.
 */
export function escapeCSV(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a Date or date string into YYYY-MM-DD format.
 */
export function formatCSVDate(dateVal: string | Date | null | undefined): string {
  if (!dateVal) return "N/A";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(dateVal);
  }
}

/**
 * Formats user info into a clean display name.
 */
export function formatCSVUser(
  user: VenueRatingRecord["user"],
): string {
  if (!user) return "Anonymous";
  if (typeof user === "string") return user.trim() || "Anonymous";
  const fullName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fullName) return fullName;
  if (user.email) return user.email;
  return "Anonymous";
}

/**
 * Formats an array of VenueRatingRecord items into a valid RFC 4180 CSV string.
 * Columns: Date, Venue Name, User, WiFi Quality, Noise Level, Outlets, Review Text
 */
export function generateRatingsCSV(
  records: VenueRatingRecord[],
  defaultVenueName?: string,
): string {
  const headers = [
    "Date",
    "Venue Name",
    "User",
    "WiFi Quality",
    "Noise Level",
    "Outlets",
    "Review Text",
  ];

  const rows: string[] = [headers.join(",")];

  for (const record of records) {
    const dateStr = formatCSVDate(record.createdAt ?? record.date);
    const venueName = record.venueName || defaultVenueName || "Venue";
    const userName = formatCSVUser(record.user);
    const wifi = record.wifiQuality != null ? String(record.wifiQuality) : "N/A";
    const noise = record.noiseLevel ? String(record.noiseLevel) : "N/A";
    const outlets =
      record.hasOutlets === true
        ? "Yes"
        : record.hasOutlets === false
          ? "No"
          : String(record.hasOutlets ?? "N/A");
    const reviewText = record.reviewText ?? record.comment ?? "";

    const row = [
      escapeCSV(dateStr),
      escapeCSV(venueName),
      escapeCSV(userName),
      escapeCSV(wifi),
      escapeCSV(noise),
      escapeCSV(outlets),
      escapeCSV(reviewText),
    ];

    rows.push(row.join(","));
  }

  return rows.join("\r\n");
}

export interface DownloadRatingsCSVOptions {
  venueName?: string;
  filename?: string;
}

/**
 * Generates and triggers a client-side download of ratings as a CSV Blob.
 */
export function downloadRatingsCSV(
  records: VenueRatingRecord[],
  options: DownloadRatingsCSVOptions = {},
): Blob {
  const csvContent = generateRatingsCSV(records, options.venueName);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;

    const baseName = options.venueName
      ? options.venueName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : "venue";
    const dateStamp = new Date().toISOString().slice(0, 10);
    anchor.download =
      options.filename || `${baseName}-ratings-history-${dateStamp}.csv`;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return blob;
}
