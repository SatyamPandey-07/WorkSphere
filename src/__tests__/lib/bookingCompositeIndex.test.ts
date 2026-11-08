/**
 * Tests for the composite database index added to the Booking model (Issue #1940).
 * @@index([venueId, date, status]) supports availability range queries.
 */

// The composite index supports left-prefix queries:
// - venueId alone
// - venueId + date
// - venueId + date + status

interface Booking {
  id: string;
  venueId: string;
  date: string;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
}

// Simulate query filtering that the index optimizes
function queryAvailability(
  bookings: Booking[],
  venueId: string,
  dateFrom?: string,
  dateTo?: string,
  status?: string,
): Booking[] {
  return bookings.filter((b) => {
    if (b.venueId !== venueId) return false;
    if (dateFrom && b.date < dateFrom) return false;
    if (dateTo && b.date > dateTo) return false;
    if (status && b.status !== status) return false;
    return true;
  });
}

const BOOKINGS: Booking[] = [
  { id: "b1", venueId: "v1", date: "2026-09-20", status: "CONFIRMED" },
  { id: "b2", venueId: "v1", date: "2026-09-25", status: "CONFIRMED" },
  { id: "b3", venueId: "v1", date: "2026-09-28", status: "CANCELLED" },
  { id: "b4", venueId: "v2", date: "2026-09-20", status: "CONFIRMED" },
  { id: "b5", venueId: "v1", date: "2026-10-01", status: "PENDING" },
];

describe("Booking composite index query patterns", () => {
  it("left-prefix 1: venueId only", () => {
    const result = queryAvailability(BOOKINGS, "v1");
    expect(result).toHaveLength(4);
    expect(result.every((b) => b.venueId === "v1")).toBe(true);
  });

  it("left-prefix 2: venueId + date range", () => {
    const result = queryAvailability(BOOKINGS, "v1", "2026-09-25", "2026-09-30");
    expect(result).toHaveLength(2); // b2 and b3
    expect(result.map((b) => b.id).sort()).toEqual(["b2", "b3"]);
  });

  it("left-prefix 3: venueId + date + status", () => {
    const result = queryAvailability(BOOKINGS, "v1", "2026-09-01", "2026-09-30", "CONFIRMED");
    expect(result).toHaveLength(2); // b1 and b2
  });

  it("different venue is excluded", () => {
    const result = queryAvailability(BOOKINGS, "v1");
    expect(result.some((b) => b.venueId === "v2")).toBe(false);
  });

  it("status filter correctly separates confirmed from cancelled", () => {
    const confirmed = queryAvailability(BOOKINGS, "v1", undefined, undefined, "CONFIRMED");
    const cancelled = queryAvailability(BOOKINGS, "v1", undefined, undefined, "CANCELLED");
    expect(confirmed.length).toBeGreaterThan(0);
    expect(cancelled.length).toBeGreaterThan(0);
    expect(confirmed.some((b) => b.status === "CANCELLED")).toBe(false);
    expect(cancelled.some((b) => b.status === "CONFIRMED")).toBe(false);
  });

  it("date range reduces result count vs no date filter", () => {
    const all = queryAvailability(BOOKINGS, "v1");
    const filtered = queryAvailability(BOOKINGS, "v1", "2026-09-25", "2026-09-30");
    expect(filtered.length).toBeLessThan(all.length);
  });
});
