/**
 * Tests for the booking status lifecycle transitions.
 * PENDING → CONFIRMED → CHECKED_IN → COMPLETED
 */

type BookingStatus = "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED" | "COMPLETED";

const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING:    ["CONFIRMED", "CANCELLED"],
  CONFIRMED:  ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["COMPLETED"],
  CANCELLED:  [],
  COMPLETED:  [],
};

function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

describe("Booking status lifecycle transitions", () => {
  it("PENDING → CONFIRMED is valid", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
  });

  it("PENDING → CANCELLED is valid", () => {
    expect(canTransition("PENDING", "CANCELLED")).toBe(true);
  });

  it("CONFIRMED → CHECKED_IN is valid", () => {
    expect(canTransition("CONFIRMED", "CHECKED_IN")).toBe(true);
  });

  it("CHECKED_IN → COMPLETED is valid", () => {
    expect(canTransition("CHECKED_IN", "COMPLETED")).toBe(true);
  });

  it("COMPLETED → any state is invalid (terminal)", () => {
    (["PENDING", "CONFIRMED", "CHECKED_IN", "CANCELLED"] as BookingStatus[]).forEach((to) => {
      expect(canTransition("COMPLETED", to)).toBe(false);
    });
  });

  it("CANCELLED → any state is invalid (terminal)", () => {
    (["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED"] as BookingStatus[]).forEach((to) => {
      expect(canTransition("CANCELLED", to)).toBe(false);
    });
  });

  it("PENDING → CHECKED_IN skipping CONFIRMED is invalid", () => {
    expect(canTransition("PENDING", "CHECKED_IN")).toBe(false);
  });

  it("CONFIRMED → COMPLETED skipping CHECKED_IN is invalid", () => {
    expect(canTransition("CONFIRMED", "COMPLETED")).toBe(false);
  });
});
