import {
  bookingInterval,
  conflictDateWindow,
  findConflictingBookings,
  hasBookingConflict,
  intervalsOverlap,
  CONFLICT_DATE_WINDOW_DAYS,
  DEFAULT_BOOKING_DURATION_MINUTES,
} from "@/lib/bookingOverlap";

const slot = (
  date: string,
  time: string,
  timeZone: string | null,
  duration: number | null = 60,
) => ({ date, time, timeZone, duration });

describe("bookingInterval", () => {
  it("converts wall-clock time in the booking's zone to a UTC range", () => {
    // Asia/Colombo is UTC+05:30 with no DST: 09:00 local = 03:30Z
    const i = bookingInterval(slot("2026-10-10", "09:00", "Asia/Colombo", 90));
    expect(new Date(i!.start).toISOString()).toBe("2026-10-10T03:30:00.000Z");
    expect(new Date(i!.end).toISOString()).toBe("2026-10-10T05:00:00.000Z");
  });

  it("falls back to the default duration for null, zero, negative and NaN", () => {
    for (const duration of [null, 0, -30, NaN]) {
      const i = bookingInterval(slot("2026-10-10", "10:00", "UTC", duration))!;
      expect(i.end - i.start).toBe(DEFAULT_BOOKING_DURATION_MINUTES * 60_000);
    }
  });

  it("parses legacy 12-hour times instead of producing NaN", () => {
    const i = bookingInterval(slot("2026-10-10", "10:00 AM", "UTC"));
    expect(new Date(i!.start).toISOString()).toBe("2026-10-10T10:00:00.000Z");
  });

  it("returns null for unparseable dates or times", () => {
    expect(bookingInterval(slot("2026-02-31", "10:00", "UTC"))).toBeNull();
    expect(bookingInterval(slot("2026-10-10", "garbage", "UTC"))).toBeNull();
  });

  it("uses the fallback zone only when the row has none", () => {
    const own = bookingInterval(slot("2026-10-10", "10:00", "Asia/Colombo"), "UTC");
    const legacy = bookingInterval(slot("2026-10-10", "10:00", null), "Asia/Colombo");
    expect(own!.start).toBe(legacy!.start);
  });
});

describe("intervalsOverlap", () => {
  it("treats back-to-back bookings as non-conflicting (half-open ranges)", () => {
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(intervalsOverlap({ start: 10, end: 20 }, { start: 0, end: 10 })).toBe(false);
  });

  it("detects partial, containing and identical ranges", () => {
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(true);
    expect(intervalsOverlap({ start: 0, end: 30 }, { start: 10, end: 20 })).toBe(true);
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 0, end: 10 })).toBe(true);
  });
});

describe("hasBookingConflict", () => {
  // Ground truth for each case is worked out by hand in UTC.
  it("conflicts when two zones describe the same instant", () => {
    // 09:00 Colombo = 03:30Z, which is exactly 03:30 UTC
    expect(
      hasBookingConflict(slot("2026-10-10", "03:30", "UTC"), [
        slot("2026-10-10", "09:00", "Asia/Colombo"),
      ]),
    ).toBe(true);
  });

  it("does not conflict when the wall clocks match but the instants differ", () => {
    // 10:00 Colombo = 04:30Z; 10:00 New York (EDT/EST) is 14:00Z or 15:00Z
    expect(
      hasBookingConflict(slot("2026-10-10", "10:00", "America/New_York"), [
        slot("2026-10-10", "10:00", "Asia/Colombo"),
      ]),
    ).toBe(false);
  });

  it("conflicts when a booking runs past midnight into the next stored date", () => {
    expect(
      hasBookingConflict(slot("2026-10-11", "00:30", "UTC"), [
        slot("2026-10-10", "23:00", "UTC", 120), // until 01:00 on the 11th
      ]),
    ).toBe(true);
  });

  it("conflicts in the reverse direction (earlier request hits a later-dated row)", () => {
    expect(
      hasBookingConflict(slot("2026-10-10", "23:30", "UTC", 120), [
        slot("2026-10-11", "00:30", "UTC"),
      ]),
    ).toBe(true);
  });

  it("conflicts when a zone shifts the calendar date of the same instant", () => {
    // 23:30 New York on Oct 10 (EDT) = 03:30Z on Oct 11
    expect(
      hasBookingConflict(slot("2026-10-11", "03:00", "UTC"), [
        slot("2026-10-10", "23:30", "America/New_York"),
      ]),
    ).toBe(true);
  });

  it("conflicts with legacy rows stored as 'h:mm AM' (previously NaN, never conflicted)", () => {
    expect(
      hasBookingConflict(slot("2026-10-10", "10:00", "UTC"), [
        { date: "2026-10-10", time: "10:00 AM", timeZone: null, duration: 60 },
      ]),
    ).toBe(true);
  });

  it("keeps plain same-zone overlap and adjacency behaviour", () => {
    const existing = [slot("2026-10-10", "10:00", "UTC")];
    expect(hasBookingConflict(slot("2026-10-10", "10:30", "UTC"), existing)).toBe(true);
    expect(hasBookingConflict(slot("2026-10-10", "11:00", "UTC"), existing)).toBe(false);
    expect(hasBookingConflict(slot("2026-10-10", "09:00", "UTC"), existing)).toBe(false);
  });

  it("reads rows without a timeZone in the requested zone (unchanged legacy behaviour)", () => {
    const legacy = [{ date: "2026-10-10", time: "10:00", timeZone: null, duration: 60 }];
    expect(hasBookingConflict(slot("2026-10-10", "10:30", "Asia/Colombo"), legacy)).toBe(true);
    expect(hasBookingConflict(slot("2026-10-10", "10:30", "UTC"), legacy)).toBe(true);
  });

  it("treats a row without a date as the requested date", () => {
    expect(
      hasBookingConflict(slot("2026-10-10", "10:30", "UTC"), [
        { time: "10:00", duration: 60 },
      ]),
    ).toBe(true);
  });

  it("is DST-aware (no conflict across the spring-forward gap boundary)", () => {
    // New York 2026-03-08: 02:00 -> 03:00. 01:00 EST = 06:00Z, 03:00 EDT = 07:00Z
    expect(
      hasBookingConflict(slot("2026-03-08", "03:00", "America/New_York"), [
        slot("2026-03-08", "01:00", "America/New_York", 60), // 06:00Z-07:00Z
      ]),
    ).toBe(false);
  });

  it("ignores rows whose own date/time can't be parsed", () => {
    expect(
      hasBookingConflict(slot("2026-10-10", "10:00", "UTC"), [
        { date: "2026-10-10", time: "??", timeZone: "UTC", duration: 60 },
      ]),
    ).toBe(false);
  });

  it("throws on an invalid requested slot instead of silently reporting free", () => {
    expect(() => hasBookingConflict(slot("2026-10-10", "nope", "UTC"), [])).toThrow();
  });
});

