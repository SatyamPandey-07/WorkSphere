/**
 * RFC 4180 Compliant CSV Cell Escaping & Exporter Engine (#4377).
 *
 * Implements strict RFC 4180 specification rules for CSV field formatting:
 * 1. Fields containing commas (,), double quotes ("), line feeds (\n), or carriage returns (\r)
 *    MUST be enclosed in double quotes.
 * 2. Internal double quotes (") MUST be escaped by doubling them ("").
 * 3. Formula injection protection: Fields starting with =, +, -, @, \t, \r are prepended
 *    with a single quote (') to prevent execution when opened in Excel/Spreadsheets.
 * 4. Configurable line delimiters (\r\n vs \n) and UTF-8 Byte Order Mark (BOM \uFEFF).
 */

export interface RFC4180Options {
  /** Enables formula injection protection for spreadsheet software (default: true) */
  sanitizeFormulas?: boolean;
  /** Line delimiter for CSV rows (default: "\r\n") */
  lineDelimiter?: "\r\n" | "\n";
  /** Prepend UTF-8 BOM (\uFEFF) for Excel compatibility (default: false) */
  includeBOM?: boolean;
}

export interface VenueExportRow {
  id: string;
  name: string;
  address?: string | null;
  category?: string | null;
  hourlyRate?: number | null;
  noiseLevel?: string | null;
  description?: string | null;
  tags?: string[] | string | null;
  createdAt?: string | Date | null;
  [key: string]: unknown;
}

/**
 * Escapes a single CSV cell according to RFC 4180 specifications and formula injection rules.
 *
 * @param val Raw input value (string, number, boolean, Date, null, or undefined)
 * @param sanitizeFormulas Enables formula injection guard for leading =, +, -, @, \t, \r (default: true)
 * @returns RFC 4180 compliant escaped string cell
 */
export function escapeRFC4180Cell(
  val: unknown,
  sanitizeFormulas: boolean = true
): string {
  if (val === null || val === undefined) {
    return "";
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

  // Formula injection sanitization: Prepend single quote (') if value starts with formula trigger (=, +, -, @, |, \t, \r)
  // Spreadsheet engines trim leading whitespace before formula evaluation, so test both raw and trimmed string
  if (sanitizeFormulas && (/^[=+\-@|\t\r]/.test(str) || /^[=+\-@|]/.test(str.trimStart()))) {
    str = "'" + str;
  }

  // RFC 4180 Rule 6 & 7: Enclose in double quotes if string contains comma, double quote, LF, or CRLF.
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

export const sanitizeCsvCell = escapeRFC4180Cell;

/**
 * Builds a complete RFC 4180 compliant CSV document string from headers and data rows.
 *
 * @param headers Array of column header titles
 * @param rows Array of row objects or arrays
 * @param options RFC 4180 configuration options
 * @returns Full RFC 4180 formatted CSV string
 */
export function buildRFC4180CSV(
  headers: string[],
  rows: (Record<string, unknown> | unknown[])[],
  options: RFC4180Options = {}
): string {
  const sanitizeFormulas = options.sanitizeFormulas ?? true;
  const lineDelimiter = options.lineDelimiter ?? "\r\n";
  const includeBOM = options.includeBOM ?? false;

  const lines: string[] = [];

  // 1. Format and escape header row
  if (headers && headers.length > 0) {
    const escapedHeaders = headers.map((h) => escapeRFC4180Cell(h, sanitizeFormulas));
    lines.push(escapedHeaders.join(","));
  }

  // 2. Format and escape data rows
  for (const row of rows) {
    if (!row) continue;
    let cells: string[];

    if (Array.isArray(row)) {
      cells = row.map((cell) => escapeRFC4180Cell(cell, sanitizeFormulas));
    } else {
      cells = headers.map((headerKey) => {
        const val = row[headerKey];
        return escapeRFC4180Cell(val, sanitizeFormulas);
      });
    }

    lines.push(cells.join(","));
  }

  const csvContent = lines.join(lineDelimiter);
  return includeBOM ? "\uFEFF" + csvContent : csvContent;
}

/**
 * Exports an array of VenueExportRow objects into an RFC 4180 formatted CSV string.
 * Handles venue names, addresses, and descriptions containing commas, quotes, and newlines.
 */
export function exportVenueDataToCSV(
  venues: VenueExportRow[],
  options: RFC4180Options = {}
): string {
  const headers = [
    "id",
    "name",
    "address",
    "category",
    "hourlyRate",
    "noiseLevel",
    "description",
    "tags",
    "createdAt",
  ];

  return buildRFC4180CSV(headers, venues, options);
}
