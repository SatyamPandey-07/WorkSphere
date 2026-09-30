/**
 * Tests for venue booking call-to-action personalization.
 */

type CtaVariant = "book_now" | "check_availability" | "get_free_trial" | "join_waitlist" | "contact_venue";

interface VenueAvailabilityState {
  venueId: string;
  hasAvailableSlots: boolean;
  hasWaitlist: boolean;
  hasTrialOffer: boolean;
  isNewUser: boolean;
  userHasBookedBefore: boolean;
}

function recommendCta(state: VenueAvailabilityState): CtaVariant {
  if (!state.hasAvailableSlots) {
    return state.hasWaitlist ? "join_waitlist" : "contact_venue";
  }
  if (state.hasTrialOffer && state.isNewUser && !state.userHasBookedBefore) {
    return "get_free_trial";
  }
  if (state.userHasBookedBefore) {
    return "book_now";
  }
  return "check_availability";
}

function ctaLabel(variant: CtaVariant): string {
  const labels: Record<CtaVariant, string> = {
    book_now:           "Book Now",
    check_availability: "Check Availability",
    get_free_trial:     "Start Free Trial",
    join_waitlist:      "Join Waitlist",
    contact_venue:      "Contact Venue",
  };
  return labels[variant];
}

function ctaUrgencyText(state: VenueAvailabilityState, spotsLeft: number): string | null {
  if (!state.hasAvailableSlots) return null;
  if (spotsLeft <= 2) return `Only ${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left!`;
  if (spotsLeft <= 5) return `${spotsLeft} spots remaining`;
  return null;
}

describe("Venue booking CTA personalization", () => {
  const BASE: VenueAvailabilityState = {
    venueId: "v1", hasAvailableSlots: true, hasWaitlist: false,
    hasTrialOffer: false, isNewUser: false, userHasBookedBefore: true,
  };

  it("recommendCta: returning user with slots → book_now", () => {
    expect(recommendCta(BASE)).toBe("book_now");
  });

  it("recommendCta: new user with trial offer → get_free_trial", () => {
    const newWithTrial = { ...BASE, isNewUser: true, userHasBookedBefore: false, hasTrialOffer: true };
    expect(recommendCta(newWithTrial)).toBe("get_free_trial");
  });

  it("recommendCta: no slots + waitlist → join_waitlist", () => {
    expect(recommendCta({ ...BASE, hasAvailableSlots: false, hasWaitlist: true })).toBe("join_waitlist");
  });

  it("recommendCta: no slots + no waitlist → contact_venue", () => {
    expect(recommendCta({ ...BASE, hasAvailableSlots: false, hasWaitlist: false })).toBe("contact_venue");
  });

  it("recommendCta: new user, no trial → check_availability", () => {
    expect(recommendCta({ ...BASE, isNewUser: true, userHasBookedBefore: false })).toBe("check_availability");
  });

  it("ctaLabel: book_now → 'Book Now'", () => {
    expect(ctaLabel("book_now")).toBe("Book Now");
  });

  it("ctaUrgencyText: 1 spot left → singular", () => {
    expect(ctaUrgencyText(BASE, 1)).toBe("Only 1 spot left!");
  });

  it("ctaUrgencyText: 3 spots → remaining", () => {
    expect(ctaUrgencyText(BASE, 3)).toBe("3 spots remaining");
  });

  it("ctaUrgencyText: 10 spots → null", () => {
    expect(ctaUrgencyText(BASE, 10)).toBeNull();
  });

  it("ctaUrgencyText: no slots → null", () => {
    expect(ctaUrgencyText({ ...BASE, hasAvailableSlots: false }, 0)).toBeNull();
  });
});
