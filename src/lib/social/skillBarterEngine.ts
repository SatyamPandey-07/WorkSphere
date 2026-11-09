/**
 * skillBarterEngine.ts
 * Core domain types and bidirectional matching logic for On-Site Nomad Skill Barters.
 * Connects digital nomads in the same workspace for quick, high-value 15-to-30 minute peer knowledge exchanges.
 */

export type SkillCategory =
  | "CODE_DEV"
  | "DESIGN_UI"
  | "LEGAL_VISA"
  | "GROWTH_MARKETING"
  | "PRODUCT_PITCH"
  | "LANGUAGE_CULTURE";

export interface SkillListing {
  id: string;
  venueId: string;
  venueName: string;
  userId: string;
  userName: string;
  userTitle: string;
  avatarUrl?: string;
  offeringSkill: string;
  offeringCategory: SkillCategory;
  seekingSkill: string;
  seekingCategory: SkillCategory;
  durationMinutes: 15 | 30 | 45;
  meetupSpot: string; // e.g., "Lounge Table #4", "Terrace Coffee Bar", "Booth 2"
  status: "OPEN" | "MATCHED" | "COMPLETED";
  reputationScore: number; // 0 to 100
  createdAt: string;
}

export interface BarterMatchResult {
  listingA: SkillListing;
  listingB: SkillListing;
  compatibilityScore: number; // 0 to 100
  reason: string;
}

/**
 * Identifies bidirectional complementary skill matches between nomads in the same venue.
 * (e.g. User A offers TypeScript & seeks Figma UI; User B offers Figma UI & seeks TypeScript).
 */
export function findComplementaryBarters(
  listings: SkillListing[],
  currentUserId?: string
): BarterMatchResult[] {
  const openListings = listings.filter((l) => l.status === "OPEN");
  const matches: BarterMatchResult[] = [];

  for (let i = 0; i < openListings.length; i++) {
    for (let j = i + 1; j < openListings.length; j++) {
      const a = openListings[i];
      const b = openListings[j];

      // Ignore self-matching
      if (a.userId === b.userId) continue;

      // Check for bidirectional category harmony
      const aOffersWhatBSeeks = a.offeringCategory === b.seekingCategory;
      const bOffersWhatASeeks = b.offeringCategory === a.seekingCategory;

      if (aOffersWhatBSeeks && bOffersWhatASeeks) {
        matches.push({
          listingA: a,
          listingB: b,
          compatibilityScore: 98,
          reason: `Perfect Match: ${a.userName} offers ${a.offeringSkill} for ${a.seekingSkill}, matching ${b.userName}'s expertise!`,
        });
      } else if (aOffersWhatBSeeks || bOffersWhatASeeks) {
        matches.push({
          listingA: a,
          listingB: b,
          compatibilityScore: 75,
          reason: `Partial Match: Shared interest in ${aOffersWhatBSeeks ? a.offeringCategory : b.offeringCategory}`,
        });
      }
    }
  }

  // If user specified, prioritize matches involving current user
  if (currentUserId) {
    matches.sort((a, b) => {
      const aHasUser = a.listingA.userId === currentUserId || a.listingB.userId === currentUserId ? 1 : 0;
      const bHasUser = b.listingA.userId === currentUserId || b.listingB.userId === currentUserId ? 1 : 0;
      return bHasUser - aHasUser || b.compatibilityScore - a.compatibilityScore;
    });
  }

  return matches;
}

export interface BarterHourBalance {
  earnedMinutes: number;
  spentMinutes: number;
  netBalanceMinutes: number;
  netBalanceHours: number;
  canRedeemSession: (durationMinutes: number) => boolean;
}

/**
 * Calculates a nomad's peer skill barter hour balance.
 * Guards against negative balances and non-finite inputs.
 */
export function calculateBarterHourBalance(
  earnedMinutes: number,
  spentMinutes: number
): BarterHourBalance {
  const safeEarned = Math.max(0, Number.isFinite(earnedMinutes) ? earnedMinutes : 0);
  const safeSpent = Math.max(0, Number.isFinite(spentMinutes) ? spentMinutes : 0);

  const netBalanceMinutes = Math.max(0, safeEarned - safeSpent);
  const netBalanceHours = Math.max(0, Number((netBalanceMinutes / 60).toFixed(1)));

  return {
    earnedMinutes: safeEarned,
    spentMinutes: safeSpent,
    netBalanceMinutes,
    netBalanceHours,
    canRedeemSession: (durationMinutes: number) =>
      netBalanceMinutes >= Math.max(0, Number.isFinite(durationMinutes) ? durationMinutes : 0),
  };
}

