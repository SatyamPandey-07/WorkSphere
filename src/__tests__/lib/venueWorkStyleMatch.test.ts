/**
 * Tests for venue work style compatibility matching.
 */

type WorkStyle = "focused" | "collaborative" | "creative" | "social" | "hybrid";

interface VenueWorkProfile {
  venueId: string;
  supportedStyles: WorkStyle[];
  noiseLevel: "silent" | "quiet" | "moderate" | "lively";
  layout: "open" | "semi-private" | "private" | "mixed";
  communityEvents: boolean;
}

function styleCompatibilityScore(
  userStyles: WorkStyle[],
  venue: VenueWorkProfile
): number {
  const matched = userStyles.filter((s) => venue.supportedStyles.includes(s)).length;
  if (userStyles.length === 0) return 0;
  return Math.round((matched / userStyles.length) * 100);
}

function isGoodFocusVenue(venue: VenueWorkProfile): boolean {
  return (
    (venue.noiseLevel === "silent" || venue.noiseLevel === "quiet") &&
    venue.supportedStyles.includes("focused")
  );
}

function isGoodCollaborationVenue(venue: VenueWorkProfile): boolean {
  return (
    venue.supportedStyles.includes("collaborative") &&
    venue.communityEvents
  );
}

function venueWorkStyleLabel(venue: VenueWorkProfile): string {
  if (venue.supportedStyles.length === 0) return "Unclassified";
  if (venue.supportedStyles.includes("focused") && venue.noiseLevel === "silent") return "Deep Work Haven";
  if (venue.supportedStyles.includes("social") && venue.communityEvents) return "Community Hub";
  if (venue.supportedStyles.includes("collaborative")) return "Team Space";
  return "General Workspace";
}

const FOCUS_VENUE: VenueWorkProfile = {
  venueId: "v1", supportedStyles: ["focused", "hybrid"],
  noiseLevel: "quiet", layout: "semi-private", communityEvents: false,
};

const SOCIAL_VENUE: VenueWorkProfile = {
  venueId: "v2", supportedStyles: ["social", "collaborative", "creative"],
  noiseLevel: "lively", layout: "open", communityEvents: true,
};

describe("Venue work style matching", () => {
  it("styleCompatibilityScore: perfect match = 100%", () => {
    expect(styleCompatibilityScore(["focused", "hybrid"], FOCUS_VENUE)).toBe(100);
  });

  it("styleCompatibilityScore: no match = 0%", () => {
    expect(styleCompatibilityScore(["social"], FOCUS_VENUE)).toBe(0);
  });

  it("styleCompatibilityScore: partial match", () => {
    expect(styleCompatibilityScore(["focused", "social"], FOCUS_VENUE)).toBe(50);
  });

  it("isGoodFocusVenue: quiet + focused → true", () => {
    expect(isGoodFocusVenue(FOCUS_VENUE)).toBe(true);
  });

  it("isGoodFocusVenue: lively venue → false", () => {
    expect(isGoodFocusVenue(SOCIAL_VENUE)).toBe(false);
  });

  it("isGoodCollaborationVenue: social venue → true", () => {
    expect(isGoodCollaborationVenue(SOCIAL_VENUE)).toBe(true);
  });

  it("venueWorkStyleLabel: quiet focused → 'Deep Work Haven'", () => {
    expect(venueWorkStyleLabel(FOCUS_VENUE)).toBe("Deep Work Haven");
  });

  it("venueWorkStyleLabel: social with events → 'Community Hub'", () => {
    const socialHub = { ...SOCIAL_VENUE, supportedStyles: ["social"] as WorkStyle[] };
    expect(venueWorkStyleLabel(socialHub)).toBe("Community Hub");
  });
});
