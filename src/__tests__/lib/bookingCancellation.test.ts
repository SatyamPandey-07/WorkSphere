import {
  BOOKING_CANCELLATION_POLICY_MESSAGE,
  BOOKING_CANCELLATION_WINDOW_MS,
  cancellationWindowHoursRemaining,
  getBookingCancellationEligibility,
  parseBookingStart,
} from "@/lib/bookingCancellation";

describe("booking cancellation policy", () => {
  const now = new Date(2026, 6, 23, 10, 0, 0, 0);

  it("allows cancellation when exactly two hours remain", () => {
    const result = getBookingCancellationEligibility({
      date: "2026-07-23",
      time: "12:00",
      now,
    });

    expect(result.allowed).toBe(true);

    if (result.allowed) {
      expect(result.millisecondsUntilStart).toBe(
        BOOKING_CANCELLATION_WINDOW_MS,
      );
    }
  });

  it("allows cancellation when more than two hours remain", () => {
    const result = getBookingCancellationEligibility({
      date: "2026-07-23",
      time: "12:01",
      now,
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects cancellation when less than two hours remain", () => {
    const result = getBookingCancellationEligibility({
      date: "2026-07-23",
      time: "11:59",
      now,
    });

    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.reason).toBe("INSIDE_WINDOW");
      expect(result.message).toBe(BOOKING_CANCELLATION_POLICY_MESSAGE);
    }
  });

  it("rejects a booking that has already started", () => {
    const result = getBookingCancellationEligibility({
      date: "2026-07-23",
      time: "09:30",
      now,
    });

    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.reason).toBe("BOOKING_ALREADY_STARTED");
    }
  });

  it("rejects invalid booking date and time values", () => {
    const result = getBookingCancellationEligibility({
      date: "2026-02-31",
      time: "25:90",
      now,
    });

    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.reason).toBe("INVALID_START_TIME");
      expect(result.bookingStart).toBeNull();
    }
  });

  it("parses valid local booking values", () => {
    const parsed = parseBookingStart("2026-07-23", "15:45");

    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(6);
    expect(parsed?.getDate()).toBe(23);
    expect(parsed?.getHours()).toBe(15);
    expect(parsed?.getMinutes()).toBe(45);
  });

  it("converts the remaining duration to hours", () => {
    expect(cancellationWindowHoursRemaining(90 * 60 * 1000)).toBe(1.5);

    expect(cancellationWindowHoursRemaining(-1)).toBe(0);
  });
});
