/**
 * Tests for venue booking summary card data generation.
 */

interface BookingSummaryCard {
  bookingId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  seatType: string;
  totalCents: number;
  currency: string;
  confirmationCode: string;
  status: "confirmed" | "pending" | "cancelled";
}

function formatBookingTimeRange(card: BookingSummaryCard): string {
  return `${card.startTime} – ${card.endTime}`;
}

function formatBookingAmount(card: BookingSummaryCard): string {
  return `${card.currency} ${(card.totalCents / 100).toFixed(2)}`;
}

function isUpcoming(card: BookingSummaryCard, todayStr: string): boolean {
  return card.date > todayStr && card.status !== "cancelled";
}

function isPast(card: BookingSummaryCard, todayStr: string): boolean {
  return card.date < todayStr || card.status === "cancelled";
}

function bookingSummaryTitle(card: BookingSummaryCard): string {
  return `${card.seatType.replace(/_/g, " ")} at ${card.venueName}`;
}

const CARD: BookingSummaryCard = {
  bookingId: "b1",
  venueName: "The Coffee Hub",
  date: "2026-10-15",
  startTime: "09:00",
  endTime: "12:00",
  seatType: "hot_desk",
  totalCents: 3000,
  currency: "USD",
  confirmationCode: "WS-123456",
  status: "confirmed",
};

describe("Booking summary card", () => {
  it("formatBookingTimeRange: '09:00 – 12:00'", () => {
    expect(formatBookingTimeRange(CARD)).toBe("09:00 – 12:00");
  });

  it("formatBookingAmount: 'USD 30.00'", () => {
    expect(formatBookingAmount(CARD)).toBe("USD 30.00");
  });

  it("isUpcoming: future date → true", () => {
    expect(isUpcoming(CARD, "2026-10-01")).toBe(true);
  });

  it("isUpcoming: past date → false", () => {
    expect(isUpcoming(CARD, "2026-11-01")).toBe(false);
  });

  it("isUpcoming: cancelled → false", () => {
    expect(isUpcoming({ ...CARD, status: "cancelled" }, "2026-10-01")).toBe(false);
  });

  it("isPast: past date → true", () => {
    expect(isPast(CARD, "2026-11-01")).toBe(true);
  });

  it("isPast: cancelled → true regardless of date", () => {
    expect(isPast({ ...CARD, status: "cancelled" }, "2026-10-01")).toBe(true);
  });

  it("bookingSummaryTitle: formats seat type", () => {
    expect(bookingSummaryTitle(CARD)).toBe("hot desk at The Coffee Hub");
  });
});
