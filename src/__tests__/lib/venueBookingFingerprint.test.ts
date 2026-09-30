/**
 * Tests for booking fingerprint generation for deduplication.
 */

interface BookingFingerprint {
  userId: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  seatType: string;
  seats: number;
}

function generateFingerprint(booking: BookingFingerprint): string {
  const parts = [
    booking.userId,
    booking.venueId,
    booking.date,
    booking.startTime,
    booking.endTime,
    booking.seatType,
    booking.seats,
  ];
  return parts.join(":").toLowerCase();
}

function isDuplicate(
  existing: BookingFingerprint[],
  newBooking: BookingFingerprint
): boolean {
  const newFp = generateFingerprint(newBooking);
  return existing.some((b) => generateFingerprint(b) === newFp);
}

function normalizeBookingTime(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function deduplicateBookings(bookings: BookingFingerprint[]): BookingFingerprint[] {
  const seen = new Set<string>();
  return bookings.filter((b) => {
    const fp = generateFingerprint(b);
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
}

const BOOKING: BookingFingerprint = {
  userId: "u1", venueId: "v1", date: "2026-10-15",
  startTime: "09:00", endTime: "12:00", seatType: "hot_desk", seats: 1,
};

describe("Booking fingerprint deduplication", () => {
  it("generateFingerprint: deterministic", () => {
    expect(generateFingerprint(BOOKING)).toBe(generateFingerprint(BOOKING));
  });

  it("generateFingerprint: different bookings have different fingerprints", () => {
    const other = { ...BOOKING, date: "2026-10-16" };
    expect(generateFingerprint(BOOKING)).not.toBe(generateFingerprint(other));
  });

  it("isDuplicate: same booking → true", () => {
    expect(isDuplicate([BOOKING], BOOKING)).toBe(true);
  });

  it("isDuplicate: different date → false", () => {
    const different = { ...BOOKING, date: "2026-10-20" };
    expect(isDuplicate([BOOKING], different)).toBe(false);
  });

  it("isDuplicate: empty existing → false", () => {
    expect(isDuplicate([], BOOKING)).toBe(false);
  });

  it("normalizeBookingTime: '9:00' → '09:00'", () => {
    expect(normalizeBookingTime("9:00")).toBe("09:00");
  });

  it("deduplicateBookings: removes exact duplicates", () => {
    const bookings = [BOOKING, { ...BOOKING }, { ...BOOKING, date: "2026-10-20" }];
    const deduped = deduplicateBookings(bookings);
    expect(deduped).toHaveLength(2);
  });
});
