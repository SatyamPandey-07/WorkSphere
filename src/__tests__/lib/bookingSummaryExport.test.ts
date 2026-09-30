/**
 * Tests for booking history summary export to JSON format.
 */

interface BookingRecord {
  id: string;
  venueName: string;
  date: string;       // YYYY-MM-DD
  durationHours: number;
  totalCost: number;  // cents
  status: "completed" | "cancelled" | "no_show";
}

function exportToJson(records: BookingRecord[]): string {
  return JSON.stringify(records, null, 2);
}

function totalSpent(records: BookingRecord[]): number {
  return records
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + r.totalCost, 0);
}

function totalHours(records: BookingRecord[]): number {
  return records
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + r.durationHours, 0);
}

function bookingsByStatus(
  records: BookingRecord[]
): Record<BookingRecord["status"], BookingRecord[]> {
  return {
    completed: records.filter((r) => r.status === "completed"),
    cancelled:  records.filter((r) => r.status === "cancelled"),
    no_show:    records.filter((r) => r.status === "no_show"),
  };
}

const RECORDS: BookingRecord[] = [
  { id: "b1", venueName: "Café Hub",   date: "2026-09-01", durationHours: 3, totalCost: 1500, status: "completed" },
  { id: "b2", venueName: "Co-Work",    date: "2026-09-10", durationHours: 2, totalCost: 1000, status: "cancelled"  },
  { id: "b3", venueName: "Study Room", date: "2026-09-15", durationHours: 4, totalCost: 2000, status: "completed"  },
  { id: "b4", venueName: "Office Pro", date: "2026-09-20", durationHours: 1, totalCost:  500, status: "no_show"    },
];

describe("Booking summary export", () => {
  it("exportToJson produces valid JSON", () => {
    const json = exportToJson(RECORDS);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("exported JSON contains all records", () => {
    const parsed = JSON.parse(exportToJson(RECORDS));
    expect(parsed).toHaveLength(4);
  });

  it("totalSpent only sums completed", () => {
    expect(totalSpent(RECORDS)).toBe(3500);
  });

  it("totalSpent empty → 0", () => {
    expect(totalSpent([])).toBe(0);
  });

  it("totalHours only sums completed", () => {
    expect(totalHours(RECORDS)).toBe(7);
  });

  it("bookingsByStatus groups correctly", () => {
    const grouped = bookingsByStatus(RECORDS);
    expect(grouped.completed).toHaveLength(2);
    expect(grouped.cancelled).toHaveLength(1);
    expect(grouped.no_show).toHaveLength(1);
  });
});
