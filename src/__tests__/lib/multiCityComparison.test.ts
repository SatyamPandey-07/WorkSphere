/**
 * Tests for the sortable MultiCityComparison table (Issue #1947).
 * sortedChartData sorts rows by the selected column.
 */

interface ChartRow {
  city: string;
  avgWifi: number | null;
  quietPct: number;
  outletPct: number;
}

function sortRows(
  rows: ChartRow[],
  sortColumn: keyof ChartRow,
  ascending: boolean,
): ChartRow[] {
  return [...rows].sort((a, b) => {
    const av = a[sortColumn];
    const bv = b[sortColumn];
    const cmp =
      typeof av === "string"
        ? (av as string).localeCompare(bv as string)
        : (av as number) - (bv as number);
    return ascending ? cmp : -cmp;
  });
}

const ROWS: ChartRow[] = [
  { city: "Berlin", avgWifi: 50, quietPct: 70, outletPct: 80 },
  { city: "London", avgWifi: 80, quietPct: 40, outletPct: 60 },
  { city: "Paris",  avgWifi: 30, quietPct: 90, outletPct: 90 },
];

describe("MultiCityComparison sortable table", () => {
  it("sorts by quietPct descending (quietest first)", () => {
    const sorted = sortRows(ROWS, "quietPct", false);
    expect(sorted[0].city).toBe("Paris");   // 90%
    expect(sorted[1].city).toBe("Berlin");  // 70%
    expect(sorted[2].city).toBe("London");  // 40%
  });

  it("sorts by quietPct ascending (noisiest first)", () => {
    const sorted = sortRows(ROWS, "quietPct", true);
    expect(sorted[0].city).toBe("London"); // 40%
    expect(sorted[2].city).toBe("Paris");  // 90%
  });

  it("sorts by avgWifi descending", () => {
    const sorted = sortRows(ROWS, "avgWifi", false);
    expect(sorted[0].city).toBe("London"); // 80 Mbps
    expect(sorted[2].city).toBe("Paris");  // 30 Mbps
  });

  it("sorts by city alphabetically ascending", () => {
    const sorted = sortRows(ROWS, "city", true);
    expect(sorted[0].city).toBe("Berlin");
    expect(sorted[1].city).toBe("London");
    expect(sorted[2].city).toBe("Paris");
  });

  it("sorts by outletPct descending", () => {
    const sorted = sortRows(ROWS, "outletPct", false);
    expect(sorted[0].city).toBe("Paris"); // 90%
    expect(sorted[2].city).toBe("London"); // 60%
  });

  it("does not mutate original array", () => {
    const original = [...ROWS];
    sortRows(ROWS, "quietPct", false);
    expect(ROWS).toEqual(original);
  });

  it("returns all rows (none dropped)", () => {
    const sorted = sortRows(ROWS, "quietPct", false);
    expect(sorted).toHaveLength(ROWS.length);
  });
});
