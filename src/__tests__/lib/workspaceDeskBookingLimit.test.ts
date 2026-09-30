/**
 * Tests for workspace desk booking per-user daily limits.
 */

interface DeskBookingLimit {
  userId: string;
  venueId: string;
  maxDesksPerDay: number;
  bookedTodayCount: number;
  maxConsecutiveDays: number;
  consecutiveDaysBooked: number;
}

function canBookDesk(limit: DeskBookingLimit): boolean {
  return limit.bookedTodayCount < limit.maxDesksPerDay;
}

function canExtendStay(limit: DeskBookingLimit): boolean {
  return limit.consecutiveDaysBooked < limit.maxConsecutiveDays;
}

function deskSlotsRemaining(limit: DeskBookingLimit): number {
  return Math.max(0, limit.maxDesksPerDay - limit.bookedTodayCount);
}

function recordDeskBooking(limit: DeskBookingLimit): DeskBookingLimit {
  if (!canBookDesk(limit)) throw new Error("Daily desk limit reached");
  return { ...limit, bookedTodayCount: limit.bookedTodayCount + 1 };
}

function resetDailyCount(limit: DeskBookingLimit): DeskBookingLimit {
  return { ...limit, bookedTodayCount: 0 };
}

const LIMIT: DeskBookingLimit = {
  userId: "u1", venueId: "v1",
  maxDesksPerDay: 3, bookedTodayCount: 1,
  maxConsecutiveDays: 5, consecutiveDaysBooked: 2,
};

describe("Workspace desk booking limit", () => {
  it("canBookDesk: 1 of 3 used → true", () => {
    expect(canBookDesk(LIMIT)).toBe(true);
  });

  it("canBookDesk: daily limit reached → false", () => {
    expect(canBookDesk({ ...LIMIT, bookedTodayCount: 3 })).toBe(false);
  });

  it("canExtendStay: 2 of 5 days → true", () => {
    expect(canExtendStay(LIMIT)).toBe(true);
  });

  it("canExtendStay: at max consecutive → false", () => {
    expect(canExtendStay({ ...LIMIT, consecutiveDaysBooked: 5 })).toBe(false);
  });

  it("deskSlotsRemaining: 3 - 1 = 2", () => {
    expect(deskSlotsRemaining(LIMIT)).toBe(2);
  });

  it("deskSlotsRemaining: clamps to 0", () => {
    expect(deskSlotsRemaining({ ...LIMIT, bookedTodayCount: 5 })).toBe(0);
  });

  it("recordDeskBooking: increments count", () => {
    expect(recordDeskBooking(LIMIT).bookedTodayCount).toBe(2);
  });

  it("recordDeskBooking: throws at limit", () => {
    expect(() => recordDeskBooking({ ...LIMIT, bookedTodayCount: 3 })).toThrow("limit reached");
  });

  it("resetDailyCount: clears count", () => {
    const reset = resetDailyCount({ ...LIMIT, bookedTodayCount: 3 });
    expect(reset.bookedTodayCount).toBe(0);
  });
});
