/**
 * Venue Audit Log Exporter (CSV & PDF).
 *
 * Provides streaming RFC-4180 compliant CSV exports and PDF reports
 * for monthly check-in history, noise telemetry, and desk utilization
 * for venue owners and administrators.
 */

import { prisma } from "@/lib/prisma";
import {
  PdfDocumentBuilder,
  drawSafeText,
  safeText,
  safeWidthOfTextAtSize,
} from "./pdfBuilder";
import { rgb } from "pdf-lib";

export const AUDIT_EXPORT_COLUMNS = [
  "Timestamp",
  "User ID",
  "Seat Label",
  "Check-in Duration",
  "Average Decibels",
] as const;

export type AuditExportColumn = (typeof AUDIT_EXPORT_COLUMNS)[number];

export interface VenueAuditExportRow {
  timestamp: string | Date;
  userId: string;
  seatLabel?: string | null;
  checkInDuration?: number | string | null;
  averageDecibels?: number | string | null;
}

export interface VenueAuditQueryOptions {
  month?: string; // e.g. "2026-11" or "2026-11-01"
  startDate?: Date | string;
  endDate?: Date | string;
  limit?: number;
}

export interface VenueAuditPdfOptions {
  venueName?: string;
  venueId?: string;
  month?: string;
  title?: string;
}

/**
 * Escapes a cell value according to RFC 4180 specifications with formula injection protection:
 * - If value is null or undefined, returns empty string.
 * - Handles Date, boolean, number, string, and unknown objects.
 * - Formula injection protection: Fields starting with =, +, -, @, |, \t, \r are prepended
 *   with a single quote (') to prevent execution when opened in Excel/Spreadsheets.
 * - RFC 4180: Fields containing commas (,), double quotes ("), line feeds (\n), or carriage returns (\r)
 *   MUST be enclosed in double quotes. Internal double quotes (") MUST be escaped by doubling them ("").
 */
export function escapeAuditCsvField(
  val: unknown,
  sanitizeFormulas: boolean = true,
): string {
  if (val === null || val === undefined) {
    return "";
  }

  // Handle finite JavaScript numbers directly
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "";
    return String(val);
  }

  // Handle boolean values
  if (typeof val === "boolean") {
    return String(val);
  }

  let str: string;
  if (val instanceof Date) {
    str = isNaN(val.getTime()) ? "" : val.toISOString();
  } else if (Array.isArray(val)) {
    str = val.join("; ");
  } else if (typeof val === "object") {
    str = JSON.stringify(val);
  } else {
    str = String(val).replace(/\0/g, "");
  }

  // If pure signed decimal/integer number, return as-is
  if (/^-?\d+(\.\d+)?$/.test(str.trim())) {
    return str.trim();
  }

  // Formula injection sanitization: Prepend single quote (') if value starts with formula trigger (=, +, -, @, |, \t, \r)
  // Spreadsheet engines trim leading whitespace before formula evaluation, so test both raw and trimmed string
  if (
    sanitizeFormulas &&
    (/^[=+\-@|\t\r]/.test(str) || /^[=+\-@|]/.test(str.trimStart()))
  ) {
    if (!str.startsWith("'")) {
      str = "'" + str;
    }
  }

  // RFC 4180 Rule 6 & 7: Enclose in double quotes if string contains comma, double quote, LF, or CR.
  // Internal double quotes MUST be escaped as double double-quotes ("").
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
 * Format a timestamp value into standard ISO 8601 string.
 */
export function formatAuditTimestamp(
  val: string | Date | null | undefined,
): string {
  if (!val) return "";
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? "" : val.toISOString();
  }
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? String(val) : parsed.toISOString();
}

/**
 * Format seat label with fallback for open hot desks.
 */
export function formatSeatLabel(val: string | null | undefined): string {
  if (val === null || val === undefined) return "Hot Desk";
  const trimmed = String(val).trim();
  return trimmed.length > 0 ? trimmed : "Hot Desk";
}

/**
 * Format check-in duration into human-readable string (e.g. "120 mins").
 */
export function formatCheckInDuration(
  val: number | string | null | undefined,
): string {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 0) return "0 mins";
    return `${Math.round(val)} mins`;
  }
  const str = String(val).trim();
  if (!str) return "N/A";
  if (/^\d+(\.\d+)?$/.test(str)) {
    return `${Math.round(Number(str))} mins`;
  }
  return str;
}

/**
 * Format average decibels with fallback.
 */
export function formatAverageDecibels(
  val: number | string | null | undefined,
): string {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "N/A";
    return val.toFixed(1);
  }
  const str = String(val).trim();
  if (!str) return "N/A";
  const num = Number(str);
  if (Number.isFinite(num)) {
    return num.toFixed(1);
  }
  return str;
}

/**
 * Formats a single audit record into an RFC 4180 CSV line ending with CRLF.
 */
