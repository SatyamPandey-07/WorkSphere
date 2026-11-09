/**
 * Standardized Exporter Interfaces and Types.
 */

export type ExportFormat = "csv" | "pdf" | "geojson" | "kml" | "txt" | "xlsx";

export type ExcelCellType =
  | "String"
  | "Number"
  | "Date"
  | "DateTime"
  | "Currency";

export interface ExcelColumn<T = any> {
  header: string;
  type?: ExcelCellType;
  accessor: keyof T | ((row: T) => any);
  width?: number;
}

export interface ExcelBuilderOptions {
  worksheetName?: string;
  author?: string;
  sanitizeFormulas?: boolean;
}

export interface CsvColumn<T = any> {
  header: string;
  accessor: keyof T | ((row: T) => any);
}

export interface CsvBuilderOptions {
  lineDelimiter?: "\r\n" | "\n";
  includeBOM?: boolean;
  sanitizeFormulas?: boolean;
}

export interface PdfBuilderOptions {
  title?: string;
  subject?: string;
  author?: string;
  pageSize?: [number, number]; // Default A4: [595, 842]
  margin?: number; // Default 40
  accentColor?: { r: number; g: number; b: number };
}

export interface DomainExporter<TInput, TOutput> {
  export(data: TInput): TOutput | Promise<TOutput>;
}
