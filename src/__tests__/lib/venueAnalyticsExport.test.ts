/**
 * Tests for venue analytics data export (CSV format).
 */

interface AnalyticsRow {
  date: string;
  bookings: number;
  revenue: number;
  occupancyPct: number;
  uniqueUsers: number;
}

function toCsvRow(row: AnalyticsRow): string {
  return [row.date, row.bookings, row.revenue.toFixed(2), row.occupancyPct.toFixed(1), row.uniqueUsers].join(",");
}

function toCsvString(rows: AnalyticsRow[], includeHeader = true): string {
  const header = "date,bookings,revenue,occupancy_pct,unique_users";
  const lines = rows.map(toCsvRow);
  return includeHeader ? [header, ...lines].join("\n") : lines.join("\n");
}

function parseCsvRow(line: string): AnalyticsRow | null {
  const parts = line.split(",");
  if (parts.length !== 5) return null;
  const [date, bookings, revenue, occupancyPct, uniqueUsers] = parts;
  return {
    date, bookings: parseInt(bookings), revenue: parseFloat(revenue),
    occupancyPct: parseFloat(occupancyPct), uniqueUsers: parseInt(uniqueUsers),
  };
}

function summaryStats(rows: AnalyticsRow[]): {
  totalBookings: number;
  totalRevenue: number;
  avgOccupancy: number;
} {
  if (rows.length === 0) return { totalBookings: 0, totalRevenue: 0, avgOccupancy: 0 };
  return {
    totalBookings: rows.reduce((s, r) => s + r.bookings, 0),
    totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    avgOccupancy: rows.reduce((s, r) => s + r.occupancyPct, 0) / rows.length,
  };
}

const ROWS: AnalyticsRow[] = [
  { date: "2026-10-01", bookings: 10, revenue: 500.00, occupancyPct: 60, uniqueUsers: 8 },
  { date: "2026-10-02", bookings: 15, revenue: 750.00, occupancyPct: 80, uniqueUsers: 12 },
];

describe("Venue analytics CSV export", () => {
  it("toCsvRow: formats correctly", () => {
    expect(toCsvRow(ROWS[0])).toBe("2026-10-01,10,500.00,60.0,8");
  });

  it("toCsvString: includes header", () => {
    const csv = toCsvString(ROWS);
    expect(csv.startsWith("date,bookings")).toBe(true);
  });

  it("toCsvString: correct number of lines with header", () => {
    const lines = toCsvString(ROWS).split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it("toCsvString: no header option", () => {
    const lines = toCsvString(ROWS, false).split("\n");
    expect(lines).toHaveLength(2);
  });

  it("parseCsvRow: parses back to row", () => {
    const csv = toCsvRow(ROWS[0]);
    const parsed = parseCsvRow(csv)!;
    expect(parsed.date).toBe("2026-10-01");
    expect(parsed.bookings).toBe(10);
    expect(parsed.revenue).toBe(500.0);
  });

  it("parseCsvRow: invalid format → null", () => {
    expect(parseCsvRow("bad,data")).toBeNull();
  });

  it("summaryStats: totals and average", () => {
    const stats = summaryStats(ROWS);
    expect(stats.totalBookings).toBe(25);
    expect(stats.totalRevenue).toBe(1250);
    expect(stats.avgOccupancy).toBe(70);
  });

  it("summaryStats: empty rows → zeros", () => {
    const stats = summaryStats([]);
    expect(stats.totalBookings).toBe(0);
  });
});
