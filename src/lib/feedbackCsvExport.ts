import { escapeCSVField } from "./csvExport";

export interface FeedbackFlag {
  id: string;
  type: "VENUE" | "REVIEW";
  reason: string;
  status: string;
  createdAt: string | Date;
  reportedBy: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
  itemDetails?: {
    name?: string | null;
    comment?: string | null;
    venue?: { name?: string | null } | null;
  } | null;
}

const HEADERS = [
  "Type",
  "Status",
  "Reason",
  "Target",
  "Venue",
  "Reported By",
  "Reporter Email",
  "Date",
];

function reporterName(flag: FeedbackFlag): string {
  return [flag.reportedBy?.firstName, flag.reportedBy?.lastName]
    .filter(Boolean)
    .join(" ");
}

/**
 * Serializes admin feedback flags into an RFC-4180 CSV document. Every cell goes
 * through escapeCSVField, so commas, double quotes and newlines inside a user
 * supplied reason or review comment are quoted and escaped rather than breaking
 * the row.
 */
export function exportFeedbackToCSV(flags: FeedbackFlag[]): string {
  const rows: string[] = [HEADERS.join(",")];

  for (const flag of flags) {
    const isVenue = flag.type === "VENUE";
    const target = isVenue
      ? (flag.itemDetails?.name ?? "")
      : (flag.itemDetails?.comment ?? "");
    const venue = isVenue ? "" : (flag.itemDetails?.venue?.name ?? "");
    const date =
      flag.createdAt instanceof Date
        ? flag.createdAt.toISOString()
        : flag.createdAt;

    rows.push(
      [
        escapeCSVField(flag.type),
        escapeCSVField(flag.status),
        escapeCSVField(flag.reason),
        escapeCSVField(target),
        escapeCSVField(venue),
        escapeCSVField(reporterName(flag)),
        escapeCSVField(flag.reportedBy?.email ?? ""),
        escapeCSVField(date),
      ].join(","),
    );
  }

  return rows.join("\r\n");
}

/**
 * Builds the CSV and triggers a browser download. Default filename follows the
 * format the issue asks for: worksphere-feedback-YYYY-MM-DD.csv.
 */
export function downloadFeedbackCSV(
  flags: FeedbackFlag[],
  filename?: string,
): Blob {
  const csv = exportFeedbackToCSV(flags);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const today = new Date().toISOString().slice(0, 10);
    const downloadFileName = filename || `worksphere-feedback-${today}.csv`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return blob;
}
