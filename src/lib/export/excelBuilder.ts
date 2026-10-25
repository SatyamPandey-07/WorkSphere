/**
 * Generic Lightweight Excel XML / XLSX Generator Utility.
 *
 * Implements Microsoft SpreadsheetML 2003 XML with formatted bold header rows,
 * auto-adjusted column widths, formula injection sanitization, and clean
 * date & monetary / currency column formatting.
 */

import { ExcelBuilderOptions, ExcelColumn, ExcelCellType } from "./types";
import { triggerBrowserDownload } from "./csvBuilder";

/**
 * Escapes characters for XML compliance.
 */
export function escapeXml(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Sanitizes spreadsheet formula injection triggers (=, +, -, @, \t, \r).
 */
export function sanitizeExcelFormula(val: string): string {
  if (typeof val !== "string") val = String(val ?? "");
  if (/^[=+\-@|\t\r]/.test(val) || /^[=+\-@|]/.test(val.trimStart())) {
    return "'" + val;
  }
  return val;
}

export class ExcelXmlBuilder<TRow = any> {
  private columns: ExcelColumn<TRow>[] = [];
  private rows: TRow[] = [];
  private options: Required<ExcelBuilderOptions>;

  constructor(options: ExcelBuilderOptions = {}) {
    this.options = {
      worksheetName: options.worksheetName || "Sheet1",
      author: options.author || "WorkSphere",
      sanitizeFormulas: options.sanitizeFormulas ?? true,
    };
  }

  public setWorksheetName(name: string): this {
    this.options.worksheetName = name;
    return this;
  }

  public addColumn(column: ExcelColumn<TRow>): this {
    this.columns.push(column);
    return this;
  }

  public setColumns(columns: ExcelColumn<TRow>[]): this {
    this.columns = columns;
    return this;
  }

  public addRow(row: TRow): this {
    this.rows.push(row);
    return this;
  }

  public addRows(rows: TRow[]): this {
    this.rows.push(...rows);
    return this;
  }

  /**
   * Generates formatted Excel XML (SpreadsheetML) workbook string.
   */
  public build(): string {
    const { worksheetName, author, sanitizeFormulas } = this.options;
    const nowIso = new Date().toISOString();

    // 1. Calculate auto-adjusted column widths
    const columnWidths = this.columns.map((col) => {
      if (col.width && col.width > 0) return col.width;
      let maxLen = col.header.length;
      for (const row of this.rows) {
        const val =
          typeof col.accessor === "function"
            ? col.accessor(row)
            : row[col.accessor];
        if (val !== null && val !== undefined) {
          const str = String(val);
          if (str.length > maxLen) maxLen = str.length;
        }
      }
      // Auto-fit formula: ~8 points per character + 20 points padding, clamped between 60 and 320
      return Math.min(Math.max(maxLen * 8.5 + 20, 60), 320);
    });

    const lines: string[] = [];

    // XML Declaration & Excel Processing Instruction
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<?mso-application progid="Excel.Sheet"?>');

    // Workbook Root with Namespaces
    lines.push(
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:html="http://www.w3.org/TR/REC-html40">',
    );

    // Document Properties
    lines.push(
      '  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">',
      `    <Author>${escapeXml(author)}</Author>`,
      `    <Created>${nowIso}</Created>`,
      `    <Company>WorkSphere</Company>`,
      "  </DocumentProperties>",
    );

    // Excel Workbook Options
    lines.push(
      '  <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">',
      "    <WindowHeight>12000</WindowHeight>",
      "    <WindowWidth>24000</WindowWidth>",
      "    <ProtectStructure>False</ProtectStructure>",
      "    <ProtectWindows>False</ProtectWindows>",
      "  </ExcelWorkbook>",
    );

    // Styles with Formatted Header and Currency/Date/Number Formats
    lines.push(
      "  <Styles>",
      '    <Style ss:ID="Default" ss:Name="Normal">',
      '      <Alignment ss:Vertical="Bottom"/>',
      "      <Borders/>",
      '      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>',
      "      <Interior/>",
      "      <NumberFormat/>",
      "      <Protection/>",
      "    </Style>",
      // Bold formatted header style with blue/slate fill and border
      '    <Style ss:ID="Header">',
      '      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>',
      '      <Interior ss:Color="#1E3A8A" ss:Pattern="Solid"/>',
      '      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
      "      <Borders>",
      '        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>',
      '        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#3B82F6"/>',
      '        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#3B82F6"/>',
      "      </Borders>",
      "    </Style>",
      // Date formatting: yyyy-mm-dd
      '    <Style ss:ID="Date">',
      '      <NumberFormat ss:Format="yyyy-mm-dd"/>',
      '      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
      "    </Style>",
      // DateTime formatting: yyyy-mm-dd hh:mm:ss
      '    <Style ss:ID="DateTime">',
      '      <NumberFormat ss:Format="yyyy-mm-dd hh:mm:ss"/>',
      '      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
      "    </Style>",
      // Monetary currency formatting: "$"#,##0.00
      '    <Style ss:ID="Currency">',
      '      <NumberFormat ss:Format="&quot;$&quot;#,##0.00"/>',
      '      <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>',
      "    </Style>",
      // Standard number formatting
      '    <Style ss:ID="Number">',
      '      <NumberFormat ss:Format="#,##0.00"/>',
      '      <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>',
      "    </Style>",
      // Integer number formatting
      '    <Style ss:ID="Integer">',
      '      <NumberFormat ss:Format="#,##0"/>',
      '      <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>',
      "    </Style>",
      // Left aligned text
      '    <Style ss:ID="Text">',
      '      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>',
      "    </Style>",
      // Centered text
      '    <Style ss:ID="CenteredText">',
      '      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
      "    </Style>",
      "  </Styles>",
    );

    // Worksheet & Table
    lines.push(`  <Worksheet ss:Name="${escapeXml(worksheetName)}">`);
    lines.push("    <Table>");

    // Auto-adjusted Columns
    columnWidths.forEach((w) => {
      lines.push(`      <Column ss:Width="${Math.round(w)}"/>`);
    });

    // Formatted Header Row (Bold)
    lines.push('      <Row ss:Height="25">');
    this.columns.forEach((col) => {
      lines.push(
        `        <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>`,
      );
    });
    lines.push("      </Row>");

    // Data Rows
    for (const row of this.rows) {
      lines.push('      <Row ss:Height="19">');
      for (const col of this.columns) {
        const rawVal =
          typeof col.accessor === "function"
            ? col.accessor(row)
            : row[col.accessor];

        const cellXml = this.renderCellXml(rawVal, col.type, sanitizeFormulas);
        lines.push(`        ${cellXml}`);
      }
      lines.push("      </Row>");
    }

    lines.push("    </Table>");
    lines.push("  </Worksheet>");
    lines.push("</Workbook>");

    return lines.join("\r\n");
  }

  private renderCellXml(
    val: any,
    colType?: ExcelCellType,
    sanitizeFormulas = true,
  ): string {
    if (val === null || val === undefined || val === "") {
      return '<Cell ss:StyleID="Text"><Data ss:Type="String"></Data></Cell>';
    }

    // Explicit or inferred column type
    const resolvedType = colType || this.inferType(val);

    switch (resolvedType) {
      case "Currency": {
        const str = String(val);
        const isFormula = sanitizeFormulas && (/^[=+\-@|\t\r]/.test(str) || /^[=+\-@|]/.test(str.trimStart()));
        if (!isFormula) {
          const num = typeof val === "number" ? val : parseFloat(str.replace(/[^0-9.-]/g, ""));
          if (!isNaN(num)) {
            return `<Cell ss:StyleID="Currency"><Data ss:Type="Number">${num.toFixed(2)}</Data></Cell>`;
          }
        }
        let strVal = str;
        if (sanitizeFormulas) {
          strVal = sanitizeExcelFormula(strVal);
        }
        return `<Cell ss:StyleID="Currency"><Data ss:Type="String">${escapeXml(strVal)}</Data></Cell>`;
      }

      case "Number": {
        const str = String(val);
        const isFormula = sanitizeFormulas && (/^[=+\-@|\t\r]/.test(str) || /^[=+\-@|]/.test(str.trimStart()));
        if (!isFormula) {
          const num = typeof val === "number" ? val : parseFloat(str);
          if (!isNaN(num)) {
            const style = Number.isInteger(num) ? "Integer" : "Number";
            return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${num}</Data></Cell>`;
          }
        }
        let strVal = str;
        if (sanitizeFormulas) {
          strVal = sanitizeExcelFormula(strVal);
        }
        return `<Cell ss:StyleID="Text"><Data ss:Type="String">${escapeXml(strVal)}</Data></Cell>`;
      }

      case "Date": {
        let dateStr: string;
        if (val instanceof Date) {
          dateStr = isNaN(val.getTime()) ? "" : val.toISOString().slice(0, 10);
        } else {
          dateStr = String(val).slice(0, 10);
        }
        if (sanitizeFormulas) {
          dateStr = sanitizeExcelFormula(dateStr);
        }
        return `<Cell ss:StyleID="Date"><Data ss:Type="String">${escapeXml(dateStr)}</Data></Cell>`;
      }

      case "DateTime": {
        let dateStr: string;
        if (val instanceof Date) {
          dateStr = isNaN(val.getTime()) ? "" : val.toISOString().replace("T", " ").slice(0, 19);
        } else {
          dateStr = String(val);
        }
        if (sanitizeFormulas) {
          dateStr = sanitizeExcelFormula(dateStr);
        }
        return `<Cell ss:StyleID="DateTime"><Data ss:Type="String">${escapeXml(dateStr)}</Data></Cell>`;
      }

      case "String":
      default: {
        let str = String(val);
        if (sanitizeFormulas) {
          str = sanitizeExcelFormula(str);
        }
        return `<Cell ss:StyleID="Text"><Data ss:Type="String">${escapeXml(str)}</Data></Cell>`;
      }
    }
  }

  private inferType(val: any): ExcelCellType {
    if (typeof val === "number") return "Number";
    if (val instanceof Date) return "Date";
    return "String";
  }

  /**
   * Generates a Blob with native Excel spreadsheet MIME type.
   */
  public toBlob(): Blob {
    const xml = this.build();
    return new Blob([xml], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8",
    });
  }

  /**
   * Triggers client-side browser download for this Excel workbook.
   */
  public download(filename: string): Blob {
    const safeFilename = filename.endsWith(".xlsx") || filename.endsWith(".xml")
      ? filename
      : `${filename}.xlsx`;
    const blob = this.toBlob();
    triggerBrowserDownload(blob, safeFilename);
    return blob;
  }
}
