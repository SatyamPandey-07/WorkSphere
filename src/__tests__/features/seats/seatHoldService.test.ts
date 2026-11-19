import {
  calculateSeatHoldDurationMs,
  calculateSeatHoldExpiryMs,
} from "@/features/seats/seatHoldService";

describe("seat hold duration across daylight-saving transitions (#8904)", () => {
  it("uses elapsed UTC time across the spring-forward midnight transition", () => {
    const start = "2026-03-07T23:00:00-05:00";
    const end = "2026-03-08T02:00:00-04:00";

    // 23:00 EST to 02:00 EDT spans only two elapsed hours because 02:00
    // local time is skipped when clocks advance on this date.
    expect(calculateSeatHoldDurationMs(start, end)).toBe(2 * 60 * 60 * 1000);
  });

  it("accounts for the skipped hour during the spring-forward transition", () => {
    const start = "2026-03-08T01:30:00-05:00";
    const end = "2026-03-08T03:30:00-04:00";

    expect(calculateSeatHoldDurationMs(start, end)).toBe(60 * 60 * 1000);
  });

  it("accounts for the repeated hour during the fall-back transition", () => {
    const start = "2026-11-01T01:30:00-04:00";
    const end = "2026-11-01T01:30:00-05:00";

    expect(calculateSeatHoldDurationMs(start, end)).toBe(60 * 60 * 1000);
  });

  it("calculates a fall-back midnight reservation by absolute elapsed time", () => {
    const start = "2026-10-31T23:00:00-04:00";
    const end = "2026-11-01T02:00:00-05:00";

    expect(calculateSeatHoldDurationMs(start, end)).toBe(4 * 60 * 60 * 1000);
  });

  it("returns the absolute expiry epoch for countdown and lock consumers", () => {
    const end = "2026-11-02T02:00:00-05:00";
    expect(calculateSeatHoldExpiryMs(
      "2026-11-01T23:00:00-04:00",
      end,
    )).toBe(Date.parse(end));
  });

  it("rejects timezone-naive strings instead of interpreting host-local time", () => {
    expect(() =>
      calculateSeatHoldDurationMs(
        "2026-03-08T01:30:00",
        "2026-03-08T03:30:00",
      ),
    ).toThrow("explicit timezone");
  });

  it("rejects invalid and non-positive intervals", () => {
    expect(() =>
      calculateSeatHoldDurationMs("not-a-date", "2026-03-08T03:30:00Z"),
    ).toThrow("explicit timezone");
    expect(() =>
      calculateSeatHoldDurationMs(
        "2026-03-08T03:30:00Z",
        "2026-03-08T01:30:00Z",
      ),
    ).toThrow("must be after");
    expect(() =>
      calculateSeatHoldDurationMs(
        "2026-03-08T01:30:00Z",
        "2026-03-08T01:30:00Z",
      ),
    ).toThrow("must be after");
  });
});
