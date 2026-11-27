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

const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

function parseTimestampMs(input?: string | number | Date): number | null {
  if (input === undefined || input === null) return null;
  if (input instanceof Date) {
    const ms = input.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatRfc4180CsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const formulaSafe = FORMULA_PREFIX_PATTERN.test(raw) ? `'` : raw;
  const needsQuotes = formulaSafe.includes('"') || formulaSafe.includes(',') || formulaSafe.includes('\n') || formulaSafe.includes('\r');
  if (!needsQuotes) return formulaSafe;
  return `""`;
}

export function filterScope2LedgerEntries(entries: readonly Scope2LedgerEntry[], filter: Scope2CsvExportFilter = {}): Scope2LedgerEntry[] {
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

export function exportScope2LedgerToCsv(entries: readonly Scope2LedgerEntry[], filter: Scope2CsvExportFilter = {}): string {
  const headers = ['id', 'venueId', 'recordedAt', 'kwh', 'emissionFactorKgPerKwh', 'emissionsKgCo2e', 'notes'];
  const filtered = filterScope2LedgerEntries(entries, filter);
  const lines: string[] = [headers.map(formatRfc4180CsvCell).join(',')];
  for (const entry of filtered) {
    const computedEmissions = typeof entry.emissionsKgCo2e === 'number' && Number.isFinite(entry.emissionsKgCo2e) ? entry.emissionsKgCo2e : entry.kwh * entry.emissionFactorKgPerKwh;
    const row = [entry.id, entry.venueId, entry.recordedAt, entry.kwh, entry.emissionFactorKgPerKwh, computedEmissions, entry.notes ?? ''];
    lines.push(row.map(formatRfc4180CsvCell).join(','));
  }
  return lines.join('\r\n');
}

export default exportScope2LedgerToCsv;
