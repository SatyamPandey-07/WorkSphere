/**
 * Tests for venue soundproofing quality rating for video calls.
 */

type SoundproofingLevel = "excellent" | "good" | "fair" | "poor";

interface SoundProfile {
  ambientNoiseDb: number;      // measured in dB
  wallInsulationRating: number; // 1-5
  hasAcousticPanels: boolean;
  isEnclosed: boolean;
  adjacentNoisyArea: boolean;
}

function soundproofingScore(profile: SoundProfile): number {
  let score = 0;

  // Ambient noise (lower is better)
  if (profile.ambientNoiseDb < 30) score += 30;
  else if (profile.ambientNoiseDb < 50) score += 20;
  else if (profile.ambientNoiseDb < 65) score += 10;

  // Wall insulation
  score += profile.wallInsulationRating * 8;   // up to 40

  // Features
  if (profile.hasAcousticPanels) score += 15;
  if (profile.isEnclosed) score += 10;
  if (profile.adjacentNoisyArea) score -= 15;  // penalty

  return Math.max(0, Math.min(score, 100));
}

function soundproofingLevel(score: number): SoundproofingLevel {
  if (score >= 75) return "excellent";
  if (score >= 50) return "good";
  if (score >= 25) return "fair";
  return "poor";
}

function isVideoCallSuitable(profile: SoundProfile): boolean {
  const score = soundproofingScore(profile);
  return score >= 50 && profile.ambientNoiseDb < 55;
}

const GOOD_PROFILE: SoundProfile = {
  ambientNoiseDb: 25, wallInsulationRating: 4,
  hasAcousticPanels: true, isEnclosed: true, adjacentNoisyArea: false,
};

const POOR_PROFILE: SoundProfile = {
  ambientNoiseDb: 70, wallInsulationRating: 2,
  hasAcousticPanels: false, isEnclosed: false, adjacentNoisyArea: true,
};

describe("Venue soundproofing rating", () => {
  it("soundproofingScore: good profile scores high", () => {
    expect(soundproofingScore(GOOD_PROFILE)).toBeGreaterThan(70);
  });

  it("soundproofingScore: poor profile scores low", () => {
    expect(soundproofingScore(POOR_PROFILE)).toBeLessThan(40);
  });

  it("soundproofingScore: noisy area penalty reduces score", () => {
    const withNoise = { ...GOOD_PROFILE, adjacentNoisyArea: true };
    expect(soundproofingScore(withNoise)).toBeLessThan(soundproofingScore(GOOD_PROFILE));
  });

  it("soundproofingLevel: excellent for good profile", () => {
    expect(soundproofingLevel(soundproofingScore(GOOD_PROFILE))).toBe("excellent");
  });

  it("soundproofingLevel: poor for bad profile", () => {
    expect(soundproofingLevel(soundproofingScore(POOR_PROFILE))).toBe("poor");
  });

  it("isVideoCallSuitable: good profile → true", () => {
    expect(isVideoCallSuitable(GOOD_PROFILE)).toBe(true);
  });

  it("isVideoCallSuitable: poor profile → false", () => {
    expect(isVideoCallSuitable(POOR_PROFILE)).toBe(false);
  });
});
