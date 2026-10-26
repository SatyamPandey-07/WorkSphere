/**
 * Admin Feedback Flags Exporter (CSV).
 *
 * Implements RFC-4180 compliant CSV export for flagged venue/review reports.
 */

import { CsvBuilder } from "../csvBuilder";

export interface FeedbackFlag {
  id: string;
  type: "VENUE" | "REVIEW";
  reason: string;
  status: string;
  createdAt: string | Date;
  reportedBy?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
  itemDetails?: {
    name?: string | null;
    comment?: string | null;
    venue?: { name?: string | null } | null;
  } | null;
}

export interface FeedbackExportOptions {
  filename?: string;
  lineDelimiter?: "\r\n" | "\n";
  includeBOM?: boolean;
}

function reporterName(flag?: FeedbackFlag | null): string {
  if (!flag || !flag.reportedBy) return "";
  return [flag.reportedBy.firstName, flag.reportedBy.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function formatFeedbackDate(createdAt: string | Date | null | undefined): string {
  if (createdAt == null) return "";
  if (createdAt instanceof Date) {
    return isNaN(createdAt.getTime()) ? "" : createdAt.toISOString();
  }
  return String(createdAt);
}

export function createFeedbackCsvBuilder(options?: {
  lineDelimiter?: "\r\n" | "\n";
  includeBOM?: boolean;
}): CsvBuilder<FeedbackFlag> {
  const builder = new CsvBuilder<FeedbackFlag>({
    lineDelimiter: options?.lineDelimiter ?? "\r\n",
    includeBOM: options?.includeBOM,
  });

  builder.setColumns([
    { header: "Type", accessor: (f) => f?.type ?? "" },
    { header: "Status", accessor: (f) => f?.status ?? "" },
    { header: "Reason", accessor: (f) => f?.reason ?? "" },
    {
      header: "Target",
      accessor: (f) =>
        f?.type === "VENUE"
          ? f?.itemDetails?.name ?? ""
          : f?.itemDetails?.comment ?? "",
    },
    {
      header: "Venue",
      accessor: (f) =>
        f?.type === "VENUE" ? "" : f?.itemDetails?.venue?.name ?? "",
    },
    { header: "Reported By", accessor: (f) => reporterName(f) },
    {
      header: "Reporter Email",
      accessor: (f) => f?.reportedBy?.email ?? "",
    },
    {
      header: "Date",
      accessor: (f) => formatFeedbackDate(f?.createdAt),
    },
  ]);

  return builder;
}

export function exportFeedbackToCSV(
  flags?: FeedbackFlag[] | null,
  options?: { lineDelimiter?: "\r\n" | "\n"; includeBOM?: boolean },
): string {
  const builder = createFeedbackCsvBuilder(options);
  if (Array.isArray(flags)) {
    builder.addRows(flags);
  }
  return builder.build();
}

export function downloadFeedbackCSV(
  flags?: FeedbackFlag[] | null,
  filenameOrOptions?: string | FeedbackExportOptions,
): Blob {
  const options: FeedbackExportOptions =
    typeof filenameOrOptions === "string"
      ? { filename: filenameOrOptions }
      : filenameOrOptions || {};

  const builder = createFeedbackCsvBuilder({
    lineDelimiter: options.lineDelimiter ?? "\r\n",
    includeBOM: options.includeBOM,
  });

  if (Array.isArray(flags)) {
    builder.addRows(flags);
  }

  const today = new Date().toISOString().slice(0, 10);
  const resolvedFilename =
    options.filename && typeof options.filename === "string" && options.filename.trim().length > 0
      ? options.filename.trim()
      : `worksphere-feedback-${today}.csv`;

  return builder.download(resolvedFilename);
}
