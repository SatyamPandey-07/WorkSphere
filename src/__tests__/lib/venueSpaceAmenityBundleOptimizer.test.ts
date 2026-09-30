/**
 * Tests for optimal amenity bundle recommendation for a space.
 */

interface Amenity {
  id: string;
  name: string;
  costCents: number;
  popularityScore: number; // 0-100
  isEssential: boolean;
}

interface OptimizationConfig {
  budgetCents: number;
  targetCount: number;
  mustInclude: string[]; // amenity IDs
}

function selectOptimalBundle(
  amenities: Amenity[],
  config: OptimizationConfig
): Amenity[] {
  const essential = amenities.filter(
    (a) => config.mustInclude.includes(a.id) || a.isEssential
  );
  const optionalPool = amenities.filter(
    (a) => !config.mustInclude.includes(a.id) && !a.isEssential
  );

  // Sort optional by popularity/cost ratio
  const ranked = optionalPool
    .map((a) => ({ amenity: a, ratio: a.popularityScore / Math.max(1, a.costCents / 100) }))
    .sort((a, b) => b.ratio - a.ratio)
    .map((a) => a.amenity);

  const selected = [...essential];
  let remainingBudget = config.budgetCents - essential.reduce((s, a) => s + a.costCents, 0);

  for (const amenity of ranked) {
    if (selected.length >= config.targetCount) break;
    if (amenity.costCents <= remainingBudget) {
      selected.push(amenity);
      remainingBudget -= amenity.costCents;
    }
  }

  return selected;
}

function bundleTotalCost(bundle: Amenity[]): number {
  return bundle.reduce((s, a) => s + a.costCents, 0);
}

function bundlePopularityScore(bundle: Amenity[]): number {
  if (bundle.length === 0) return 0;
  return Math.round(bundle.reduce((s, a) => s + a.popularityScore, 0) / bundle.length);
}

const AMENITIES: Amenity[] = [
  { id: "a1", name: "WiFi",       costCents: 0,    popularityScore: 100, isEssential: true  },
  { id: "a2", name: "Coffee",     costCents: 3000, popularityScore: 85,  isEssential: false },
  { id: "a3", name: "Printer",    costCents: 5000, popularityScore: 60,  isEssential: false },
  { id: "a4", name: "Whiteboard", costCents: 2000, popularityScore: 75,  isEssential: false },
  { id: "a5", name: "Monitor",    costCents: 4000, popularityScore: 80,  isEssential: false },
];

describe("Amenity bundle optimizer", () => {
  const CONFIG: OptimizationConfig = {
    budgetCents: 10_000, targetCount: 4, mustInclude: ["a2"],
  };

  it("selectOptimalBundle: includes essential WiFi", () => {
    const bundle = selectOptimalBundle(AMENITIES, CONFIG);
    expect(bundle.some((a) => a.id === "a1")).toBe(true);
  });

  it("selectOptimalBundle: includes mustInclude coffee", () => {
    const bundle = selectOptimalBundle(AMENITIES, CONFIG);
    expect(bundle.some((a) => a.id === "a2")).toBe(true);
  });

  it("selectOptimalBundle: within budget", () => {
    const bundle = selectOptimalBundle(AMENITIES, CONFIG);
    expect(bundleTotalCost(bundle)).toBeLessThanOrEqual(CONFIG.budgetCents);
  });

  it("selectOptimalBundle: does not exceed targetCount", () => {
    const bundle = selectOptimalBundle(AMENITIES, CONFIG);
    expect(bundle.length).toBeLessThanOrEqual(CONFIG.targetCount);
  });

  it("bundlePopularityScore: average of included amenities", () => {
    const bundle = selectOptimalBundle(AMENITIES, CONFIG);
    expect(bundlePopularityScore(bundle)).toBeGreaterThan(0);
  });

  it("bundlePopularityScore: empty bundle → 0", () => {
    expect(bundlePopularityScore([])).toBe(0);
  });
});
