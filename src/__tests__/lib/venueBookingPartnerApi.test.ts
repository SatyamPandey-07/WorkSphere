/**
 * Tests for venue booking partner API integration utilities.
 */

type PartnerType = "ota" | "corporate_travel" | "event_planner" | "travel_agency" | "direct";

interface PartnerConfig {
  partnerId: string;
  name: string;
  type: PartnerType;
  commissionRate: number;
  apiVersion: string;
  rateLimitPerMinute: number;
  isActive: boolean;
  contractedVenueIds: string[] | null;
}

interface PartnerBooking {
  externalId: string;
  partnerId: string;
  venueId: string;
  amount: number;
  partnerReference: string;
  syncedAt: number | null;
  reconciled: boolean;
}

function partnerCommission(partner: PartnerConfig, bookingAmount: number): number {
  return Math.round(bookingAmount * partner.commissionRate * 100) / 100;
}

function netRevenueAfterCommission(partner: PartnerConfig, bookingAmount: number): number {
  return Math.round((bookingAmount - partnerCommission(partner, bookingAmount)) * 100) / 100;
}

function isPartnerAllowed(partner: PartnerConfig, venueId: string): boolean {
  if (!partner.isActive) return false;
  if (partner.contractedVenueIds === null) return true;
  return partner.contractedVenueIds.includes(venueId);
}

function unreconciledBookings(bookings: PartnerBooking[]): PartnerBooking[] {
  return bookings.filter((b) => b.syncedAt !== null && !b.reconciled);
}

function totalPartnerRevenue(bookings: PartnerBooking[], partnerId: string): number {
  return Math.round(
    bookings.filter((b) => b.partnerId === partnerId).reduce((s, b) => s + b.amount, 0) * 100
  ) / 100;
}

const PARTNER: PartnerConfig = {
  partnerId: "p1", name: "BookNow OTA", type: "ota", commissionRate: 0.15,
  apiVersion: "v2", rateLimitPerMinute: 60, isActive: true, contractedVenueIds: ["v1", "v2"],
};
const NOW = 1_700_000_000_000;
const BOOKINGS: PartnerBooking[] = [
  { externalId: "ext1", partnerId: "p1", venueId: "v1", amount: 1000, partnerReference: "REF1", syncedAt: NOW, reconciled: false },
  { externalId: "ext2", partnerId: "p1", venueId: "v2", amount: 2000, partnerReference: "REF2", syncedAt: NOW, reconciled: true },
  { externalId: "ext3", partnerId: "p2", venueId: "v1", amount: 500,  partnerReference: "REF3", syncedAt: null, reconciled: false },
];

describe("Partner API integration", () => {
  it("partnerCommission: 15% of $1000 = $150", () => {
    expect(partnerCommission(PARTNER, 1000)).toBe(150);
  });

  it("netRevenueAfterCommission: $1000 - $150 = $850", () => {
    expect(netRevenueAfterCommission(PARTNER, 1000)).toBe(850);
  });

  it("isPartnerAllowed: contracted venue v1 → true", () => {
    expect(isPartnerAllowed(PARTNER, "v1")).toBe(true);
  });

  it("isPartnerAllowed: non-contracted venue v3 → false", () => {
    expect(isPartnerAllowed(PARTNER, "v3")).toBe(false);
  });

  it("unreconciledBookings: ext1 synced but not reconciled", () => {
    const result = unreconciledBookings(BOOKINGS);
    expect(result.map((b) => b.externalId)).toContain("ext1");
  });

  it("totalPartnerRevenue: p1 = $3000", () => {
    expect(totalPartnerRevenue(BOOKINGS, "p1")).toBe(3000);
  });
});
