/**
 * Tests for venue booking overall experience composite score.
 */

interface BookingExperienceData {
  bookingId: string;
  checkinExperience: number;    // 1-5
  spaceQuality: number;         // 1-5
  amenitiesRating: number;      // 1-5
  staffInteraction: number;     // 1-5 (0 if no staff)
  valueForMoney: number;        // 1-5
  wouldReturn: boolean;
  recommendToFriend: boolean;
}

const EXPERIENCE_WEIGHTS = {
  checkinExperience: 0.15,
  spaceQuality:      0.25,
  amenitiesRating:   0.20,
  staffInteraction:  0.10,
  valueForMoney:     0.20,
  wouldReturn:       0.05,
  recommendToFriend: 0.05,
};

function compositeExperienceScore(data: BookingExperienceData): number {
  const baseScore =
    data.checkinExperience  * EXPERIENCE_WEIGHTS.checkinExperience +
    data.spaceQuality        * EXPERIENCE_WEIGHTS.spaceQuality +
    data.amenitiesRating     * EXPERIENCE_WEIGHTS.amenitiesRating +
    data.staffInteraction    * EXPERIENCE_WEIGHTS.staffInteraction +
    data.valueForMoney       * EXPERIENCE_WEIGHTS.valueForMoney;

  const booleanBonus =
    (data.wouldReturn ? 5 : 1) * EXPERIENCE_WEIGHTS.wouldReturn +
    (data.recommendToFriend ? 5 : 1) * EXPERIENCE_WEIGHTS.recommendToFriend;

  return Math.round((baseScore + booleanBonus) * 20) / 20; // 0.05 precision
}

function experienceGrade(score: number): "poor" | "fair" | "good" | "excellent" | "outstanding" {
  if (score >= 4.5) return "outstanding";
  if (score >= 4.0) return "excellent";
  if (score >= 3.5) return "good";
  if (score >= 2.5) return "fair";
  return "poor";
}

function avgExperienceForVenue(
  experiences: BookingExperienceData[],
  venueId: string
): number {
  // Simplified: just avg all provided experiences
  if (experiences.length === 0) return 0;
  const scores = experiences.map(compositeExperienceScore);
  return Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
}

const PERFECT: BookingExperienceData = {
  bookingId: "b1", checkinExperience: 5, spaceQuality: 5, amenitiesRating: 5,
  staffInteraction: 5, valueForMoney: 5, wouldReturn: true, recommendToFriend: true,
};

const POOR_EXP: BookingExperienceData = {
  bookingId: "b2", checkinExperience: 2, spaceQuality: 2, amenitiesRating: 1,
  staffInteraction: 1, valueForMoney: 2, wouldReturn: false, recommendToFriend: false,
};

describe("Venue booking experience score", () => {
  it("compositeExperienceScore: perfect → near 5", () => {
    expect(compositeExperienceScore(PERFECT)).toBeCloseTo(5, 0);
  });

  it("compositeExperienceScore: poor → below 2.5", () => {
    expect(compositeExperienceScore(POOR_EXP)).toBeLessThan(2.5);
  });

  it("experienceGrade: 4.8 → outstanding", () => {
    expect(experienceGrade(4.8)).toBe("outstanding");
  });

  it("experienceGrade: 3.0 → fair", () => {
    expect(experienceGrade(3.0)).toBe("fair");
  });

  it("experienceGrade: 1.5 → poor", () => {
    expect(experienceGrade(1.5)).toBe("poor");
  });

  it("wouldReturn=true adds to score", () => {
    const withReturn = compositeExperienceScore(PERFECT);
    const withoutReturn = compositeExperienceScore({ ...PERFECT, wouldReturn: false });
    expect(withReturn).toBeGreaterThan(withoutReturn);
  });

  it("avgExperienceForVenue: empty → 0", () => {
    expect(avgExperienceForVenue([], "v1")).toBe(0);
  });
});
