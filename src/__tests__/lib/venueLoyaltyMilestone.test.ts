/**
 * Tests for venue-specific loyalty milestone rewards.
 */

interface VenueLoyaltyMilestone {
  milestoneId: string;
  venueId: string;
  name: string;
  description: string;
  visitsRequired: number;
  rewardType: "discount" | "free_booking" | "upgrade" | "gift";
  rewardValue: number; // % or cents
  validDays: number;
}

interface UserVenueVisits {
  userId: string;
  venueId: string;
  totalVisits: number;
  claimedMilestoneIds: string[];
}

function eligibleMilestones(
  milestones: VenueLoyaltyMilestone[],
  userVisits: UserVenueVisits
): VenueLoyaltyMilestone[] {
  return milestones.filter(
    (m) =>
      m.venueId === userVisits.venueId &&
      userVisits.totalVisits >= m.visitsRequired &&
      !userVisits.claimedMilestoneIds.includes(m.milestoneId)
  );
}

function visitsUntilNextMilestone(
  milestones: VenueLoyaltyMilestone[],
  userVisits: UserVenueVisits
): number | null {
  const venueMilestones = milestones
    .filter((m) => m.venueId === userVisits.venueId && userVisits.totalVisits < m.visitsRequired)
    .sort((a, b) => a.visitsRequired - b.visitsRequired);
  if (venueMilestones.length === 0) return null;
  return venueMilestones[0].visitsRequired - userVisits.totalVisits;
}

function claimMilestone(
  userVisits: UserVenueVisits,
  milestoneId: string
): UserVenueVisits {
  if (userVisits.claimedMilestoneIds.includes(milestoneId)) return userVisits;
  return { ...userVisits, claimedMilestoneIds: [...userVisits.claimedMilestoneIds, milestoneId] };
}

const MILESTONES: VenueLoyaltyMilestone[] = [
  { milestoneId: "m1", venueId: "v1", name: "Regular",    description: "5 visits",  visitsRequired: 5,  rewardType: "discount",      rewardValue: 10, validDays: 30 },
  { milestoneId: "m2", venueId: "v1", name: "Loyal",      description: "10 visits", visitsRequired: 10, rewardType: "free_booking",   rewardValue: 1,  validDays: 30 },
  { milestoneId: "m3", venueId: "v1", name: "VIP",        description: "20 visits", visitsRequired: 20, rewardType: "upgrade",        rewardValue: 1,  validDays: 60 },
  { milestoneId: "m4", venueId: "v2", name: "Guest",      description: "3 visits",  visitsRequired: 3,  rewardType: "discount",       rewardValue: 5,  validDays: 14 },
];

const USER_VISITS: UserVenueVisits = {
  userId: "u1", venueId: "v1", totalVisits: 12, claimedMilestoneIds: ["m1"],
};

describe("Venue loyalty milestones", () => {
  it("eligibleMilestones: 12 visits at v1, m1 claimed → m2 eligible", () => {
    const eligible = eligibleMilestones(MILESTONES, USER_VISITS);
    expect(eligible.map((m) => m.milestoneId)).toContain("m2");
    expect(eligible.map((m) => m.milestoneId)).not.toContain("m1"); // already claimed
  });

  it("eligibleMilestones: m3 not eligible (needs 20 visits)", () => {
    const eligible = eligibleMilestones(MILESTONES, USER_VISITS);
    expect(eligible.map((m) => m.milestoneId)).not.toContain("m3");
  });

  it("visitsUntilNextMilestone: 8 more visits for m3", () => {
    expect(visitsUntilNextMilestone(MILESTONES, USER_VISITS)).toBe(8); // m3 at 20, user at 12
  });

  it("visitsUntilNextMilestone: all milestones reached → null", () => {
    const maxVisits = { ...USER_VISITS, totalVisits: 100 };
    expect(visitsUntilNextMilestone(MILESTONES, maxVisits)).toBeNull();
  });

  it("claimMilestone: adds to claimed list", () => {
    const updated = claimMilestone(USER_VISITS, "m2");
    expect(updated.claimedMilestoneIds).toContain("m2");
  });

  it("claimMilestone: duplicate claim no-op", () => {
    const updated = claimMilestone(USER_VISITS, "m1"); // already claimed
    expect(updated.claimedMilestoneIds.filter((id) => id === "m1")).toHaveLength(1);
  });
});
