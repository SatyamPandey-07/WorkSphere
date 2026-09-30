/**
 * Tests for bulk booking operations (admin/group management).
 */

interface BulkBookingRequest {
  requestId: string;
  userId: string;
  venueId: string;
  bookings: {
    date: string;
    startTime: string;
    endTime: string;
    seatId: string;
  }[];
  totalPriceCents: number;
  status: "draft" | "submitted" | "approved" | "rejected";
}

interface BulkOperationResult {
  requestId: string;
  succeeded: string[];  // booking IDs
  failed: { date: string; reason: string }[];
  totalProcessed: number;
  successRate: number;
}

function processBulkBooking(
  request: BulkBookingRequest,
  existingBookings: { seatId: string; date: string }[]
): BulkOperationResult {
  const succeeded: string[] = [];
  const failed: { date: string; reason: string }[] = [];

  request.bookings.forEach((booking, idx) => {
    const hasConflict = existingBookings.some(
      (existing) => existing.seatId === booking.seatId && existing.date === booking.date
    );

    if (hasConflict) {
      failed.push({ date: booking.date, reason: "Seat already booked" });
    } else {
      succeeded.push(`${request.requestId}-${idx}`);
    }
  });

  return {
    requestId: request.requestId,
    succeeded,
    failed,
    totalProcessed: request.bookings.length,
    successRate: Math.round((succeeded.length / request.bookings.length) * 100),
  };
}

function bulkCancellationImpact(
  bookings: { bookingId: string; priceCents: number; status: "confirmed" | "cancelled" }[],
  cancellationFeePct: number
): { totalRefundCents: number; totalFeeCents: number } {
  const cancelled = bookings.filter((b) => b.status === "confirmed"); // simulating mass cancel
  const totalCents = cancelled.reduce((s, b) => s + b.priceCents, 0);
  const feeCents = Math.round(totalCents * (cancellationFeePct / 100));
  return { totalRefundCents: totalCents - feeCents, totalFeeCents: feeCents };
}

const REQUEST: BulkBookingRequest = {
  requestId: "bulk1", userId: "u1", venueId: "v1",
  bookings: [
    { date: "2026-10-01", startTime: "09:00", endTime: "10:00", seatId: "s1" },
    { date: "2026-10-02", startTime: "09:00", endTime: "10:00", seatId: "s1" },
    { date: "2026-10-03", startTime: "09:00", endTime: "10:00", seatId: "s2" },
  ],
  totalPriceCents: 15000,
  status: "submitted",
};

describe("Bulk booking operations", () => {
  it("processBulkBooking: no conflicts → all succeed", () => {
    const result = processBulkBooking(REQUEST, []);
    expect(result.succeeded).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.successRate).toBe(100);
  });

  it("processBulkBooking: conflict on day 1 → fails for that day", () => {
    const existing = [{ seatId: "s1", date: "2026-10-01" }];
    const result = processBulkBooking(REQUEST, existing);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.successRate).toBe(67);
  });

  it("bulkCancellationImpact: 10% fee on 15000 = 1500 fee, 13500 refund", () => {
    const bookings = [
      { bookingId: "b1", priceCents: 5000, status: "confirmed" as const },
      { bookingId: "b2", priceCents: 10000, status: "confirmed" as const },
    ];
    const { totalRefundCents, totalFeeCents } = bulkCancellationImpact(bookings, 10);
    expect(totalFeeCents).toBe(1500);
    expect(totalRefundCents).toBe(13500);
  });
});
