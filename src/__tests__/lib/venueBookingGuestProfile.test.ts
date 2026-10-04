/**
 * Tests for venue booking guest profile management utilities.
 */

interface GuestProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  totalBookings: number;
  totalSpend: number;
  avgBookingValue: number;
  preferredVenueTypes: string[];
  dietaryRequirements: string[];
  accessibilityNeeds: string[];
  vipStatus: boolean;
  createdAt: number;
  lastBookingAt: number | null;
}

function isVip(profile: GuestProfile): boolean {
  return profile.vipStatus || profile.totalSpend > 10_000 || profile.totalBookings > 20;
}

function guestSegment(profile: GuestProfile): "vip" | "frequent" | "occasional" | "new" {
  if (isVip(profile)) return "vip";
  if (profile.totalBookings >= 10) return "frequent";
  if (profile.totalBookings >= 2)  return "occasional";
  return "new";
}

function profileCompleteness(profile: GuestProfile): number {
  let score = 0;
  if (profile.name)    score += 20;
  if (profile.email)   score += 20;
  if (profile.phone)   score += 15;
  if (profile.company) score += 10;
  if (profile.preferredVenueTypes.length > 0) score += 15;
  if (profile.dietaryRequirements.length > 0 || profile.accessibilityNeeds.length > 0) score += 10;
  if (profile.totalBookings > 0) score += 10;
  return Math.min(score, 100);
}

function daysSinceLastBooking(profile: GuestProfile, nowMs: number): number | null {
  if (!profile.lastBookingAt) return null;
  return Math.floor((nowMs - profile.lastBookingAt) / 86_400_000);
}

function isAtRiskOfChurn(profile: GuestProfile, nowMs: number, days = 90): boolean {
  const since = daysSinceLastBooking(profile, nowMs);
  return since !== null && since > days && profile.totalBookings >= 3;
}

const NOW = 1_700_000_000_000;
const PROFILE: GuestProfile = {
  id: "g1", name: "John Smith", email: "john@example.com", phone: "+44123456789",
  company: "Acme Corp", totalBookings: 15, totalSpend: 8500, avgBookingValue: 567,
  preferredVenueTypes: ["conference", "boardroom"], dietaryRequirements: ["vegan"],
  accessibilityNeeds: [], vipStatus: false, createdAt: NOW - 365 * 86_400_000,
  lastBookingAt: NOW - 100 * 86_400_000,
};

describe("Guest profile management", () => {
  it("guestSegment: 15 bookings → frequent", () => {
    expect(guestSegment(PROFILE)).toBe("frequent");
  });

  it("isVip: $8500 spend, not VIP status → false (< $10k)", () => {
    expect(isVip(PROFILE)).toBe(false);
  });

  it("profileCompleteness: all major fields filled → high", () => {
    expect(profileCompleteness(PROFILE)).toBeGreaterThan(80);
  });

  it("daysSinceLastBooking: 100 days ago", () => {
    expect(daysSinceLastBooking(PROFILE, NOW)).toBe(100);
  });

  it("isAtRiskOfChurn: 100 days since last booking → at risk", () => {
    expect(isAtRiskOfChurn(PROFILE, NOW)).toBe(true);
  });

  it("isAtRiskOfChurn: new user with 1 booking → false", () => {
    const newUser = { ...PROFILE, totalBookings: 1, lastBookingAt: NOW - 200 * 86_400_000 };
    expect(isAtRiskOfChurn(newUser, NOW)).toBe(false);
  });
});
