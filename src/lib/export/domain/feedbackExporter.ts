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

function reporterName(flag: FeedbackFlag): string {
  return [flag.reportedBy?.firstName, flag.reportedBy?.lastName]
    .filter(Boolean)
    .join(" ");
}

export function exportFeedbackToCSV(flags: FeedbackFlag[]): string {
  const builder = new CsvBuilder<FeedbackFlag>({ lineDelimiter: "\r\n" });

  builder.setColumns([
    { header: "Type", accessor: (f) => f.type },
    { header: "Status", accessor: (f) => f.status },
    { header: "Reason", accessor: (f) => f.reason },
    {
      header: "Target",
      accessor: (f) =>
        f.type === "VENUE"
          ? f.itemDetails?.name ?? ""
          : f.itemDetails?.comment ?? "",
    },
    {
      header: "Venue",
      accessor: (f) =>
        f.type === "VENUE" ? "" : f.itemDetails?.venue?.name ?? "",
    },
    { header: "Reported By", accessor: (f) => reporterName(f) },
    {
      header: "Reporter Email",
      accessor: (f) => f.reportedBy?.email ?? "",
    },
    {
      header: "Date",
      accessor: (f) =>
        f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt,
    },
  ]);

  builder.addRows(flags);
  return builder.build();
}

export function downloadFeedbackCSV(
  flags: FeedbackFlag[],
  filename?: string,
): Blob {
  const builder = new CsvBuilder<FeedbackFlag>({ lineDelimiter: "\r\n" });
  builder.setColumns([
    { header: "Type", accessor: (f) => f.type },
    { header: "Status", accessor: (f) => f.status },
    { header: "Reason", accessor: (f) => f.reason },
    {
      header: "Target",
      accessor: (f) =>
        f.type === "VENUE"
          ? f.itemDetails?.name ?? ""
          : f.itemDetails?.comment ?? "",
    },
    {
      header: "Venue",
      accessor: (f) =>
        f.type === "VENUE" ? "" : f.itemDetails?.venue?.name ?? "",
    },
    { header: "Reported By", accessor: (f) => reporterName(f) },
    {
      header: "Reporter Email",
      accessor: (f) => f.reportedBy?.email ?? "",
    },
    {
      header: "Date",
      accessor: (f) =>
        f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt,
    },
  ]);
  builder.addRows(flags);

  const today = new Date().toISOString().slice(0, 10);
  const downloadFileName = filename || `worksphere-feedback-${today}.csv`;
  return builder.download(downloadFileName);
}
