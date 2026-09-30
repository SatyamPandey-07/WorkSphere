/**
 * Tests for smart venue suggestion based on user behavior patterns.
 */

interface UserBehavior {
  userId: string;
  favoriteVenueTypes: string[];
  preferredTimeSlots: string[]; // "morning", "afternoon", "evening"
  averageBookingHours: number;
  frequentlyVisitedAreas: string[];
}

interface VenueSuggestion {
  venueId: string;
  type: string;
  area: string;
  bestTimeSlot: string;
  score: number;
}

function behaviorMatchScore(
  behavior: UserBehavior,
  suggestion: VenueSuggestion
): number {
  let score = 0;
  if (behavior.favoriteVenueTypes.includes(suggestion.type)) score += 3;
  if (behavior.preferredTimeSlots.includes(suggestion.bestTimeSlot)) score += 2;
  if (behavior.frequentlyVisitedAreas.includes(suggestion.area)) score += 4;
  return score;
}

function rankSuggestions(
  behavior: UserBehavior,
  suggestions: VenueSuggestion[]
): VenueSuggestion[] {
  return [...suggestions]
    .map((s) => ({ ...s, score: behaviorMatchScore(behavior, s) }))
    .sort((a, b) => b.score - a.score);
}

function personalizedForUser(
  behavior: UserBehavior,
  suggestions: VenueSuggestion[],
  minScore = 3
): VenueSuggestion[] {
  return rankSuggestions(behavior, suggestions).filter((s) => s.score >= minScore);
}

const BEHAVIOR: UserBehavior = {
  userId: "u1",
  favoriteVenueTypes: ["cafe", "coworking"],
  preferredTimeSlots: ["morning", "afternoon"],
  averageBookingHours: 3,
  frequentlyVisitedAreas: ["downtown", "midtown"],
};

const SUGGESTIONS: VenueSuggestion[] = [
  { venueId: "v1", type: "cafe",     area: "downtown", bestTimeSlot: "morning",   score: 0 }, // match all → 9
  { venueId: "v2", type: "library",  area: "uptown",   bestTimeSlot: "evening",   score: 0 }, // no match → 0
  { venueId: "v3", type: "coworking",area: "midtown",  bestTimeSlot: "afternoon", score: 0 }, // match all → 9
];

describe("Venue smart suggestions", () => {
  it("behaviorMatchScore: v1 matches type+time+area = 9", () => {
    expect(behaviorMatchScore(BEHAVIOR, SUGGESTIONS[0])).toBe(9);
  });

  it("behaviorMatchScore: v2 matches nothing = 0", () => {
    expect(behaviorMatchScore(BEHAVIOR, SUGGESTIONS[1])).toBe(0);
  });

  it("rankSuggestions: sorted by score descending", () => {
    const ranked = rankSuggestions(BEHAVIOR, SUGGESTIONS);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it("personalizedForUser: excludes low-score suggestions", () => {
    const personalized = personalizedForUser(BEHAVIOR, SUGGESTIONS);
    expect(personalized.every((s) => s.score >= 3)).toBe(true);
  });

  it("personalizedForUser: v2 (score 0) excluded", () => {
    const personalized = personalizedForUser(BEHAVIOR, SUGGESTIONS);
    expect(personalized.map((s) => s.venueId)).not.toContain("v2");
  });

  it("personalizedForUser: minScore 0 includes all", () => {
    expect(personalizedForUser(BEHAVIOR, SUGGESTIONS, 0)).toHaveLength(3);
  });

  it("rankSuggestions: immutable", () => {
    const originalOrder = SUGGESTIONS.map((s) => s.venueId);
    rankSuggestions(BEHAVIOR, SUGGESTIONS);
    expect(SUGGESTIONS.map((s) => s.venueId)).toEqual(originalOrder);
  });
});