export function formatAuditCsvRow(row: VenueAuditExportRow): string {
  const fields = [
    escapeAuditCsvField(formatAuditTimestamp(row.timestamp)),
    escapeAuditCsvField(row.userId ?? ""),
    escapeAuditCsvField(formatSeatLabel(row.seatLabel)),
    escapeAuditCsvField(formatCheckInDuration(row.checkInDuration)),
    escapeAuditCsvField(formatAverageDecibels(row.averageDecibels)),
  ];
  return fields.join(",") + "\r\n";
}

/**
 * Parses query options into a normalized Date range.
 */
export function parseDateRange(options?: VenueAuditQueryOptions): {
  start?: Date;
  end?: Date;
} {
  if (!options) return {};

  if (options.startDate || options.endDate) {
    const start = options.startDate ? new Date(options.startDate) : undefined;
    const end = options.endDate ? new Date(options.endDate) : undefined;
    return {
      start: start && !isNaN(start.getTime()) ? start : undefined,
      end: end && !isNaN(end.getTime()) ? end : undefined,
    };
  }

  if (options.month) {
    const match = options.month.match(/^(\d{4})-(\d{1,2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const monthIdx = parseInt(match[2], 10) - 1;
      const start = new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, monthIdx + 1, 1, 0, 0, 0, 0));
      return { start, end };
    }
  }

  return {};
}

/**
 * Fetches audit export rows for a venue from Prisma.
 */
export async function fetchVenueAuditRows(
  venueId: string,
  options: VenueAuditQueryOptions = {},
): Promise<VenueAuditExportRow[]> {
  const { start, end } = parseDateRange(options);

  const dateFilter =
    start || end
      ? {
          ...(start ? { gte: start } : {}),
          ...(end ? { lt: end } : {}),
        }
      : undefined;

  // 1. Fetch venue check-ins
  const checkIns = await prisma.checkIn.findMany({
    where: {
      venueId,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 5000,
  });

  // 2. Fetch venue bookings (for seat allocations and historical duration)
  const bookings = await prisma.booking.findMany({
    where: {
      venueId,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      seat: true,
    },
    take: options.limit ?? 5000,
  });

  // 3. Fetch latest or average noise telemetry release for the venue
  const noiseRelease = await prisma.noiseTelemetryRelease.findFirst({
    where: { venueId },
    orderBy: { updatedAt: "desc" },
  });

  const venueAvgDecibels = noiseRelease?.avgDecibels ?? null;

  // Create a lookup of seat numbers from bookings by userId
  const userSeatMap = new Map<string, string>();
  for (const b of bookings) {
    if (b.seatNumber || b.seat?.seatNumber) {
      userSeatMap.set(b.userId, b.seatNumber || b.seat?.seatNumber || "");
    }
  }

  const rows: VenueAuditExportRow[] = [];

  // Map check-ins to rows
  for (const ci of checkIns) {
    const durationMs = ci.expiresAt.getTime() - ci.createdAt.getTime();
    const durationMins = Math.max(0, Math.round(durationMs / 60000));
    const seatLabel = userSeatMap.get(ci.userId) || "Hot Desk";

    rows.push({
      timestamp: ci.createdAt,
      userId: ci.userId,
      seatLabel,
      checkInDuration: durationMins,
      averageDecibels: venueAvgDecibels,
    });
  }

  // If check-ins are fewer than bookings, also append bookings that aren't already represented
  const existingUserTimestamps = new Set(
    rows.map((r) => `${r.userId}_${new Date(r.timestamp).toDateString()}`),
  );

  for (const b of bookings) {
    const key = `${b.userId}_${new Date(b.createdAt).toDateString()}`;
    if (!existingUserTimestamps.has(key)) {
      existingUserTimestamps.add(key);
      const seatLabel =
        b.seatNumber ||
        b.seat?.seatNumber ||
        b.seat?.zoneName ||
        "Reserved Desk";
      rows.push({
        timestamp: b.createdAt,
        userId: b.userId,
        seatLabel,
        checkInDuration: b.duration ?? 60,
        averageDecibels: venueAvgDecibels,
      });
    }
  }

  // Sort descending by timestamp
  rows.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return rows;
}

/**
 * Creates a standard Web ReadableStream of UTF-8 CSV chunks conforming to RFC 4180.
 *
 * Supports large datasets with O(1) streaming memory footprint.
 */
export function createVenueAuditCsvStream(
  rowsOrGenerator:
    | AsyncIterable<VenueAuditExportRow>
    | Iterable<VenueAuditExportRow>
    | AsyncIterable<VenueAuditExportRow[]>
    | Iterable<VenueAuditExportRow[]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let headerSent = false;

  // Normalize input into an async generator yielding individual rows
  async function* toRowGenerator(): AsyncGenerator<
    VenueAuditExportRow,
    void,
    unknown
  > {
    for await (const chunk of rowsOrGenerator as any) {
      if (Array.isArray(chunk)) {
        for (const row of chunk) {
          yield row;
        }
      } else {
        yield chunk as VenueAuditExportRow;
      }
    }
  }

  const iterator = toRowGenerator();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          const header = AUDIT_EXPORT_COLUMNS.join(",") + "\r\n";
          controller.enqueue(encoder.encode(header));
        }

        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }

        const line = formatAuditCsvRow(value);
        controller.enqueue(encoder.encode(line));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      if (typeof iterator.return === "function") {
        await iterator.return();
      }
    },
  });
}

