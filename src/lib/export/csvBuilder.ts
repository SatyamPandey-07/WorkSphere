/**
 * Generic Base CSV Builder with RFC-4180 compliance,
 * formula injection sanitization, and browser download triggers.
 */

import { CsvBuilderOptions, CsvColumn } from "./types";

/**
 * Escapes a cell value according to RFC-4180 rules with formula injection protection:
 * - If value is null/undefined, returns empty string.
 * - If value starts with formula triggers (=, +, -, @, \t, \r), prepends a single quote.
 * - If value contains quotes, commas, or newlines, escapes quotes by doubling ("") and wraps in quotes.
 */
export function escapeCSVField(
  val: string | number | boolean | Date | null | undefined,
  sanitizeFormulas = true,
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

  // Formula injection sanitization (leading whitespace is trimmed by
  // spreadsheet apps before evaluation, so test the trimmed value)
  if (sanitizeFormulas && /^[=+\-@\t\r]/.test(str.trimStart())) {
    str = "'" + str;
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

export const escapeCSV = escapeCSVField;

/**
 * Helper to trigger browser download for any blob.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export class CsvBuilder<TRow = any> {
  private columns: CsvColumn<TRow>[] = [];
  private lines: string[] = [];
  private options: Required<CsvBuilderOptions>;

  constructor(options: CsvBuilderOptions = {}) {
    this.options = {
      lineDelimiter: options.lineDelimiter ?? "\r\n",
      includeBOM: options.includeBOM ?? false,
      sanitizeFormulas: options.sanitizeFormulas ?? true,
    };
  }

  public addColumn(
    header: string,
    accessor: keyof TRow | ((row: TRow) => any),
  ): this {
    this.columns.push({ header, accessor });
    return this;
  }

  public setColumns(columns: CsvColumn<TRow>[]): this {
    this.columns = columns;
    return this;
  }

  public addRow(item: TRow): this {
    const cells = this.columns.map((col) => {
      const val =
        typeof col.accessor === "function"
          ? col.accessor(item)
          : item[col.accessor];
      return escapeCSVField(val, this.options.sanitizeFormulas);
    });
    this.lines.push(cells.join(","));
    return this;
  }

  public addRows(items: readonly TRow[]): this {
    for (const item of items) {
      this.addRow(item);
    }
    return this;
  }

  public addSectionHeader(title: string): this {
    this.lines.push(`=== ${title} ===`);
    return this;
  }

  public addRawLine(line: string): this {
    this.lines.push(line);
    return this;
  }

  public addBlankLine(): this {
    this.lines.push("");
    return this;
  }

  public build(): string {
    const output: string[] = [];

    if (this.columns.length > 0) {
      const headerRow = this.columns
        .map((c) => escapeCSVField(c.header, this.options.sanitizeFormulas))
        .join(",");
      output.push(headerRow);
    }

    output.push(...this.lines);

    const result = output.join(this.options.lineDelimiter);
    return this.options.includeBOM ? "\uFEFF" + result : result;
  }

  public toBlob(mimeType = "text/csv;charset=utf-8;"): Blob {
    const content = this.build();
    return new Blob([content], { type: mimeType });
  }

  public download(filename: string): Blob {
    const blob = this.toBlob();
    triggerBrowserDownload(blob, filename);
    return blob;
  }
}
