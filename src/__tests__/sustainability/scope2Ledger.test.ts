import { exportScope2LedgerToCsv, formatRfc4180CsvCell, type Scope2LedgerEntry } from '@/lib/sustainability/scope2Ledger';

describe('scope2Ledger RFC 4180 CSV exporter', () => {
  const sampleEntries: Scope2LedgerEntry[] = [
    { id: 's2-1', venueId: 'mum-west-01', recordedAt: '2026-11-01T10:00:00.000Z', kwh: 120, emissionFactorKgPerKwh: 0.82, notes: 'Main hall meter' },
    { id: 's2-2', venueId: 'mum-west-01', recordedAt: '2026-11-15T12:00:00.000Z', kwh: 200, emissionFactorKgPerKwh: 0.82, notes: '=SUM(A1:A2), `"quoted`" & line\nbreak' },
    { id: 's2-3', venueId: 'pun-east-02', recordedAt: '2026-11-10T08:00:00.000Z', kwh: 90, emissionFactorKgPerKwh: 0.79, notes: '+cmd|`"/c calc`"!A0' }
  ];

  it('filters entries by venueId and inclusive date range using RFC 4180 line endings', () => {
    const csv = exportScope2LedgerToCsv(sampleEntries, { venueId: 'mum-west-01', from: '2026-11-05T00:00:00.000Z', to: '2026-11-20T23:59:59.999Z' });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('id,venueId,recordedAt,kwh,emissionFactorKgPerKwh,emissionsKgCo2e,notes');
    expect(rows.length).toBe(2);
    expect(rows[1]).toContain('s2-2,mum-west-01,2026-11-15T12:00:00.000Z,200,0.82,164,');
  });

  it('escapes formula injection prefixes, double quotes, commas, and newlines safely', () => {
    expect(formatRfc4180CsvCell('=1+1')).toBe('`"''=1+1`"');
    expect(formatRfc4180CsvCell('+1+1')).toBe('`"''+1+1`"');
    expect(formatRfc4180CsvCell('-1+1')).toBe('`"''-1+1`"');
    expect(formatRfc4180CsvCell('@SUM(A1)')).toBe('`"''@SUM(A1)`"');
    expect(formatRfc4180CsvCell('say `"hi`", ok')).toBe('`"say `""hi`"", ok`"');
    const csv = exportScope2LedgerToCsv(sampleEntries);
    expect(csv).toContain('`"''=SUM(A1:A2), `""quoted"" & line\nbreak`"');
    expect(csv).toContain('`"''+cmd|`""/c calc""!A0`"');
  });
});
