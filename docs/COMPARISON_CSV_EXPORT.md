# Multi-City Comparison CSV Export

## Overview

The Multi-City Comparison feature allows workspace data from multiple cities to be exported in CSV (Comma-Separated Values) format for offline analysis and reporting.

The exported CSV is designed to be compatible with spreadsheet applications such as Microsoft Excel, Google Sheets, and LibreOffice Calc while maintaining a predictable column order and consistent data formatting.

This document describes the expected CSV structure, column definitions, escaping rules, download behaviour, and testing recommendations for the export functionality.

---

## CSV Column Headers

The exported CSV should include the following columns in the order shown below.

| Column Header | Description                                                             |
| ------------- | ----------------------------------------------------------------------- |
| Venue Name    | Name of the workspace or venue.                                         |
| City          | City where the venue is located.                                        |
| Wi-Fi Speed   | Average measured Wi-Fi speed in Mbps.                                   |
| Noise Level   | Reported workspace noise level (for example: Quiet, Moderate, or Busy). |
| Price         | Pricing information for the workspace, if available.                    |
| Rating        | Overall venue rating shown in the comparison results.                   |

---

## CSV Escaping Rules

To ensure compatibility with spreadsheet applications and CSV parsers, exported values should follow standard CSV escaping rules.

### Values Containing Commas

If a venue name contains a comma, the entire value should be enclosed in double quotes.

Example:

```csv
"Central Hub, Downtown",London,120,Quiet,£20/hour,4.8
```

### Values Containing Double Quotes

If a venue name contains double quotes, each quote should be escaped by doubling it.

Example:

```csv
"The ""Focus"" Workspace",Tokyo,180,Quiet,£18/hour,4.9
```

### Empty Values

If data is unavailable, the corresponding CSV field should be left empty while preserving the column order.

Example:

```csv
Remote Cafe,Berlin,,Moderate,,4.5
```

---

## Example CSV Output

The following example demonstrates the expected structure of an exported CSV file.

```csv
Venue Name,City,Wi-Fi Speed,Noise Level,Price,Rating
"Central Hub, Downtown",London,120,Quiet,£20/hour,4.8
"The ""Focus"" Workspace",Tokyo,180,Quiet,£18/hour,4.9
Remote Cafe,Berlin,,Moderate,,4.5
```

---

## Blob Download Behaviour

CSV exports are expected to be generated as a browser Blob with a CSV MIME type.

Typical download flow:

1. Generate CSV text from comparison data.
2. Create a Blob using the CSV content.
3. Create an object URL with `URL.createObjectURL`.
4. Trigger a temporary anchor element download.
5. Revoke the object URL after download completes.

This approach enables client-side CSV downloads without requiring an additional server request.

---

## Automated Testing Examples

Automated tests should verify that exported CSV data is correctly formatted and downloadable.

### Blob Validation

```ts
expect(blob).toBeInstanceOf(Blob);

expect(blob.type).toContain("text/csv");
```

### Header Validation

```ts
expect(csvText).toContain(
  "Venue Name,City,Wi-Fi Speed,Noise Level,Price,Rating",
);
```

### Comma Escaping Validation

```ts
expect(csvText).toContain('"Central Hub, Downtown"');
```

### Quote Escaping Validation

```ts
expect(csvText).toContain('"The ""Focus"" Workspace"');
```

### Row Structure Validation

```ts
const rows = csvText.trim().split("\n");

expect(rows.length).toBeGreaterThan(1);
```
