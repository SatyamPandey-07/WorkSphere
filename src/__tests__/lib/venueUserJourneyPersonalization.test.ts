/**
 * Tests for end-to-end user journey personalization.
 */

interface UserJourneyProfile {
  userId: string;
  isFirstVisit: boolean;
  hasActiveBooking: boolean;
  membershipLevel: "none" | "basic" | "premium";
  preferredCategories: string[];
  nearbyVenueIds: string[];
  recentlyViewedIds: string[];
}

interface PagePersonalization {
  heroMessage: string;
  ctaText: string;
  featuredSection: string;
  recommendedVenues: string[];
}

function personalizePage(profile: UserJourneyProfile): PagePersonalization {
  let heroMessage: string;
  let ctaText: string;
  let featuredSection: string;

  if (profile.isFirstVisit) {
    heroMessage = "Find your perfect workspace";
    ctaText = "Explore Venues";
    featuredSection = "popular_venues";
  } else if (profile.hasActiveBooking) {
    heroMessage = `Welcome back! Your booking is ready.`;
    ctaText = "View Booking";
    featuredSection = "upcoming_bookings";
  } else if (profile.membershipLevel === "premium") {
    heroMessage = "Your exclusive member spaces await";
    ctaText = "Browse Premium";
    featuredSection = "premium_venues";
  } else {
    heroMessage = "Continue your workspace journey";
    ctaText = "Book Again";
    featuredSection = "recommended_venues";
  }

  // Prioritize nearby, then recently viewed, then category-based
  const recommendedVenues = [
    ...profile.nearbyVenueIds.slice(0, 2),
    ...profile.recentlyViewedIds.filter((id) => !profile.nearbyVenueIds.includes(id)).slice(0, 2),
  ];

  return { heroMessage, ctaText, featuredSection, recommendedVenues };
}

function personalizedEmailSubject(profile: UserJourneyProfile): string {
  if (profile.hasActiveBooking) return "Your upcoming booking reminder";
  if (profile.membershipLevel === "premium") return "Exclusive spaces for premium members";
  if (profile.preferredCategories.length > 0) return `${profile.preferredCategories[0]} spaces near you`;
  return "Discover workspaces near you";
}

describe("User journey personalization", () => {
  const FIRST_VISIT: UserJourneyProfile = {
    userId: "u1", isFirstVisit: true, hasActiveBooking: false,
    membershipLevel: "none", preferredCategories: ["cafe"], nearbyVenueIds: ["v1", "v2"],
    recentlyViewedIds: [],
  };

  const PREMIUM_USER: UserJourneyProfile = {
    userId: "u2", isFirstVisit: false, hasActiveBooking: false,
    membershipLevel: "premium", preferredCategories: ["coworking"], nearbyVenueIds: ["v3"],
    recentlyViewedIds: ["v4", "v5"],
  };

  const ACTIVE_BOOKING_USER: UserJourneyProfile = {
    userId: "u3", isFirstVisit: false, hasActiveBooking: true,
    membershipLevel: "basic", preferredCategories: [], nearbyVenueIds: ["v1"],
    recentlyViewedIds: [],
  };

  it("personalizePage: first visit → explore CTA", () => {
    const page = personalizePage(FIRST_VISIT);
    expect(page.ctaText).toBe("Explore Venues");
    expect(page.featuredSection).toBe("popular_venues");
  });

  it("personalizePage: active booking → booking CTA", () => {
    const page = personalizePage(ACTIVE_BOOKING_USER);
    expect(page.ctaText).toBe("View Booking");
  });

  it("personalizePage: premium → premium featured section", () => {
    const page = personalizePage(PREMIUM_USER);
    expect(page.featuredSection).toBe("premium_venues");
  });

  it("personalizePage: recommends nearby venues first", () => {
    const page = personalizePage(FIRST_VISIT);
    expect(page.recommendedVenues[0]).toBe("v1");
  });

  it("personalizedEmailSubject: active booking → booking reminder", () => {
    expect(personalizedEmailSubject(ACTIVE_BOOKING_USER)).toContain("booking");
  });

  it("personalizedEmailSubject: premium → exclusive", () => {
    expect(personalizedEmailSubject(PREMIUM_USER)).toContain("exclusive");
  });
});
