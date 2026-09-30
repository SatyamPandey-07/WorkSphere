/**
 * Tests for workspace collaboration score based on features.
 */

interface CollaborationFeatures {
  hasWhiteboards: boolean;
  hasProjectors: boolean;
  hasVideoConferencing: boolean;
  hasCollaborationSoftware: boolean; // Miro, Figma, etc.
  hasBreakoutRooms: boolean;
  maxGroupSize: number;
}

const COLLAB_WEIGHTS = {
  hasWhiteboards:            15,
  hasProjectors:             10,
  hasVideoConferencing:      20,
  hasCollaborationSoftware:  25,
  hasBreakoutRooms:          15,
};

const GROUP_SIZE_SCORE = (size: number) => Math.min(15, Math.floor(size / 5) * 3);

function collaborationScore(features: CollaborationFeatures): number {
  const featureScore = (Object.entries(COLLAB_WEIGHTS) as [keyof typeof COLLAB_WEIGHTS, number][])
    .filter(([k]) => features[k])
    .reduce((sum, [, v]) => sum + v, 0);
  return featureScore + GROUP_SIZE_SCORE(features.maxGroupSize);
}

function collaborationTier(score: number): "basic" | "good" | "excellent" {
  if (score >= 70) return "excellent";
  if (score >= 40) return "good";
  return "basic";
}

function isIdealForRemoteTeam(features: CollaborationFeatures): boolean {
  return features.hasVideoConferencing && features.hasCollaborationSoftware && features.maxGroupSize >= 10;
}

const FULL_FEATURES: CollaborationFeatures = {
  hasWhiteboards: true, hasProjectors: true, hasVideoConferencing: true,
  hasCollaborationSoftware: true, hasBreakoutRooms: true, maxGroupSize: 20,
};

const NO_FEATURES: CollaborationFeatures = {
  hasWhiteboards: false, hasProjectors: false, hasVideoConferencing: false,
  hasCollaborationSoftware: false, hasBreakoutRooms: false, maxGroupSize: 0,
};

describe("Workspace collaboration score", () => {
  it("full features score: 85 + group size bonus", () => {
    const score = collaborationScore(FULL_FEATURES);
    expect(score).toBeGreaterThanOrEqual(85);
  });

  it("no features: group size 0 → score 0", () => {
    expect(collaborationScore(NO_FEATURES)).toBe(0);
  });

  it("video conferencing only: 20 pts", () => {
    const f = { ...NO_FEATURES, hasVideoConferencing: true };
    expect(collaborationScore(f)).toBe(20);
  });

  it("collaborationTier: excellent for high score", () => {
    expect(collaborationTier(collaborationScore(FULL_FEATURES))).toBe("excellent");
  });

  it("collaborationTier: basic for low score", () => {
    expect(collaborationTier(5)).toBe("basic");
  });

  it("collaborationTier: good for mid range", () => {
    expect(collaborationTier(55)).toBe("good");
  });

  it("isIdealForRemoteTeam: needs video + software + 10+ capacity", () => {
    const good = { ...NO_FEATURES, hasVideoConferencing: true, hasCollaborationSoftware: true, maxGroupSize: 10 };
    expect(isIdealForRemoteTeam(good)).toBe(true);
  });

  it("isIdealForRemoteTeam: small group fails", () => {
    const small = { ...NO_FEATURES, hasVideoConferencing: true, hasCollaborationSoftware: true, maxGroupSize: 5 };
    expect(isIdealForRemoteTeam(small)).toBe(false);
  });
});
