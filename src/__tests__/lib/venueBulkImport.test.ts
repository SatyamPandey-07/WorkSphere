/**
 * Tests for bulk venue data import validation and processing.
 */

interface VenueImportRow {
  name: string;
  address: string;
  city: string;
  country: string;
  category: string;
  capacity?: number;
  hourlyRate?: number;
}

interface ImportResult {
  valid: VenueImportRow[];
  invalid: { row: VenueImportRow; errors: string[] }[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
}

function validateImportRow(row: VenueImportRow): string[] {
  const errors: string[] = [];
  if (!row.name?.trim()) errors.push("name required");
  if (!row.address?.trim()) errors.push("address required");
  if (!row.city?.trim()) errors.push("city required");
  if (!row.country?.trim()) errors.push("country required");
  if (!row.category?.trim()) errors.push("category required");
  if (row.capacity !== undefined && row.capacity <= 0) errors.push("capacity must be positive");
  if (row.hourlyRate !== undefined && row.hourlyRate < 0) errors.push("hourlyRate cannot be negative");
  return errors;
}

function processBulkImport(rows: VenueImportRow[]): ImportResult {
  const valid: VenueImportRow[] = [];
  const invalid: { row: VenueImportRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors = validateImportRow(row);
    if (errors.length === 0) {
      valid.push(row);
    } else {
      invalid.push({ row, errors });
    }
  }

  return { valid, invalid, totalRows: rows.length, validCount: valid.length, invalidCount: invalid.length };
}

const VALID_ROW: VenueImportRow = { name: "Coffee Hub", address: "123 Main St", city: "NYC", country: "US", category: "cafe", capacity: 20, hourlyRate: 5 };

describe("Venue bulk import", () => {
  it("validateImportRow: valid row → no errors", () => {
    expect(validateImportRow(VALID_ROW)).toHaveLength(0);
  });

  it("validateImportRow: missing name → error", () => {
    expect(validateImportRow({ ...VALID_ROW, name: "" }).some((e) => /name/i.test(e))).toBe(true);
  });

  it("validateImportRow: negative capacity → error", () => {
    expect(validateImportRow({ ...VALID_ROW, capacity: -1 }).some((e) => /capacity/i.test(e))).toBe(true);
  });

  it("processBulkImport: all valid", () => {
    const result = processBulkImport([VALID_ROW, { ...VALID_ROW, name: "Hub 2" }]);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(0);
  });

  it("processBulkImport: mixed valid/invalid", () => {
    const result = processBulkImport([VALID_ROW, { ...VALID_ROW, name: "" }]);
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(1);
  });

  it("processBulkImport: totalRows = validCount + invalidCount", () => {
    const rows = [VALID_ROW, { ...VALID_ROW, name: "" }, { ...VALID_ROW, city: "" }];
    const result = processBulkImport(rows);
    expect(result.totalRows).toBe(result.validCount + result.invalidCount);
  });

  it("processBulkImport: empty array", () => {
    const result = processBulkImport([]);
    expect(result.totalRows).toBe(0);
    expect(result.validCount).toBe(0);
  });
});
