/**
 * Tests for user profile completeness percentage.
 */

interface UserProfile {
  name?: string;
  bio?: string;
  avatarUrl?: string;
  location?: string;
  jobTitle?: string;
  linkedInUrl?: string;
  preferredAmenities?: string[];
  timezone?: string;
}

const FIELD_WEIGHTS: Record<keyof UserProfile, number> = {
  name:               20,
  bio:                15,
  avatarUrl:          15,
  location:           10,
  jobTitle:           10,
  linkedInUrl:         5,
  preferredAmenities: 15,
  timezone:           10,
};

function profileCompleteness(profile: UserProfile): number {
  let score = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS) as [keyof UserProfile, number][]) {
    const value = profile[field];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    score += weight;
  }
  return score;
}

function completenessLabel(pct: number): "starter" | "growing" | "complete" {
  if (pct < 40)  return "starter";
  if (pct < 80)  return "growing";
  return "complete";
}

describe("User profile completeness", () => {
  it("empty profile → 0%", () => {
    expect(profileCompleteness({})).toBe(0);
  });

  it("name only → 20%", () => {
    expect(profileCompleteness({ name: "Alice" })).toBe(20);
  });

  it("full profile → 100%", () => {
    const full: UserProfile = {
      name: "Alice", bio: "Dev", avatarUrl: "img.png", location: "NYC",
      jobTitle: "Eng", linkedInUrl: "li.com", preferredAmenities: ["wifi"], timezone: "UTC",
    };
    expect(profileCompleteness(full)).toBe(100);
  });

  it("empty preferredAmenities not counted", () => {
    expect(profileCompleteness({ preferredAmenities: [] })).toBe(0);
  });

  it("non-empty preferredAmenities counted", () => {
    expect(profileCompleteness({ preferredAmenities: ["wifi"] })).toBe(15);
  });

  it("label starter < 40", () => {
    expect(completenessLabel(20)).toBe("starter");
  });

  it("label growing 40–79", () => {
    expect(completenessLabel(60)).toBe("growing");
  });

  it("label complete ≥ 80", () => {
    expect(completenessLabel(80)).toBe("complete");
  });
});