/**
 * Generates in-memory CSV string for venue audit logs.
 */
export function generateVenueAuditCSV(rows: VenueAuditExportRow[]): string {
  const header = AUDIT_EXPORT_COLUMNS.join(",") + "\r\n";
  const body = rows.map((r) => formatAuditCsvRow(r)).join("");
  return header + body;
}

/**
 * Generates a styled PDF report for venue audit logs.
 */
export async function generateVenueAuditPDF(
  rows: VenueAuditExportRow[],
  options: VenueAuditPdfOptions = {},
): Promise<Uint8Array> {
  const venueName = options.venueName || "Venue Audit Report";
  const monthLabel = options.month
    ? `Month: ${options.month}`
    : "Monthly Report";

  const builder = await PdfDocumentBuilder.create({
    accentColor: { r: 0.15, g: 0.35, b: 0.75 },
    margin: 40,
    title: options.title || `${venueName} - Audit & Utilization Report`,
  });

  const { boldFont, font } = builder;
  const margin = builder.margin;
  const contentWidth = builder.pageWidth - margin * 2;

  // Header Title
  builder.drawHeading("WorkSphere Venue Audit Report", monthLabel, {
    titleSize: 18,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Metadata block
  builder.ensureSpace(50);
  builder.drawText(`Venue: ${safeText(venueName)}`, {
    size: 11,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  });
  if (options.venueId) {
    builder.drawText(`Venue ID: ${safeText(options.venueId)}`, {
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
  builder.drawText(
    `Exported At: ${new Date().toUTCString()} | Records: ${rows.length}`,
    {
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    },
  );

  builder.drawDivider();

  // Table Configuration
  const colWidths = {
    timestamp: 140,
    userId: 105,
    seatLabel: 90,
    duration: 90,
    decibels: 90,
  };

  const drawTableHeader = () => {
    const y = builder.currentY;
    builder.currentPage.drawRectangle({
      x: margin,
      y: y - 16,
      width: contentWidth,
      height: 20,
      color: rgb(0.93, 0.95, 0.98),
    });

    let currentX = margin + 6;
    const headerCols: { text: string; width: number }[] = [
      { text: "Timestamp", width: colWidths.timestamp },
      { text: "User ID", width: colWidths.userId },
      { text: "Seat Label", width: colWidths.seatLabel },
      { text: "Duration", width: colWidths.duration },
      { text: "Avg Decibels", width: colWidths.decibels },
    ];

    for (const col of headerCols) {
      drawSafeText(builder.currentPage, col.text, {
        x: currentX,
        y: y - 12,
        size: 9,
        font: boldFont,
        color: rgb(0.15, 0.25, 0.45),
      });
      currentX += col.width;
    }

    builder.currentY = y - 24;
  };

  drawTableHeader();

  if (rows.length === 0) {
    builder.ensureSpace(30);
    builder.drawText("No audit records found for this venue and period.", {
      size: 10,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  } else {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (builder.ensureSpace(24)) {
        drawTableHeader();
      }

      const y = builder.currentY;

      // Alternating row background
      if (i % 2 === 1) {
        builder.currentPage.drawRectangle({
          x: margin,
          y: y - 12,
          width: contentWidth,
          height: 16,
          color: rgb(0.98, 0.98, 0.99),
        });
      }

      let currentX = margin + 6;
      const cells: { text: string; width: number }[] = [
        {
          text: formatAuditTimestamp(row.timestamp)
            .slice(0, 19)
            .replace("T", " "),
          width: colWidths.timestamp,
        },
        { text: row.userId ?? "", width: colWidths.userId },
        { text: formatSeatLabel(row.seatLabel), width: colWidths.seatLabel },
        {
          text: formatCheckInDuration(row.checkInDuration),
          width: colWidths.duration,
        },
        {
          text: formatAverageDecibels(row.averageDecibels),
          width: colWidths.decibels,
        },
      ];

      for (const cell of cells) {
        // Truncate to fit column width
        let cellText = safeText(cell.text);
        while (
          cellText.length > 4 &&
          safeWidthOfTextAtSize(cellText, font, 8) > cell.width - 8
        ) {
          cellText = cellText.slice(0, -4) + "...";
        }

        drawSafeText(builder.currentPage, cellText, {
          x: currentX,
          y: y - 9,
          size: 8,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
        currentX += cell.width;
      }

      builder.currentY = y - 18;
    }
  }

  // Footer page numbers
  builder.addPageNumbers();

  return await builder.build();
}
