/**
 * Tests for overall workspace quality score combining all dimensions.
 */

interface WorkspaceQualityFactors {
  wifiScore: number;         // 0-100
  noiseLevelScore: number;   // 0-100 (100 = very quiet)
  comfortScore: number;      // 0-100
  lightingScore: number;     // 0-100
  amenitiesScore: number;    // 0-100
  locationScore: number;     // 0-100
  valueScore: number;        // 0-100
  cleanlinessScore: number;  // 0-100
}

const WORKSPACE_WEIGHTS = {
  wifiScore:        0.15,
  noiseLevelScore:  0.20,
  comfortScore:     0.15,
  lightingScore:    0.10,
  amenitiesScore:   0.10,
  locationScore:    0.10,
  valueScore:       0.12,
  cleanlinessScore: 0.08,
};

function workspaceQualityScore(factors: WorkspaceQualityFactors): number {
  let score = 0;
  for (const [key, weight] of Object.entries(WORKSPACE_WEIGHTS)) {
    score += (factors[key as keyof WorkspaceQualityFactors] ?? 0) * weight;
  }
  return Math.round(score * 10) / 10;
}

function workspaceRating(score: number): number {
  return Math.round((score / 100) * 5 * 10) / 10;
}

function weakestDimension(factors: WorkspaceQualityFactors): keyof WorkspaceQualityFactors {
  let min = Infinity;
  let weakest: keyof WorkspaceQualityFactors = "wifiScore";
  for (const [key, value] of Object.entries(factors) as [keyof WorkspaceQualityFactors, number][]) {
    if (value < min) { min = value; weakest = key; }
  }
  return weakest;
}

function improvementImpact(dimension: keyof WorkspaceQualityFactors, improvementPoints: number): number {
  const weight = WORKSPACE_WEIGHTS[dimension] ?? 0;
  return Math.round(improvementPoints * weight * 10) / 10;
}

const PERFECT: WorkspaceQualityFactors = {
  wifiScore: 100, noiseLevelScore: 100, comfortScore: 100, lightingScore: 100,
  amenitiesScore: 100, locationScore: 100, valueScore: 100, cleanlinessScore: 100,
};

const TYPICAL: WorkspaceQualityFactors = {
  wifiScore: 80, noiseLevelScore: 70, comfortScore: 75, lightingScore: 85,
  amenitiesScore: 60, locationScore: 90, valueScore: 65, cleanlinessScore: 90,
};

describe("Workspace quality score", () => {
  it("workspaceQualityScore: perfect = 100", () => {
    expect(workspaceQualityScore(PERFECT)).toBe(100);
  });

  it("workspaceQualityScore: typical workspace ≈ 76", () => {
    const score = workspaceQualityScore(TYPICAL);
    expect(score).toBeGreaterThan(70);
    expect(score).toBeLessThan(90);
  });

  it("workspaceRating: 80 score → 4.0 stars", () => {
    expect(workspaceRating(80)).toBe(4);
  });

  it("workspaceRating: 100 score → 5.0 stars", () => {
    expect(workspaceRating(100)).toBe(5);
  });

  it("weakestDimension: finds lowest factor", () => {
    const weak = weakestDimension(TYPICAL);
    expect(TYPICAL[weak]).toBeLessThanOrEqual(60); // amenitiesScore=60 is lowest
  });

  it("improvementImpact: noise (0.20 weight) 10pt improvement = 2.0", () => {
    expect(improvementImpact("noiseLevelScore", 10)).toBe(2);
  });

  it("improvementImpact: cleaning (0.08 weight) 10pt = 0.8", () => {
    expect(improvementImpact("cleanlinessScore", 10)).toBe(0.8);
  });
});
