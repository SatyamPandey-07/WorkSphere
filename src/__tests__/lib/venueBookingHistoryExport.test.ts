/**
 * Tests for venue booking history export in multiple formats.
 */

interface BookingHistoryRecord {
  bookingId: string;
  date: string;
  venueName: string;
  seatType: string;
  hours: number;
  totalCents: number;
  status: string;
  receiptNumber: string;
}

function toCSVLine(record: BookingHistoryRecord): string {
  const fields = [
    record.bookingId,
    record.date,
    `"${record.venueName.replace(/"/g, '""')}"`,
    record.seatType,
    record.hours.toFixed(1),
    (record.totalCents / 100).toFixed(2),
    record.status,
    record.receiptNumber,
  ];
  return fields.join(",");
}

function toCSV(records: BookingHistoryRecord[], includeHeader = true): string {
  const header = "Booking ID,Date,Venue,Seat Type,Hours,Amount,Status,Receipt";
  const lines = records.map(toCSVLine);
  return includeHeader ? [header, ...lines].join("\n") : lines.join("\n");
}

function filterByDateRange(
  records: BookingHistoryRecord[],
  startDate: string,
  endDate: string
): BookingHistoryRecord[] {
  return records.filter((r) => r.date >= startDate && r.date <= endDate);
}

function filterByStatus(
  records: BookingHistoryRecord[],
  statuses: string[]
): BookingHistoryRecord[] {
  return records.filter((r) => statuses.includes(r.status));
}

function exportSummary(records: BookingHistoryRecord[]): {
  totalBookings: number;
  totalSpentCents: number;
  dateRange: { from: string; to: string } | null;
} {
  if (records.length === 0) return { totalBookings: 0, totalSpentCents: 0, dateRange: null };
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  return {
    totalBookings: records.length,
    totalSpentCents: records.reduce((s, r) => s + r.totalCents, 0),
    dateRange: { from: sorted[0].date, to: sorted[sorted.length - 1].date },
  };
}

const RECORDS: BookingHistoryRecord[] = [
  { bookingId: "b1", date: "2026-10-01", venueName: "Café Hub", seatType: "hot_desk", hours: 3, totalCents: 1500, status: "completed", receiptNumber: "R-001" },
  { bookingId: "b2", date: "2026-10-05", venueName: 'The "Studio"', seatType: "private_room", hours: 2, totalCents: 4000, status: "completed", receiptNumber: "R-002" },
  { bookingId: "b3", date: "2026-10-10", venueName: "Hub Pro", seatType: "desk", hours: 4, totalCents: 2000, status: "cancelled", receiptNumber: "R-003" },
];

describe("Venue booking history export", () => {
  it("toCSVLine: escapes double quotes in venue name", () => {
    const line = toCSVLine(RECORDS[1]);
    expect(line).toContain('""Studio""');
  });

  it("toCSV: includes header by default", () => {
    const csv = toCSV(RECORDS);
    expect(csv.startsWith("Booking ID")).toBe(true);
  });

  it("toCSV: correct line count with header", () => {
    expect(toCSV(RECORDS).split("\n")).toHaveLength(4); // header + 3 records
  });

  it("filterByDateRange: Oct 1-7 returns 2 records", () => {
    const filtered = filterByDateRange(RECORDS, "2026-10-01", "2026-10-07");
    expect(filtered).toHaveLength(2);
  });

  it("filterByStatus: completed only = 2", () => {
    expect(filterByStatus(RECORDS, ["completed"])).toHaveLength(2);
  });

  it("exportSummary: total bookings and spent", () => {
    const summary = exportSummary(RECORDS);
    expect(summary.totalBookings).toBe(3);
    expect(summary.totalSpentCents).toBe(7500);
    expect(summary.dateRange!.from).toBe("2026-10-01");
  });

  it("exportSummary: empty records → null date range", () => {
    expect(exportSummary([]).dateRange).toBeNull();
  });
});
