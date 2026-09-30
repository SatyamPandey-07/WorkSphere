/**
 * Tests for venue booking carbon footprint and offset calculations.
 */

interface CarbonSource {
  category: "travel" | "energy" | "catering" | "waste" | "printing";
  kgCO2e: number;
  description: string;
}

interface CarbonOffset {
  projectName: string;
  pricePerTonne: number;
  verified: boolean;
}

function totalCarbonKg(sources: CarbonSource[]): number {
  return Math.round(sources.reduce((s, c) => s + c.kgCO2e, 0) * 100) / 100;
}

function carbonByCategory(sources: CarbonSource[]): Record<CarbonSource["category"], number> {
  const result = { travel: 0, energy: 0, catering: 0, waste: 0, printing: 0 };
  for (const s of sources) result[s.category] = Math.round((result[s.category] + s.kgCO2e) * 100) / 100;
  return result;
}

function offsetCost(totalKgCO2e: number, offset: CarbonOffset): number {
  const tonnes = totalKgCO2e / 1000;
  return Math.round(tonnes * offset.pricePerTonne * 100) / 100;
}

function netCarbonKg(sources: CarbonSource[], offsetKg: number): number {
  return Math.max(0, Math.round((totalCarbonKg(sources) - offsetKg) * 100) / 100);
}

function isCarbon Neutral(sources: CarbonSource[], offsetKg: number): boolean {
  return totalCarbonKg(sources) <= offsetKg;
}

function largestSource(sources: CarbonSource[]): CarbonSource | null {
  if (sources.length === 0) return null;
  return sources.reduce((max, s) => (s.kgCO2e > max.kgCO2e ? s : max), sources[0]);
}

const SOURCES: CarbonSource[] = [
  { category: "travel",   kgCO2e: 450, description: "Guest travel by car" },
  { category: "energy",   kgCO2e: 120, description: "Venue electricity" },
  { category: "catering", kgCO2e: 80,  description: "Food and beverages" },
  { category: "waste",    kgCO2e: 30,  description: "Event waste" },
];
const OFFSET: CarbonOffset = { projectName: "Rainforest Protection", pricePerTonne: 15, verified: true };

describe("Carbon footprint and offset calculations", () => {
  it("totalCarbonKg: 680 kg total", () => {
    expect(totalCarbonKg(SOURCES)).toBe(680);
  });

  it("carbonByCategory: travel = 450 kg", () => {
    expect(carbonByCategory(SOURCES).travel).toBe(450);
  });

  it("offsetCost: 0.68 tonnes at $15 = $10.2", () => {
    expect(offsetCost(680, OFFSET)).toBe(10.2);
  });

  it("netCarbonKg: after 200kg offset = 480kg", () => {
    expect(netCarbonKg(SOURCES, 200)).toBe(480);
  });

  it("largestSource: travel is largest", () => {
    expect(largestSource(SOURCES)?.category).toBe("travel");
  });

  it("largestSource: null for empty", () => {
    expect(largestSource([])).toBeNull();
  });
});
