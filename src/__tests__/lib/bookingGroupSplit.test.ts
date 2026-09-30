/**
 * Tests for group booking cost splitting among attendees.
 */

interface GroupBooking {
  bookingId: string;
  totalCents: number;
  attendeeIds: string[];
  paidBy: string;
}

function splitEvenly(booking: GroupBooking): Record<string, number> {
  const { totalCents, attendeeIds } = booking;
  if (attendeeIds.length === 0) return {};
  const base = Math.floor(totalCents / attendeeIds.length);
  const remainder = totalCents % attendeeIds.length;
  const splits: Record<string, number> = {};
  attendeeIds.forEach((id, i) => {
    splits[id] = base + (i < remainder ? 1 : 0);
  });
  return splits;
}

function totalSplitAmount(splits: Record<string, number>): number {
  return Object.values(splits).reduce((s, v) => s + v, 0);
}

function amountOwed(
  booking: GroupBooking,
  userId: string
): number {
  const splits = splitEvenly(booking);
  if (userId === booking.paidBy) return 0; // payer gets reimbursed, not owed
  return splits[userId] ?? 0;
}

const BOOKING: GroupBooking = {
  bookingId: "b1",
  totalCents: 3000,
  attendeeIds: ["u1", "u2", "u3"],
  paidBy: "u1",
};

describe("Group booking cost splitting", () => {
  it("splitEvenly: 3000/3 = 1000 each", () => {
    const splits = splitEvenly(BOOKING);
    expect(splits["u1"]).toBe(1000);
    expect(splits["u2"]).toBe(1000);
    expect(splits["u3"]).toBe(1000);
  });

  it("totalSplitAmount equals totalCents", () => {
    expect(totalSplitAmount(splitEvenly(BOOKING))).toBe(3000);
  });

  it("remainder distributed one cent at a time", () => {
    const booking: GroupBooking = { ...BOOKING, totalCents: 3001, attendeeIds: ["u1", "u2", "u3"] };
    const splits = splitEvenly(booking);
    expect(totalSplitAmount(splits)).toBe(3001);
    const amounts = Object.values(splits).sort();
    expect(amounts[0]).toBe(1000);
    expect(amounts[2]).toBe(1001);
  });

  it("amountOwed: payer owes nothing", () => {
    expect(amountOwed(BOOKING, "u1")).toBe(0);
  });

  it("amountOwed: attendee owes their share", () => {
    expect(amountOwed(BOOKING, "u2")).toBe(1000);
  });

  it("amountOwed: unknown attendee → 0", () => {
    expect(amountOwed(BOOKING, "u99")).toBe(0);
  });

  it("splitEvenly: empty attendees → empty object", () => {
    const booking: GroupBooking = { ...BOOKING, attendeeIds: [] };
    expect(splitEvenly(booking)).toEqual({});
  });
});
