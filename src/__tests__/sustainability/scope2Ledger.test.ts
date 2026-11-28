import {
  exportScope2LedgerToCsv,
  formatRfc4180CsvCell,
  summarizeMonthlyEmissions,
  type Scope2LedgerEntry,
} from "@/lib/sustainability/scope2Ledger";

describe("scope2Ledger RFC 4180 CSV exporter", () => {
  it("exports the header with a trailing newline when entries are empty", () => {
    expect(exportScope2LedgerToCsv([])).toBe(
      "id,venueId,recordedAt,kwh,emissionFactorKgPerKwh,emissionsKgCo2e,notes\r\n",
    );
  });

  const sampleEntries: Scope2LedgerEntry[] = [
    {
      id: "s2-1",
      venueId: "mum-west-01",
      recordedAt: "2026-11-01T10:00:00.000Z",
      kwh: 120,
      emissionFactorKgPerKwh: 0.82,
      notes: "Main hall meter",
    },
    {
      id: "s2-2",
      venueId: "mum-west-01",
      recordedAt: "2026-11-15T12:00:00.000Z",
      kwh: 200,
      emissionFactorKgPerKwh: 0.82,
      notes: '=SUM(A1:A2), `"quoted`" & line\nbreak',
    },
    {
      id: "s2-3",
      venueId: "pun-east-02",
      recordedAt: "2026-11-10T08:00:00.000Z",
      kwh: 90,
      emissionFactorKgPerKwh: 0.79,
      notes: '+cmd|`"/c calc`"!A0',
    },
  ];

  it("filters entries by venueId and inclusive date range using RFC 4180 line endings", () => {
    const csv = exportScope2LedgerToCsv(sampleEntries, {
      venueId: "mum-west-01",
      from: "2026-11-05T00:00:00.000Z",
      to: "2026-11-20T23:59:59.999Z",
    });
    const rows = csv.split("\r\n");
    expect(rows[0]).toBe(
      "id,venueId,recordedAt,kwh,emissionFactorKgPerKwh,emissionsKgCo2e,notes",
    );
    expect(rows.length).toBe(3);
    expect(rows[2]).toBe("");
    expect(rows[1]).toContain(
      "s2-2,mum-west-01,2026-11-15T12:00:00.000Z,200,0.82,164,",
    );
  });

  it("escapes formula injection prefixes, double quotes, commas, and newlines safely", () => {
    expect(formatRfc4180CsvCell("=1+1")).toBe("'=1+1");
    expect(formatRfc4180CsvCell("+1+1")).toBe("'+1+1");
    expect(formatRfc4180CsvCell("-1+1")).toBe("'-1+1");
    expect(formatRfc4180CsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(formatRfc4180CsvCell('say `"hi`", ok')).toBe('"say `""hi`"", ok"');
    const csv = exportScope2LedgerToCsv(sampleEntries);
    expect(csv).toContain("=SUM(A1:A2)");
    expect(csv).toContain("+cmd|");
  });
});

describe("summarizeMonthlyEmissions", () => {
  it("aggregates emissions from multiple entries in the same month", () => {
    const entries: Scope2LedgerEntry[] = [
      {
        id: "a",
        venueId: "venue-1",
        recordedAt: "2026-11-02T00:00:00.000Z",
        kwh: 10,
        emissionFactorKgPerKwh: 0.5,
      },
      {
        id: "b",
        venueId: "venue-1",
        recordedAt: "2026-11-20T00:00:00.000Z",
        kwh: 20,
        emissionFactorKgPerKwh: 0.5,
      },
    ];

    expect(summarizeMonthlyEmissions(entries)).toEqual([
      { month: "2026-11", emissionsKgCo2e: 15 },
    ]);
  });

  it("groups separate months and sorts them chronologically across years", () => {
    const entries: Scope2LedgerEntry[] = [
      {
        id: "a",
        venueId: "venue-1",
        recordedAt: "2026-11-01T00:00:00.000Z",
        kwh: 1,
        emissionFactorKgPerKwh: 1,
      },
      {
        id: "b",
        venueId: "venue-1",
        recordedAt: "2027-01-01T00:00:00.000Z",
        kwh: 2,
        emissionFactorKgPerKwh: 1,
      },
      {
        id: "c",
        venueId: "venue-1",
        recordedAt: "2025-12-01T00:00:00.000Z",
        kwh: 3,
        emissionFactorKgPerKwh: 1,
      },
      {
        id: "d",
        venueId: "venue-1",
        recordedAt: "2026-01-01T00:00:00.000Z",
        kwh: 4,
        emissionFactorKgPerKwh: 1,
      },
    ];

    expect(summarizeMonthlyEmissions(entries)).toEqual([
      { month: "2025-12", emissionsKgCo2e: 3 },
      { month: "2026-01", emissionsKgCo2e: 4 },
      { month: "2026-11", emissionsKgCo2e: 1 },
      { month: "2027-01", emissionsKgCo2e: 2 },
    ]);
  });

  it("returns an empty result for empty input", () => {
    expect(summarizeMonthlyEmissions([])).toEqual([]);
  });

  it("uses ledger CO2e overrides and falls back to kWh conversion without rounding", () => {
    const entries: Scope2LedgerEntry[] = [
      {
        id: "override",
        venueId: "venue-1",
        recordedAt: "2026-11-01T00:00:00.000Z",
        kwh: 100,
        emissionFactorKgPerKwh: 0.8,
        emissionsKgCo2e: 12.345,
      },
      {
        id: "calculated",
        venueId: "venue-1",
        recordedAt: "2026-11-02T00:00:00.000Z",
        kwh: 10,
        emissionFactorKgPerKwh: 0.5,
      },
    ];

    expect(summarizeMonthlyEmissions(entries)).toEqual([
      { month: "2026-11", emissionsKgCo2e: 17.345 },
    ]);
  });

  it("does not mutate the input entries", () => {
    const entries: Scope2LedgerEntry[] = [
      {
        id: "a",
        venueId: "venue-1",
        recordedAt: "2026-11-01T00:00:00.000Z",
        kwh: 10,
        emissionFactorKgPerKwh: 0.5,
      },
    ];
    const original = JSON.stringify(entries);

    summarizeMonthlyEmissions(entries);

    expect(JSON.stringify(entries)).toBe(original);
  });
});
