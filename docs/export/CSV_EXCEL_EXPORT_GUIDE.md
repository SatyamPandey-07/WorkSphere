# CSV and Excel Export Architecture — Developer Guide

This guide provides a comprehensive developer reference for WorkSphere's client-side CSV and Excel data export architecture. It details the underlying builder classes, column configurations, RFC-4180 escaping, spreadsheet formula injection protections, browser download mechanics, large-dataset handling strategies, and step-by-step instructions for implementing domain-specific exporters.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Export Architecture at a Glance](#2-export-architecture-at-a-glance)
3. [Repository Structure](#3-repository-structure)
4. [CSV Export Architecture](#4-csv-export-architecture)
5. [RFC-4180 Escaping](#5-rfc-4180-escaping)
6. [Spreadsheet Formula Injection Protection](#6-spreadsheet-formula-injection-protection)
7. [Creating a Typed CSV Exporter](#7-creating-a-typed-csv-exporter)
8. [Excel XML Export Architecture](#8-excel-xml-export-architecture)
9. [Creating an Excel Exporter](#9-creating-an-excel-exporter)
10. [Browser Download Utilities](#10-browser-download-utilities)
11. [Large Dataset Handling and Performance](#11-large-dataset-handling-and-performance)
12. [Testing Export Functionality](#12-testing-export-functionality)
13. [Security Best Practices](#13-security-best-practices)
14. [Troubleshooting](#14-troubleshooting)
15. [Extending the Export System](#15-extending-the-export-system)
16. [Related Documentation](#16-related-documentation)

---

## 1. Overview

WorkSphere provides lightweight, client-side export capabilities enabling digital nomads, venue managers, and administrators to export booking records, venue ratings, moderation feedback, financial calculations, and system vitals.

Key design principles of the export system include:

- **Zero Heavy Runtime Dependencies:** CSV generation uses zero external libraries, and Excel generation produces Microsoft SpreadsheetML 2003 XML workbooks without requiring heavy libraries such as `xlsx` (SheetJS) or `exceljs`.
- **Type Safety:** Column definitions use TypeScript generics (`CsvColumn<TRow>` and `ExcelColumn<TRow>`) allowing compile-time validation of property keys or accessor functions.
- **Built-in Security:** Automatic field sanitization protects downstream spreadsheet users against formula injection (CSV/Excel Formula Injection, also known as CWE-1236) while maintaining strict RFC-4180 delimiter escaping.
- **Client & Server Isolation:** Browser DOM interaction is isolated to `triggerBrowserDownload`, safely guarded against execution failures during Server-Side Rendering (SSR) in Next.js.

---

## 2. Export Architecture at a Glance

The export pipeline follows a modular sequence from raw domain data through typed column transformations, character-level sanitizers, and document string assembling, concluding with Blob creation and browser download triggering.

```mermaid
flowchart TD
    subgraph DataLayer ["1. Domain Model"]
        DomainData["Domain Entities<br/>(e.g., VenueFeedback, BookingItem)"]
    end

    subgraph ColumnLayer ["2. Typed Column Definitions"]
        CsvCols["CsvColumn&lt;TRow&gt;[]<br/>header + accessor"]
        XlsCols["ExcelColumn&lt;TRow&gt;[]<br/>header + accessor + type + width"]
    end

    subgraph BuilderLayer ["3. Builder Engines"]
        CsvBld["CsvBuilder&lt;TRow&gt;<br/>(src/lib/export/csvBuilder.ts)"]
        ExcelBld["ExcelXmlBuilder&lt;TRow&gt;<br/>(src/lib/export/excelBuilder.ts)"]
    end

    subgraph SecurityLayer ["4. Escaping & Formula Sanitization"]
        EscapeCSV["escapeCSVField()<br/>- Null byte removal<br/>- Formula quote prefix ('=, '+, '-, '@, '|, '\\t, '\\r)<br/>- RFC-4180 quote wrapping (\"\"\")"]
        EscapeXML["escapeXml() & sanitizeExcelFormula()<br/>- XML entity replacement (&amp;, &lt;, &gt;, &quot;, &apos;)<br/>- Formula quote prefix ('=, '+, '-, '@, '|, '\\t, '\\r)"]
    end

    subgraph OutputLayer ["5. Document Assembly"]
        CsvString["CSV Text Output<br/>(with optional UTF-8 BOM \uFEFF)"]
        XmlString["SpreadsheetML 2003 XML<br/>(with Workbook, Styles, & Table)"]
    end

    subgraph DownloadLayer ["6. Browser Delivery"]
        BlobGen["new Blob([content], { type: mimeType })"]
        BrowserTrigger["triggerBrowserDownload(blob, filename)<br/>- URL.createObjectURL()<br/>- &lt;a download&gt; click simulation<br/>- URL.revokeObjectURL()"]
    end

    DomainData --> CsvCols & XlsCols
    CsvCols --> CsvBld
    XlsCols --> ExcelBld
    CsvBld --> EscapeCSV --> CsvString
    ExcelBld --> EscapeXML --> XmlString
    CsvString & XmlString --> BlobGen --> BrowserTrigger
```

---

## 3. Repository Structure

Export components are located in `src/lib/export/` with corresponding tests in `src/__tests__/lib/`.

```
src/lib/export/
├── types.ts                     # Core interfaces (CsvColumn, ExcelColumn, DomainExporter, etc.)
├── csvBuilder.ts                # CsvBuilder class, escapeCSVField, triggerBrowserDownload
├── csvExporter.ts               # RFC-4180 standalone functions (escapeRFC4180Cell, buildRFC4180CSV)
├── excelBuilder.ts              # ExcelXmlBuilder class, escapeXml, sanitizeExcelFormula
├── pdfBuilder.ts                # PdfDocumentBuilder abstraction for pdf-lib
├── index.ts                     # Central export barrel re-exporting builders and types
└── domain/                      # Domain-specific exporters
    ├── analyticsExporter.ts     # Workspace analytics and venue metric exports
    ├── bookingHistoryExporter.ts# Booking reservations (CSV & Excel XML)
    ├── feedbackExporter.ts      # Flagged feedback moderation exports (CSV)
    ├── venueRatingsExporter.ts  # Venue reviews and ratings exports (CSV)
    ├── taxExporter.ts           # Financial and tax ledger exports (CSV)
    ├── systemVitalsExporter.ts  # System health telemetry and host vitals (CSV)
    ├── geoExporter.ts           # GeoJSON and KML coordinate exports
    └── ...
```

---

## 4. CSV Export Architecture

The primary CSV export engine is implemented in `src/lib/export/csvBuilder.ts`.

### 4.1 `CsvColumn<TRow>` Interface

Column definitions are defined in `src/lib/export/types.ts`:

```typescript
export interface CsvColumn<T = any> {
  header: string;
  accessor: keyof T | ((row: T) => any);
}
```

The `accessor` supports either:

1. **A direct property key:** e.g., `accessor: "id"`
2. **A transformation function:** e.g., `accessor: (row) => row.venue?.name ?? "N/A"`

### 4.2 `CsvBuilderOptions` Interface

```typescript
export interface CsvBuilderOptions {
  lineDelimiter?: "\r\n" | "\n"; // Default: "\r\n"
  includeBOM?: boolean; // Default: false
  sanitizeFormulas?: boolean; // Default: true
}
```

- **`lineDelimiter`**: Specifies the end-of-line delimiter. Per RFC-4180 Section 2.1, standard CSV files must use CRLF (`\r\n`). Unix-style LF (`\n`) is also supported.
- **`includeBOM`**: Prepends the UTF-8 Byte Order Mark (`\uFEFF`). This instructs Microsoft Excel on Windows to open the CSV file in UTF-8 encoding rather than the local ANSI code page, preserving Unicode characters and accented text.
- **`sanitizeFormulas`**: Activates spreadsheet formula injection guards (default: `true`).

### 4.3 Public API of `CsvBuilder<TRow>`

| Method             | Signature                                                              | Description                                                                                                        |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `addColumn`        | `(header: string, accessor: keyof TRow \| ((row: TRow) => any)): this` | Appends a single typed column definition.                                                                          |
| `setColumns`       | `(columns: CsvColumn<TRow>[]): this`                                   | Replaces all column definitions.                                                                                   |
| `addRow`           | `(item: TRow): this`                                                   | Resolves column accessors, sanitizes fields, and adds a joined comma-separated row.                                |
| `addRows`          | `(items: readonly TRow[]): this`                                       | Iterates over items and adds each non-null row.                                                                    |
| `addSectionHeader` | `(title: string): this`                                                | Adds an unescaped section banner line: `=== {title} ===`.                                                          |
| `addRawLine`       | `(line: string): this`                                                 | Appends an arbitrary raw string directly to output lines.                                                          |
| `addBlankLine`     | `(): this`                                                             | Appends an empty line `""`.                                                                                        |
| `build`            | `(): string`                                                           | Generates the complete CSV string, joining header and data lines with `lineDelimiter` and applying BOM if enabled. |
| `toBlob`           | `(mimeType?: string): Blob`                                            | Compiles the CSV string into a `Blob` (default MIME: `"text/csv;charset=utf-8;"`).                                 |
| `download`         | `(filename: string): Blob`                                             | Calls `toBlob()` and triggers a browser download using `triggerBrowserDownload`.                                   |

---

## 5. RFC-4180 Escaping

WorkSphere implements RFC-4180 compliant field escaping in `escapeCSVField` (`csvBuilder.ts`) and `escapeRFC4180Cell` (`csvExporter.ts`).

### 5.1 Escaping Rules

According to RFC-4180:

1. **Empty / Null Values:** `null` and `undefined` are converted to empty strings `""`.
2. **Date Objects:** Valid `Date` instances are formatted as ISO 8601 strings via `.toISOString()`; invalid dates become `""`.
3. **Null Byte Stripping:** Null characters (`\0`) are stripped to prevent null-byte poisoning attacks.
4. **Delimiters Requiring Quoting:** Any field containing a comma (`,`), a double quote (`"`), a line feed (`\n`), or a carriage return (`\r`) must be enclosed in double quotes.
5. **Quote Doubling:** Any embedded double quote (`"`) inside the string must be escaped by doubling it (`""`).

### 5.2 Before and After Transformation Examples

| Input Value            | Escaped CSV Field          | Reason                                        |
| ---------------------- | -------------------------- | --------------------------------------------- |
| `Simple Value`         | `Simple Value`             | Plain text; no delimiters.                    |
| `Desk A, Floor 2`      | `"Desk A, Floor 2"`        | Contains comma; enclosed in double quotes.    |
| `The "Grand" Ballroom` | `"The ""Grand"" Ballroom"` | Contains quotes; quotes doubled and enclosed. |
| `"Fully Quoted"`       | `"""Fully Quoted"""`       | Embedded quotes doubled and wrapped.          |
| `Multi\nLine\r\nText`  | `"Multi\nLine\r\nText"`    | Contains newlines; enclosed in quotes.        |
| `null` / `undefined`   | `""` (empty string)        | Nullish values output as empty cells.         |

---

## 6. Spreadsheet Formula Injection Protection

Spreadsheet Formula Injection (CSV Injection / CWE-1236) occurs when untrusted user-supplied data is opened in spreadsheet software like Microsoft Excel, LibreOffice Calc, or Google Sheets. When a cell begins with characters such as `=`, `+`, `-`, `@`, or `|`, spreadsheet applications interpret the cell content as an executable formula or Dynamic Data Exchange (DDE) command rather than raw text.

### 6.1 Dangerous Triggers Handled

`escapeCSVField` evaluates both raw strings and trimmed strings against formula trigger patterns:

```typescript
if (
  sanitizeFormulas &&
  (/^[=+\-@|\t\r]/.test(str) || /^[=+\-@|]/.test(str.trimStart()))
) {
  str = "'" + str;
}
```

The implementation guards against the following leading characters:

- **`=`**: Standard formula execution (e.g., `=SUM(A1:A10)`, `=HYPERLINK(...)`).
- **`+`** and **`-`**: Arithmetic expression triggers that execute formulas in Excel and Calc.
- **`@`**: Formula calls in Excel (e.g., `@SUM(...)`) and external web query triggers.
- **`|`**: DDE command invocation syntax (e.g., `|'cmd'!' /C calc'`).
- **`\t` (Tab)** and **`\r` (Carriage Return)**: Whitespace prefixes used to bypass naive regex checks when spreadsheets strip whitespace prior to formula parsing.
- **Leading Whitespace (`str.trimStart()`):** If malicious input is padded with spaces (e.g., `"   =1+1"` or `"   |cmd"`), the regex detects the trimmed prefix and neutralizes the formula.

### 6.2 Sanitization Mechanism: Single-Quote Prefixing

The sanitizer neutralizes formula execution by prepending a single quote (`'`) to the cell content. When opened in Excel, the leading `'` forces the spreadsheet to treat the entire cell as literal text; the apostrophe itself remains invisible in standard spreadsheet grid displays.

If the sanitized string also contains commas, quotes, or newlines, standard RFC-4180 quote-wrapping is applied _after_ prefixing.

### 6.3 Formula Sanitization Behavior Matrix

| Untrusted Input | Safe CSV Output     | Security Explanation                                                                          |
| --------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `=SUM(A1:A10)`  | `'=SUM(A1:A10)`     | Prepends `'` to prevent formula calculation.                                                  |
| `+123456789`    | `'+123456789`       | Prepends `'` so Excel treats it as text rather than a number formula.                         |
| `@cmd.exe`      | `'@cmd.exe`         | Prepends `'` to neutralize `@` function evaluation.                                           |
| `-1+2`          | `'-1+2`             | Prepends `'` to prevent subtraction formula execution.                                        |
| `\tTabValue`    | `'\tTabValue`       | Prepends `'` to neutralize tab-prefixed payload.                                              |
| `               | 'cmd'!' /C calc'`   | `'                                                                                            | 'cmd'!' /C calc'` | Neutralizes DDE command execution trigger. |
| `   =1+1`       | `'   =1+1`          | Detects formula trigger through `trimStart()` and prepends `'`.                               |
| `=1+1, "evil"`  | `"'=1+1, ""evil"""` | Prepends `'` for formula injection, doubles quotes, and wraps in outer quotes for CSV syntax. |

### 6.4 Security Boundaries and Limitations

1. **Application-Level Mitigation Only:** Prepending `'` prevents execution in major spreadsheet applications. It does not replace input validation and sanitization for domain-specific business rules.
2. **Text Presentation:** In some software or non-spreadsheet CSV parsers (such as database import scripts), the prepended `'` is treated as a literal character in the data.
3. **Always Reuse Central Sanitizer:** Never construct raw CSV lines with string concatenation (e.g., `${row.a},${row.b}`). Always use `CsvBuilder` or `escapeCSVField` to ensure both RFC-4180 escaping and formula sanitization are consistently applied.

---

## 7. Creating a Typed CSV Exporter

Follow this step-by-step tutorial to create a typed CSV exporter for a new domain entity. In this example, we export **Venue Feedback Reports**.

### Step 1: Define Domain Interface and Options

```typescript
// src/lib/export/domain/venueFeedbackExporter.ts
import { CsvBuilder, triggerBrowserDownload } from "../csvBuilder";
import { CsvColumn } from "../types";

export interface VenueFeedbackReport {
  id: string;
  venueId: string;
  venueName: string;
  reporterEmail?: string | null;
  category: "CLEANLINESS" | "NOISE" | "EQUIPMENT" | "OTHER";
  rating: number;
  comments?: string | null;
  submittedAt: Date | string;
}

export interface VenueFeedbackExportOptions {
  filename?: string;
  lineDelimiter?: "\r\n" | "\n";
  includeBOM?: boolean;
}
```

### Step 2: Define Typed Columns and Factory Function

```typescript
export function createVenueFeedbackCsvBuilder(
  options?: VenueFeedbackExportOptions,
): CsvBuilder<VenueFeedbackReport> {
  const builder = new CsvBuilder<VenueFeedbackReport>({
    lineDelimiter: options?.lineDelimiter ?? "\r\n",
    includeBOM: options?.includeBOM ?? true, // BOM ensures accented text renders in Excel
  });

  const columns: CsvColumn<VenueFeedbackReport>[] = [
    {
      header: "Report ID",
      accessor: "id",
    },
    {
      header: "Venue",
      accessor: (r) => r.venueName || "Unknown Venue",
    },
    {
      header: "Category",
      accessor: (r) => r.category,
    },
    {
      header: "Rating (1-5)",
      accessor: (r) => r.rating,
    },
    {
      header: "Reporter",
      accessor: (r) => r.reporterEmail ?? "Anonymous",
    },
    {
      header: "Comments",
      accessor: (r) => r.comments ?? "",
    },
    {
      header: "Submitted At",
      accessor: (r) => {
        if (r.submittedAt instanceof Date) {
          return isNaN(r.submittedAt.getTime())
            ? ""
            : r.submittedAt.toISOString();
        }
        return r.submittedAt ?? "";
      },
    },
  ];

  builder.setColumns(columns);
  return builder;
}
```

### Step 3: Implement Build and Download Helpers

```typescript
/**
 * Generates an RFC-4180 CSV string from venue feedback reports.
 */
export function exportVenueFeedbackToCSV(
  reports: VenueFeedbackReport[],
  options?: VenueFeedbackExportOptions,
): string {
  const builder = createVenueFeedbackCsvBuilder(options);
  if (Array.isArray(reports)) {
    builder.addRows(reports);
  }
  return builder.build();
}

/**
 * Triggers a browser download of the venue feedback CSV file.
 */
export function downloadVenueFeedbackCSV(
  reports: VenueFeedbackReport[],
  options?: VenueFeedbackExportOptions,
): Blob {
  const builder = createVenueFeedbackCsvBuilder(options);
  if (Array.isArray(reports)) {
    builder.addRows(reports);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const resolvedFilename =
    options?.filename?.trim() || `venue-feedback-${dateStr}.csv`;

  return builder.download(resolvedFilename);
}
```

---

## 8. Excel XML Export Architecture

WorkSphere generates Excel spreadsheets via `src/lib/export/excelBuilder.ts`.

### 8.1 SpreadsheetML 2003 XML Format

Rather than generating binary ZIP archives containing zipped XML (`.xlsx` packages), `ExcelXmlBuilder` produces **Microsoft SpreadsheetML 2003 XML** (`urn:schemas-microsoft-com:office:spreadsheet`).

This format offers several architectural advantages:

- Generates directly in standard TypeScript string memory with zero binary compression overhead.
- Supported natively by Microsoft Excel 2003 through modern Excel 365, LibreOffice Calc, and Apple Numbers.
- Supports typed cell formats (Strings, Numbers, Integers, Currencies, Dates, DateTimes).
- Includes embedded style definitions, custom header backgrounds (`#1E3A8A`), font colors, borders, and automatic column widths.

### 8.2 Excel Column Definition and Options

From `src/lib/export/types.ts`:

```typescript
export type ExcelCellType =
  "String" | "Number" | "Date" | "DateTime" | "Currency";

export interface ExcelColumn<T = any> {
  header: string;
  type?: ExcelCellType;
  accessor: keyof T | ((row: T) => any);
  width?: number; // Optional explicit width in points
}

export interface ExcelBuilderOptions {
  worksheetName?: string; // Default: "Sheet1"
  author?: string; // Default: "WorkSphere"
  sanitizeFormulas?: boolean; // Default: true
}
```

### 8.3 Auto-Adjusted Column Widths

When an explicit `width` is omitted, `ExcelXmlBuilder` calculates auto-adjusted column widths:

1. Determines maximum string length across header and all row values.
2. Applies the auto-fit formula: `Math.min(Math.max(maxLen * 8.5 + 20, 60), 320)`.
3. Clamps width between 60 pt and 320 pt.

### 8.4 XML Escaping vs. Formula Sanitization

SpreadsheetML requires both XML character entity escaping and formula injection protection:

1. **`escapeXml(val)`**: Replaces XML reserved characters:
   - `&` → `&amp;`
   - `<` → `&lt;`
   - `>` → `&gt;`
   - `"` → `&quot;`
   - `'` → `&apos;`
   - Strips non-printable XML control characters: `[\x00-\x08\x0B\x0C\x0E-\x1F]`.

2. **`sanitizeExcelFormula(val)`**: Evaluates values against formula injection triggers (`=`, `+`, `-`, `@`, `|`, `\t`, `\r`) and prepends `'` where detected.

---

## 9. Creating an Excel Exporter

Here is a practical example showing how to build an Excel exporter using `ExcelXmlBuilder`.

```typescript
// src/lib/export/domain/bookingExcelExporter.ts
import { ExcelXmlBuilder } from "../excelBuilder";
import { ExcelColumn } from "../types";

export interface BookingRevenueItem {
  bookingId: string;
  guestName: string;
  deskNumber: string;
  bookingDate: string; // YYYY-MM-DD
  durationHours: number;
  hourlyRate: number;
  totalAmount: number;
  confirmedAt: Date;
}

export function exportBookingRevenueToExcel(
  items: BookingRevenueItem[],
): string {
  const builder = new ExcelXmlBuilder<BookingRevenueItem>({
    worksheetName: "Revenue Summary",
    author: "WorkSphere Financials",
    sanitizeFormulas: true,
  });

  const columns: ExcelColumn<BookingRevenueItem>[] = [
    {
      header: "Booking ID",
      type: "String",
      accessor: "bookingId",
      width: 110,
    },
    {
      header: "Guest Name",
      type: "String",
      accessor: (b) => b.guestName,
    },
    {
      header: "Desk",
      type: "String",
      accessor: "deskNumber",
    },
    {
      header: "Date",
      type: "Date",
      accessor: "bookingDate",
    },
    {
      header: "Duration (hrs)",
      type: "Number",
      accessor: "durationHours",
    },
    {
      header: "Hourly Rate",
      type: "Currency",
      accessor: "hourlyRate",
    },
    {
      header: "Total Revenue",
      type: "Currency",
      accessor: (b) => b.totalAmount,
    },
    {
      header: "Confirmed Timestamp",
      type: "DateTime",
      accessor: "confirmedAt",
    },
  ];

  builder.setColumns(columns);
  builder.addRows(items);

  return builder.build();
}

export function downloadBookingRevenueExcel(
  items: BookingRevenueItem[],
  filename = "booking-revenue.xlsx",
): Blob {
  const builder = new ExcelXmlBuilder<BookingRevenueItem>({
    worksheetName: "Revenue Summary",
  });

  // Re-use column definitions
  builder.setColumns([
    { header: "Booking ID", type: "String", accessor: "bookingId" },
    { header: "Guest Name", type: "String", accessor: (b) => b.guestName },
    { header: "Total Revenue", type: "Currency", accessor: "totalAmount" },
  ]);
  builder.addRows(items);

  return builder.download(filename);
}
```

---

## 10. Browser Download Utilities

Browser downloads are handled by `triggerBrowserDownload` in `src/lib/export/csvBuilder.ts`.

### 10.1 Implementation Details

```typescript
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
```

### 10.2 Operational Characteristics

1. **SSR Safe:** Explicitly checks `typeof window !== "undefined" && typeof document !== "undefined"`. In server environments or edge runtimes, the function cleanly no-ops without throwing `ReferenceError`.
2. **Resource Management:** Calls `URL.revokeObjectURL(url)` immediately after triggering `link.click()`. This releases DOM memory references for the temporary object URL.
3. **DOM Cleanliness:** Appends the hidden `<a>` element to `document.body` and removes it immediately after dispatching the click event.
4. **MIME Types Used:**
   - **CSV:** `text/csv;charset=utf-8;`
   - **Excel XML:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8`

---

## 11. Large Dataset Handling and Performance

When exporting datasets containing thousands of records in a browser environment, developers must account for client-side memory and thread constraints.

### 11.1 Capabilities Matrix

| Feature                                 | Supported in Codebase? | Implementation Reality                                                                                 |
| --------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| **Synchronous In-Memory Generation**    | **Yes**                | Built into `CsvBuilder` and `ExcelXmlBuilder`.                                                         |
| **BOM and Encoding Control**            | **Yes**                | Built into `CsvBuilderOptions.includeBOM`.                                                             |
| **Object URL Cleanup**                  | **Yes**                | Handled in `triggerBrowserDownload`.                                                                   |
| **Streaming Output (`ReadableStream`)** | **No**                 | Output is accumulated into an in-memory string array before Blob instantiation.                        |
| **Chunked Blob Assembly**               | **No**                 | Entire payload is converted in one `new Blob([content])` call.                                         |
| **Web Worker Processing**               | **No (App Pattern)**   | Builders run on the main UI thread unless explicitly invoked inside a custom Web Worker by the caller. |

### 11.2 Memory Implications of In-Memory Generation

`CsvBuilder` accumulates generated lines in an internal array:

```typescript
private lines: string[] = [];
```

When `build()` is called, `output.join(lineDelimiter)` allocates a contiguous string representing the entire file. When `toBlob()` is called, a second memory structure (`Blob`) is created.

For datasets of 10,000+ rows:

- Multiple string transformations and intermediary array joins can cause peak memory usage 3–5x the raw data size.
- Prolonged string operations on the main UI thread can cause frame drops and interface sluggishness.

### 11.3 Recommended Developer Practices for Large Datasets

1. **Avoid Intermediate Duplication:** Avoid mapping arrays multiple times before passing them to `builder.addRows()`. Transform data directly inside the column `accessor` function.
2. **Batch Processing with Event Loop Yielding:** For datasets exceeding 5,000 rows, chunk data processing and yield control to the browser event loop using `setTimeout` or `requestAnimationFrame`:
   ```typescript
   async function addRowsInBatches<T>(
     builder: CsvBuilder<T>,
     items: T[],
     batchSize = 1000,
   ): Promise<void> {
     for (let i = 0; i < items.length; i += batchSize) {
       const batch = items.slice(i, i + batchSize);
       builder.addRows(batch);
       // Allow UI to update and handle input events
       await new Promise((resolve) => setTimeout(resolve, 0));
     }
   }
   ```
3. **Offloading to Web Workers:** For multi-megabyte exports, instantiate `CsvBuilder` or `ExcelXmlBuilder` inside a Web Worker. Have the worker construct the CSV or XML string, call `new Blob([content])`, and transfer the Blob or object URL back to the main thread for download.

---

## 12. Testing Export Functionality

WorkSphere maintains high test coverage for export utilities using Jest. When creating or modifying an exporter, include unit tests covering these key scenarios.

### 12.1 Standard Test Matrix

- **Column Headers:** Verify that headers match expected labels in the correct order.
- **Normal Values:** Verify standard strings, integers, floats, and booleans.
- **Null and Undefined Handling:** Ensure missing optional properties format as empty strings without throwing.
- **Delimiters:** Verify values with commas, quotes (`"hello"`), and newlines (`\n`, `\r\n`).
- **Formula Injection Attacks:** Ensure leading `=`, `+`, `-`, `@`, `|`, and whitespace-padded variants (`"   =1+1"`) are prefixed with `'`.
- **Date Formatting:** Verify `Date` instances produce valid ISO strings or custom date representations.
- **Download Utility Verification:** Ensure DOM mocks (`document.createElement`, `URL.createObjectURL`, `URL.revokeObjectURL`) verify download interaction without errors.

### 12.2 Example Test Suite

```typescript
// src/__tests__/lib/export/venueFeedbackExporter.test.ts
import {
  createVenueFeedbackCsvBuilder,
  exportVenueFeedbackToCSV,
  VenueFeedbackReport,
} from "@/lib/export/domain/venueFeedbackExporter";

describe("VenueFeedback CSV Exporter", () => {
  const mockReports: VenueFeedbackReport[] = [
    {
      id: "FB-001",
      venueId: "V-100",
      venueName: "Impact Hub, Downtown",
      category: "NOISE",
      rating: 4,
      reporterEmail: "nomad@example.com",
      comments: 'Very quiet, but someone said "hello" loudly.',
      submittedAt: new Date("2026-10-15T09:30:00.000Z"),
    },
    {
      id: "FB-002",
      venueId: "V-200",
      venueName: "TechSpace",
      category: "EQUIPMENT",
      rating: 2,
      reporterEmail: null,
      comments: "=SUM(A1:A10)", // Formula injection attempt
      submittedAt: "2026-10-16T14:00:00Z",
    },
  ];

  it("generates correct CSV headers", () => {
    const csv = exportVenueFeedbackToCSV([]);
    expect(csv).toBe(
      "Report ID,Venue,Category,Rating (1-5),Reporter,Comments,Submitted At",
    );
  });

  it("escapes commas, quotes, and sanitizes formulas", () => {
    const csv = exportVenueFeedbackToCSV(mockReports);
    const lines = csv.split("\r\n");

    // Line 1: Comma and quotes in venue and comment
    expect(lines[1]).toContain('"Impact Hub, Downtown"');
    expect(lines[1]).toContain(
      '"Very quiet, but someone said ""hello"" loudly."',
    );

    // Line 2: Anonymous reporter and sanitized formula
    expect(lines[2]).toContain("Anonymous");
    expect(lines[2]).toContain("'=SUM(A1:A10)");
  });
});
```

---

## 13. Security Best Practices

1. **Never Bypass `escapeCSVField` or `sanitizeExcelFormula`:** Avoid manual string concatenation to assemble CSV or XML.
2. **Treat All User Input as Untrusted:** Venue descriptions, user profile names, feedback comments, and billing references are user-generated content capable of hosting formula injection payloads.
3. **Double Quotes in CSV:** Ensure any custom formatters do not strip outer quotes from fields containing commas or newlines.
4. **Content Security Policy (CSP):** The export utilities generate `blob:` URIs for downloads via `URL.createObjectURL`. Ensure your CSP configuration permits `blob:` in `default-src` or `anchor[download]` handlers where enforced.

---

## 14. Troubleshooting

| Issue                                                | Cause                                                                                  | Solution                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Excel displays accented characters incorrectly       | Windows Excel defaults to local ANSI encoding instead of UTF-8.                        | Enable `includeBOM: true` in `CsvBuilderOptions` to prepend `\uFEFF`.                                              |
| Spreadsheet shows `'` before numbers or formulas     | Formula injection sanitizer detected a leading `=`, `+`, `-`, `@`, or `                | `.                                                                                                                 | This is intended security behavior. To disable for internal trusted datasets, pass `sanitizeFormulas: false`. |
| `ReferenceError: document is not defined`            | `triggerBrowserDownload` called during SSR or Next.js server pre-rendering.            | Wrap download calls in client-side event handlers or check `typeof window !== "undefined"`.                        |
| Excel XML shows warning when opening                 | Mismatched data types in cell tags (e.g., non-numeric string with `ss:Type="Number"`). | Ensure column `type` in `ExcelColumn` matches the actual output type, or omit `type` to allow auto-inference.      |
| CSV rows appear on a single line in raw text editors | Line delimiter mismatch between CRLF and LF.                                           | Specify `lineDelimiter: "\r\n"` in `CsvBuilderOptions` for maximum compatibility across Windows and POSIX systems. |

---

## 15. Extending the Export System

When adding support for a new entity or output format:

1. **Reuse `DomainExporter<TInput, TOutput>`:** Defined in `src/lib/export/types.ts` as a consistent contract:
   ```typescript
   export interface DomainExporter<TInput, TOutput> {
     export(data: TInput): TOutput | Promise<TOutput>;
   }
   ```
2. **Keep Business Logic Out of Builders:** Format currencies, dates, and domain status enums in helper functions within the domain exporter module, keeping `CsvBuilder` and `ExcelXmlBuilder` generic and uncoupled from domain models.
3. **Export from Central Barrel:** Export new domain modules through `src/lib/export/domain/index.ts` and `src/lib/export/index.ts`.

---

## 16. Related Documentation

- [Booking Itinerary & PDF Verification System](booking-pdf-generation.md)
- [Workspace Folder Exports Guide](../api/FOLDER_EXPORTS.md) — Documentation for the folder billing CSV export endpoint, field mappings, heuristic mock expenses, and manual CSV construction.
- [API Documentation Index](../api/README.md)
