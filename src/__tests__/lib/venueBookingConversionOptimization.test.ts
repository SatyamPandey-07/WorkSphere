/**
 * Tests for booking page conversion optimization techniques.
 */

interface PageElement {
  elementId: string;
  type: "cta" | "image" | "review" | "price" | "availability" | "social_proof";
  position: number; // 1 = top of page
  clickThroughRate: number; // 0-1
  conversionImpact: number; // -1 to 1 (positive = helps conversion)
}

function optimizedElementOrder(elements: PageElement[]): PageElement[] {
  return [...elements].sort((a, b) => {
    const scoreA = a.conversionImpact * 50 + a.clickThroughRate * 30 + (20 - a.position);
    const scoreB = b.conversionImpact * 50 + b.clickThroughRate * 30 + (20 - b.position);
    return scoreB - scoreA;
  });
}

function pageConversionScore(elements: PageElement[]): number {
  if (elements.length === 0) return 0;
  const impactSum = elements.reduce((s, e) => s + e.conversionImpact, 0);
  const ctrAvg = elements.reduce((s, e) => s + e.clickThroughRate, 0) / elements.length;
  return Math.round((impactSum * 30 + ctrAvg * 70) * 100) / 100;
}

function missingCriticalElements(elements: PageElement[]): string[] {
  const critical = ["cta", "price", "availability"] as const;
  const present = new Set(elements.map((e) => e.type));
  return critical.filter((c) => !present.has(c));
}

function aboveTheFoldElements(elements: PageElement[], foldPosition = 3): PageElement[] {
  return elements.filter((e) => e.position <= foldPosition);
}

const ELEMENTS: PageElement[] = [
  { elementId: "e1", type: "price",         position: 2, clickThroughRate: 0.15, conversionImpact: 0.6 },
  { elementId: "e2", type: "cta",           position: 4, clickThroughRate: 0.45, conversionImpact: 0.9 },
  { elementId: "e3", type: "review",        position: 6, clickThroughRate: 0.08, conversionImpact: 0.4 },
  { elementId: "e4", type: "social_proof",  position: 8, clickThroughRate: 0.05, conversionImpact: 0.3 },
  { elementId: "e5", type: "availability",  position: 3, clickThroughRate: 0.20, conversionImpact: 0.7 },
];

describe("Booking page conversion optimization", () => {
  it("optimizedElementOrder: CTA should rank highly", () => {
    const ordered = optimizedElementOrder(ELEMENTS);
    const ctaIdx = ordered.findIndex((e) => e.type === "cta");
    expect(ctaIdx).toBeLessThan(3); // CTA should be in top 3
  });

  it("pageConversionScore: positive for positive impact elements", () => {
    expect(pageConversionScore(ELEMENTS)).toBeGreaterThan(0);
  });

  it("pageConversionScore: empty → 0", () => {
    expect(pageConversionScore([])).toBe(0);
  });

  it("missingCriticalElements: all present → empty", () => {
    expect(missingCriticalElements(ELEMENTS)).toHaveLength(0);
  });

  it("missingCriticalElements: missing CTA → listed", () => {
    const noCta = ELEMENTS.filter((e) => e.type !== "cta");
    expect(missingCriticalElements(noCta)).toContain("cta");
  });

  it("aboveTheFoldElements: position 1-3", () => {
    const fold = aboveTheFoldElements(ELEMENTS);
    expect(fold.every((e) => e.position <= 3)).toBe(true);
    expect(fold).toHaveLength(2); // price (2) and availability (3)
  });
});
