/**
 * Tests for venue booking bulk data import validation utilities.
 */

interface ImportRow {
  rowIndex: number;
  venueId: string;
  startDate: string;   // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;
  guestCount: number;
  organizerEmail: string;
  notes: string;
}

interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRow(row: ImportRow): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!DATE_REGEX.test(row.startDate)) {
    errors.push({ rowIndex: row.rowIndex, field: "startDate", message: "Invalid date format" });
  }
  if (!TIME_REGEX.test(row.startTime)) {
    errors.push({ rowIndex: row.rowIndex, field: "startTime", message: "Invalid time format" });
  }
  if (!TIME_REGEX.test(row.endTime)) {
    errors.push({ rowIndex: row.rowIndex, field: "endTime", message: "Invalid time format" });
  }
  if (row.guestCount <= 0) {
    errors.push({ rowIndex: row.rowIndex, field: "guestCount", message: "Must be positive" });
  }
  if (!EMAIL_REGEX.test(row.organizerEmail)) {
    errors.push({ rowIndex: row.rowIndex, field: "organizerEmail", message: "Invalid email" });
  }
  return errors;
}

function importSummary(rows: ImportRow[]): { valid: number; invalid: number; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  let valid = 0;
  for (const row of rows) {
    const rowErrors = validateRow(row);
    if (rowErrors.length === 0) valid++;
    else errors.push(...rowErrors);
  }
  return { valid, invalid: rows.length - valid, errors };
}

function deduplicateRows(rows: ImportRow[]): ImportRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.venueId}|${r.startDate}|${r.startTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const VALID_ROW: ImportRow = {
  rowIndex: 1, venueId: "v1", startDate: "2026-11-01", startTime: "09:00", endTime: "17:00",
  guestCount: 50, organizerEmail: "org@example.com", notes: "",
};
const INVALID_ROW: ImportRow = {
  rowIndex: 2, venueId: "v1", startDate: "01/11/2026", startTime: "9am", endTime: "5pm",
  guestCount: -1, organizerEmail: "notanemail", notes: "",
};

describe("Bulk import validation", () => {
  it("validateRow: valid row → no errors", () => {
    expect(validateRow(VALID_ROW).length).toBe(0);
  });

  it("validateRow: invalid row → multiple errors", () => {
    expect(validateRow(INVALID_ROW).length).toBeGreaterThan(2);
  });

  it("importSummary: 1 valid, 1 invalid", () => {
    const summary = importSummary([VALID_ROW, INVALID_ROW]);
    expect(summary.valid).toBe(1);
    expect(summary.invalid).toBe(1);
  });

  it("deduplicateRows: removes duplicate venue/date/time", () => {
    const dup = [VALID_ROW, { ...VALID_ROW, rowIndex: 3 }];
    expect(deduplicateRows(dup).length).toBe(1);
  });

  it("deduplicateRows: distinct rows preserved", () => {
    const distinct = [VALID_ROW, { ...VALID_ROW, rowIndex: 3, startTime: "10:00" }];
    expect(deduplicateRows(distinct).length).toBe(2);
  });
});
