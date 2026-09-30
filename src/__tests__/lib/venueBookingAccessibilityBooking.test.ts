/**
 * Tests for venue accessibility feature booking requirements validation.
 */

type AccessibilityFeature =
  | "wheelchair_ramp"
  | "elevator"
  | "accessible_toilet"
  | "hearing_loop"
  | "braille_signage"
  | "guide_dog_friendly"
  | "accessible_parking"
  | "lowered_counter";

interface AccessibilityRequirement {
  feature: AccessibilityFeature;
  required: boolean;
  preferred: boolean;
}

interface VenueAccessibility {
  venueId: string;
  features: AccessibilityFeature[];
  accessibilityScore: number; // 0-100
  lastAuditAt: number;
  certifications: string[];
}

function meetsRequirements(
  venue: VenueAccessibility,
  requirements: AccessibilityRequirement[]
): boolean {
  const required = requirements.filter((r) => r.required);
  return required.every((r) => venue.features.includes(r.feature));
}

function missingRequiredFeatures(
  venue: VenueAccessibility,
  requirements: AccessibilityRequirement[]
): AccessibilityFeature[] {
  return requirements
    .filter((r) => r.required && !venue.features.includes(r.feature))
    .map((r) => r.feature);
}

function accessibilityRating(score: number): "excellent" | "good" | "adequate" | "poor" {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "adequate";
  return "poor";
}

function preferredFeaturesAvailable(
  venue: VenueAccessibility,
  requirements: AccessibilityRequirement[]
): number {
  const preferred = requirements.filter((r) => r.preferred && !r.required);
  const available = preferred.filter((r) => venue.features.includes(r.feature));
  return preferred.length > 0 ? Math.round((available.length / preferred.length) * 100) : 100;
}

const VENUE: VenueAccessibility = {
  venueId: "v1",
  features: ["wheelchair_ramp", "accessible_toilet", "accessible_parking", "guide_dog_friendly"],
  accessibilityScore: 72,
  lastAuditAt: 1_700_000_000_000 - 180 * 86_400_000,
  certifications: ["ISO_21542"],
};

const REQUIREMENTS: AccessibilityRequirement[] = [
  { feature: "wheelchair_ramp",    required: true,  preferred: false },
  { feature: "accessible_toilet",  required: true,  preferred: false },
  { feature: "elevator",           required: false, preferred: true },
  { feature: "hearing_loop",       required: false, preferred: true },
];

describe("Accessibility booking requirements", () => {
  it("meetsRequirements: has both required features → true", () => {
    expect(meetsRequirements(VENUE, REQUIREMENTS)).toBe(true);
  });

  it("meetsRequirements: missing required feature → false", () => {
    const stricter = [...REQUIREMENTS, { feature: "elevator" as AccessibilityFeature, required: true, preferred: false }];
    expect(meetsRequirements(VENUE, stricter)).toBe(false);
  });

  it("missingRequiredFeatures: none missing for current requirements", () => {
    expect(missingRequiredFeatures(VENUE, REQUIREMENTS).length).toBe(0);
  });

  it("accessibilityRating: score 72 → good", () => {
    expect(accessibilityRating(72)).toBe("good");
  });

  it("accessibilityRating: score 85 → excellent", () => {
    expect(accessibilityRating(85)).toBe("excellent");
  });

  it("preferredFeaturesAvailable: 0 of 2 preferred = 0%", () => {
    expect(preferredFeaturesAvailable(VENUE, REQUIREMENTS)).toBe(0);
  });
});
