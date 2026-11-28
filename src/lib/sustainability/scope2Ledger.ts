export interface Scope2LedgerEntry {
  id: string;
  venueId: string;
  recordedAt: string;
  kwh: number;
  emissionFactorKgPerKwh: number;
  emissionsKgCo2e?: number;
  notes?: string;
}

export interface Scope2CsvExportFilter {
  venueId?: string;
  from?: string | number | Date;
  to?: string | number | Date;
}

export interface MonthlyEmissionsSummary {
  month: string;
  emissionsKgCo2e: number;
}

const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

function parseTimestampMs(input?: string | number | Date): number | null {
  if (input === undefined || input === null) return null;
  if (input instanceof Date) {
    const ms = input.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatRfc4180CsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const formulaSafe = FORMULA_PREFIX_PATTERN.test(raw) ? `'${raw}` : raw;
  const needsQuotes =
    formulaSafe.includes('"') ||
    formulaSafe.includes(",") ||
    formulaSafe.includes("\n") ||
    formulaSafe.includes("\r");
  if (!needsQuotes) return formulaSafe;
  return '"' + formulaSafe.replace(/"/g, '""') + '"';
}

export function filterScope2LedgerEntries(
  entries: readonly Scope2LedgerEntry[],
  filter: Scope2CsvExportFilter = {},
): Scope2LedgerEntry[] {
  const fromMs = parseTimestampMs(filter.from);
  const toMs = parseTimestampMs(filter.to);
  const normalizedVenue = filter.venueId?.trim();
  return entries.filter((entry) => {
    if (normalizedVenue && entry.venueId !== normalizedVenue) return false;
    if (fromMs !== null || toMs !== null) {
      const entryMs = parseTimestampMs(entry.recordedAt);
      if (entryMs === null) return false;
      if (fromMs !== null && entryMs < fromMs) return false;
      if (toMs !== null && entryMs > toMs) return false;
    }
    return true;
  });
}

function getEmissionsKgCo2e(entry: Scope2LedgerEntry): number {
  return typeof entry.emissionsKgCo2e === "number" &&
    Number.isFinite(entry.emissionsKgCo2e)
    ? entry.emissionsKgCo2e
    : entry.kwh * entry.emissionFactorKgPerKwh;
}

export function summarizeMonthlyEmissions(
  entries: readonly Scope2LedgerEntry[],
): MonthlyEmissionsSummary[] {
  const monthlyTotals = new Map<string, number>();
  for (const entry of entries) {
    const recordedAtMs = parseTimestampMs(entry.recordedAt);
    if (recordedAtMs === null) continue;

    const month = new Date(recordedAtMs).toISOString().slice(0, 7);
    monthlyTotals.set(
      month,
      (monthlyTotals.get(month) ?? 0) + getEmissionsKgCo2e(entry),
    );
  }

  return Array.from(monthlyTotals, ([month, emissionsKgCo2e]) => ({
    month,
    emissionsKgCo2e,
  })).sort((left, right) => left.month.localeCompare(right.month));
}

export function exportScope2LedgerToCsv(
  entries: readonly Scope2LedgerEntry[],
  filter: Scope2CsvExportFilter = {},
): string {
  const headers = [
    "id",
    "venueId",
    "recordedAt",
    "kwh",
    "emissionFactorKgPerKwh",
    "emissionsKgCo2e",
    "notes",
  ];
  const filtered = filterScope2LedgerEntries(entries, filter);
  const lines: string[] = [headers.map(formatRfc4180CsvCell).join(",")];
  for (const entry of filtered) {
    const row = [
      entry.id,
      entry.venueId,
      entry.recordedAt,
      entry.kwh,
      entry.emissionFactorKgPerKwh,
      getEmissionsKgCo2e(entry),
      entry.notes ?? "",
    ];
    lines.push(row.map(formatRfc4180CsvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export default exportScope2LedgerToCsv;

export interface Scope2CalculationRecordInput {
  userId?: string;
  mode?: string;
  distanceKm?: number;
  co2SavedKg?: number;
  venueId?: string;
  region?: string;
  kwh?: number;
  emissionFactorKgPerKwh?: number;
  recordedAt?: string | number | Date;
  notes?: string;
}

class Scope2LedgerService {
  private readonly entries: Scope2LedgerEntry[] = [];

  public recordCalculation(
    input: Scope2CalculationRecordInput = {},
  ): Scope2LedgerEntry & { co2SavedKg: number } {
    const recordedAt = input.recordedAt
      ? new Date(input.recordedAt).toISOString()
      : new Date().toISOString();
    const kwh =
      typeof input.kwh === "number" && Number.isFinite(input.kwh)
        ? input.kwh
        : 0;
    const emissionFactorKgPerKwh =
      typeof input.emissionFactorKgPerKwh === "number" &&
      Number.isFinite(input.emissionFactorKgPerKwh)
        ? input.emissionFactorKgPerKwh
        : 0.82;
    const savedKg =
      typeof input.co2SavedKg === "number" && Number.isFinite(input.co2SavedKg)
        ? input.co2SavedKg
        : 0;
    const entry: Scope2LedgerEntry & { co2SavedKg: number } = {
      id: `scope2-${input.userId ?? "anonymous"}-${Date.now()}-${this.entries.length + 1}`,
      venueId: input.venueId ?? input.region ?? "unknown",
      recordedAt,
      kwh,
      emissionFactorKgPerKwh,
      notes: input.notes ?? input.mode,
      co2SavedKg: savedKg,
    };
    this.entries.push(entry);
    return entry;
  }
}

export const defaultScope2Ledger = new Scope2LedgerService();
