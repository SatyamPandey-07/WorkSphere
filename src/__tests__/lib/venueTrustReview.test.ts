/**
 * Tests for venue trust-based review gating (only bookings can review).
 */

interface TrustedReview {
  reviewId: string;
  userId: string;
  venueId: string;
  bookingId: string;
  rating: number;
  content: string;
  submittedAt: number;
  isVerified: boolean; // linked to actual booking
}

interface CompletedBooking {
  bookingId: string;
  userId: string;
  venueId: string;
  completedAt: number;
  hasReview: boolean;
}

function canLeaveReview(
  bookings: CompletedBooking[],
  userId: string,
  venueId: string
): { can: boolean; bookingId: string | null } {
  const eligible = bookings.find(
    (b) => b.userId === userId && b.venueId === venueId && !b.hasReview
  );
  return eligible
    ? { can: true, bookingId: eligible.bookingId }
    : { can: false, bookingId: null };
}

function markBookingReviewed(
  bookings: CompletedBooking[],
  bookingId: string
): CompletedBooking[] {
  return bookings.map((b) => (b.bookingId === bookingId ? { ...b, hasReview: true } : b));
}

function verifiedReviewScore(reviews: TrustedReview[], venueId: string): number {
  const verified = reviews.filter((r) => r.venueId === venueId && r.isVerified);
  if (verified.length === 0) return 0;
  return Math.round(
    (verified.reduce((s, r) => s + r.rating, 0) / verified.length) * 10
  ) / 10;
}

function unreviewedBookings(bookings: CompletedBooking[], userId: string): CompletedBooking[] {
  return bookings.filter((b) => b.userId === userId && !b.hasReview);
}

const NOW = 1_700_000_000_000;
const BOOKINGS: CompletedBooking[] = [
  { bookingId: "b1", userId: "u1", venueId: "v1", completedAt: NOW - 86_400_000, hasReview: false },
  { bookingId: "b2", userId: "u1", venueId: "v2", completedAt: NOW - 172_800_000, hasReview: true  },
  { bookingId: "b3", userId: "u2", venueId: "v1", completedAt: NOW - 43_200_000, hasReview: false  },
];

const REVIEWS: TrustedReview[] = [
  { reviewId: "r1", userId: "u2", venueId: "v1", bookingId: "b3", rating: 5, content: "Great!", submittedAt: NOW - 1000, isVerified: true  },
  { reviewId: "r2", userId: "u3", venueId: "v1", bookingId: "x1", rating: 1, content: "Fake",   submittedAt: NOW - 500,  isVerified: false },
];

describe("Trust-based venue review gating", () => {
  it("canLeaveReview: u1 has unreviewed v1 booking → can", () => {
    const result = canLeaveReview(BOOKINGS, "u1", "v1");
    expect(result.can).toBe(true);
    expect(result.bookingId).toBe("b1");
  });

  it("canLeaveReview: u1 already reviewed v2 → cannot", () => {
    expect(canLeaveReview(BOOKINGS, "u1", "v2").can).toBe(false);
  });

  it("canLeaveReview: no booking at all → cannot", () => {
    expect(canLeaveReview(BOOKINGS, "u99", "v1").can).toBe(false);
  });

  it("markBookingReviewed: sets hasReview true", () => {
    const updated = markBookingReviewed(BOOKINGS, "b1");
    expect(updated.find((b) => b.bookingId === "b1")!.hasReview).toBe(true);
  });

  it("verifiedReviewScore: only verified reviews count", () => {
    expect(verifiedReviewScore(REVIEWS, "v1")).toBe(5.0); // only r1 (verified)
  });

  it("verifiedReviewScore: no verified reviews → 0", () => {
    expect(verifiedReviewScore(REVIEWS, "v2")).toBe(0);
  });

  it("unreviewedBookings: u1 has 1 unreviewed", () => {
    expect(unreviewedBookings(BOOKINGS, "u1")).toHaveLength(1);
  });
});
