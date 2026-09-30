/**
 * Tests for venue workspace network effect metrics.
 */

interface VenueNetworkMetrics {
  venueId: string;
  activeMembers: number;
  connectedVenueIds: string[];
  sharedMemberCount: number;   // members at multiple connected venues
  eventAttendees: number;
  communityPosts: number;
  collaborations: number;      // successful member-to-member collaborations
}

function networkDensity(metrics: VenueNetworkMetrics): number {
  if (metrics.activeMembers === 0) return 0;
  const possibleConnections = (metrics.activeMembers * (metrics.activeMembers - 1)) / 2;
  if (possibleConnections === 0) return 0;
  return Math.round((metrics.collaborations / possibleConnections) * 1000) / 10;
}

function networkValue(metrics: VenueNetworkMetrics): number {
  // Metcalfe's law variant
  return metrics.activeMembers * (metrics.activeMembers - 1);
}

function crossVenueEngagement(metrics: VenueNetworkMetrics): number {
  if (metrics.activeMembers === 0) return 0;
  return Math.round((metrics.sharedMemberCount / metrics.activeMembers) * 100);
}

function communityHealthIndex(metrics: VenueNetworkMetrics): number {
  if (metrics.activeMembers === 0) return 0;
  const eventsPerMember = metrics.eventAttendees / metrics.activeMembers;
  const postsPerMember = metrics.communityPosts / metrics.activeMembers;
  const collabPerMember = metrics.collaborations / metrics.activeMembers;
  return Math.round((eventsPerMember + postsPerMember * 0.5 + collabPerMember * 2) * 10);
}

const METRICS: VenueNetworkMetrics = {
  venueId: "v1", activeMembers: 100,
  connectedVenueIds: ["v2", "v3"], sharedMemberCount: 25,
  eventAttendees: 200, communityPosts: 150, collaborations: 30,
};

describe("Venue workspace network effect", () => {
  it("networkDensity: 30 collaborations among 100 members = 0.6%", () => {
    // 100×99/2 = 4950 possible; 30/4950 ≈ 0.6
    expect(networkDensity(METRICS)).toBeCloseTo(0.6, 0);
  });

  it("networkValue: n×(n-1) = 100×99 = 9900", () => {
    expect(networkValue(METRICS)).toBe(9900);
  });

  it("crossVenueEngagement: 25/100 = 25%", () => {
    expect(crossVenueEngagement(METRICS)).toBe(25);
  });

  it("crossVenueEngagement: 0 members → 0", () => {
    expect(crossVenueEngagement({ ...METRICS, activeMembers: 0 })).toBe(0);
  });

  it("communityHealthIndex: positive for active community", () => {
    expect(communityHealthIndex(METRICS)).toBeGreaterThan(0);
  });

  it("networkDensity: single member → 0", () => {
    expect(networkDensity({ ...METRICS, activeMembers: 1 })).toBe(0);
  });
});