describe("findConflictingBookings", () => {
  it("returns only the rows that actually intersect, preserving extra fields", () => {
    const rows = [
      { ...slot("2026-10-10", "09:00", "UTC"), id: "a" },
      { ...slot("2026-10-10", "10:15", "UTC"), id: "b" },
      { ...slot("2026-10-10", "13:00", "UTC"), id: "c" },
    ];
    const hit = findConflictingBookings(slot("2026-10-10", "10:00", "UTC"), rows);
    expect(hit.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("conflictDateWindow", () => {
  it("returns 2*radius+1 consecutive dates centred on the requested date", () => {
    const w = conflictDateWindow("2026-10-10");
    expect(w).toHaveLength(2 * CONFLICT_DATE_WINDOW_DAYS + 1);
    expect(w[CONFLICT_DATE_WINDOW_DAYS]).toBe("2026-10-10");
    expect(w[0]).toBe("2026-10-07");
    expect(w[w.length - 1]).toBe("2026-10-13");
  });

  it("crosses month, year and leap-day boundaries correctly", () => {
    expect(conflictDateWindow("2026-12-31", 1)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(conflictDateWindow("2028-03-01", 1)).toEqual(["2028-02-29", "2028-03-01", "2028-03-02"]);
    expect(conflictDateWindow("2026-03-01", 1)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("is wide enough to contain every conflicting row, even at extreme zone offsets", () => {
    // Brute force over UTC+14, UTC-12 and UTC with the longest allowed (8h)
    // bookings: any row that really conflicts must be stored under a date the
    // window covers, otherwise the DB query would never return it.
    const zones = ["Pacific/Kiritimati", "Etc/GMT+12", "UTC"];
    const requestedDate = "2026-06-15";
    const window = conflictDateWindow(requestedDate);
    const dateAt = (offsetDays: number) =>
      new Date(Date.UTC(2026, 5, 15 + offsetDays)).toISOString().slice(0, 10);
    const at = (h: number) => `${String(h).padStart(2, "0")}:00`;

    let conflicts = 0;
    let furthestOffset = 0;
    for (const requestedZone of zones) {
      for (const rowZone of zones) {
        for (const requestedHour of [0, 12, 23]) {
          for (const rowHour of [0, 12, 23]) {
            for (let offset = -5; offset <= 5; offset++) {
              const requested = slot(requestedDate, at(requestedHour), requestedZone, 480);
              const row = slot(dateAt(offset), at(rowHour), rowZone, 480);
              if (hasBookingConflict(requested, [row])) {
                conflicts++;
                furthestOffset = Math.max(furthestOffset, Math.abs(offset));
                expect(window).toContain(row.date);
              }
            }
          }
        }
      }
    }
    expect(conflicts).toBeGreaterThan(0);
    expect(furthestOffset).toBeLessThanOrEqual(CONFLICT_DATE_WINDOW_DAYS);
  });
});
