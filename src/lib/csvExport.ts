/**
 * csvExport.ts
 *
 * RFC-4180 compliant CSV export utilities for venue analytics (#3427).
 */

export interface AnalyticsMetric {
  timestamp: string | Date;
  visitorCount: number;
  checkIns: number;
  meanDecibelLevel: number;
}

/**
 * Escapes a single cell value according to RFC-4180 rules:
 * - If value is null/undefined, returns empty string.
 * - If value contains double quotes ("), commas (,), or newlines (\n, \r),
 *   wrap the field in double quotes and escape internal quotes by doubling them ("").
 */
export function escapeCSVField(
  val: string | number | boolean | Date | null | undefined,
): string {
  if (val === null || val === undefined) {
    return "";
  }
  let str: string;
  if (val instanceof Date) {
    str = val.toISOString();
  } else {
    str = String(val);
  }
  if (
    str.includes('"') ||
    str.includes(",") ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats an array of AnalyticsMetric objects into an RFC-4180 compliant CSV string.
 * Header columns: Timestamp, Visitor Count, Check Ins, Mean Decibel Level
 */
export function exportAnalyticsToCSV(data: AnalyticsMetric[]): string {
  const headers = [
    "Timestamp",
    "Visitor Count",
    "Check Ins",
    "Mean Decibel Level",
  ];
  const rows: string[] = [headers.join(",")];

  if (Array.isArray(data)) {
    for (const metric of data) {
      const ts =
        metric.timestamp instanceof Date
          ? metric.timestamp.toISOString()
          : (metric.timestamp ?? "");
      const visitorCount = metric.visitorCount ?? 0;
      const checkIns = metric.checkIns ?? 0;
      const meanDecibelLevel = metric.meanDecibelLevel ?? 0;

      const row = [
        escapeCSVField(ts),
        escapeCSVField(visitorCount),
        escapeCSVField(checkIns),
        escapeCSVField(meanDecibelLevel),
      ];

      rows.push(row.join(","));
    }
  }

  return rows.join("\r\n");
}

/**
 * Generates CSV blob and triggers a browser download.
 * Filename format: worksphere-analytics-YYYY-MM-DD.csv
 */
export function downloadAnalyticsCSV(
  data: AnalyticsMetric[],
  filename?: string,
): Blob {
  const csvContent = exportAnalyticsToCSV(data);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const today = new Date().toISOString().slice(0, 10);
    const downloadFileName =
      filename || `worksphere-analytics-${today}.csv`;
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
