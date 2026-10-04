/**
 * Tests for venue booking demand heatmap generation and analysis.
 */

interface DemandCell {
  hour: number;       // 0-23
  dayOfWeek: number;  // 0=Sun
  avgDemand: number;  // 0-1
  peakMultiplier: number; // how much to multiply base price at this slot
}

function buildDemandGrid(cells: DemandCell[]): Record<number, Record<number, DemandCell>> {
  const grid: Record<number, Record<number, DemandCell>> = {};
  for (const cell of cells) {
    if (!grid[cell.dayOfWeek]) grid[cell.dayOfWeek] = {};
    grid[cell.dayOfWeek][cell.hour] = cell;
  }
  return grid;
}

function peakSlots(cells: DemandCell[], threshold = 0.8): DemandCell[] {
  return cells.filter((c) => c.avgDemand >= threshold);
}

function offPeakSlots(cells: DemandCell[], threshold = 0.3): DemandCell[] {
  return cells.filter((c) => c.avgDemand <= threshold);
}

function avgDemand(cells: DemandCell[]): number {
  if (cells.length === 0) return 0;
  return Math.round(cells.reduce((s, c) => s + c.avgDemand, 0) / cells.length * 100) / 100;
}

function priceForSlot(basePrice: number, cell: DemandCell): number {
  return Math.round(basePrice * cell.peakMultiplier * 100) / 100;
}

function busiestDayOfWeek(cells: DemandCell[]): number {
  const totals: Record<number, number> = {};
  const counts: Record<number, number> = {};
  for (const c of cells) {
    totals[c.dayOfWeek] = (totals[c.dayOfWeek] ?? 0) + c.avgDemand;
    counts[c.dayOfWeek] = (counts[c.dayOfWeek] ?? 0) + 1;
  }
  let maxDow = 0;
  let maxAvg = -1;
  for (const dow of Object.keys(totals)) {
    const avg = totals[Number(dow)] / counts[Number(dow)];
    if (avg > maxAvg) { maxAvg = avg; maxDow = Number(dow); }
  }
  return maxDow;
}

const CELLS: DemandCell[] = [
  { hour: 9,  dayOfWeek: 1, avgDemand: 0.9, peakMultiplier: 1.4 },
  { hour: 14, dayOfWeek: 1, avgDemand: 0.7, peakMultiplier: 1.1 },
  { hour: 18, dayOfWeek: 5, avgDemand: 1.0, peakMultiplier: 1.6 },
  { hour: 2,  dayOfWeek: 2, avgDemand: 0.1, peakMultiplier: 0.7 },
  { hour: 20, dayOfWeek: 6, avgDemand: 0.95,peakMultiplier: 1.5 },
];

describe("Demand heatmap generation and analysis", () => {
  it("peakSlots: 3 slots above 0.8 threshold", () => {
    expect(peakSlots(CELLS).length).toBe(3);
  });

  it("offPeakSlots: 1 slot below 0.3 threshold", () => {
    expect(offPeakSlots(CELLS).length).toBe(1);
  });

  it("avgDemand: average across all cells", () => {
    const avg = avgDemand(CELLS);
    expect(avg).toBeGreaterThan(0.5);
    expect(avg).toBeLessThan(1);
  });

  it("priceForSlot: $100 × 1.6 = $160", () => {
    expect(priceForSlot(100, CELLS[2])).toBe(160);
  });

  it("busiestDayOfWeek: Friday or Saturday based on demand", () => {
    const busiest = busiestDayOfWeek(CELLS);
    expect([5, 6]).toContain(busiest);
  });

  it("buildDemandGrid: creates nested grid", () => {
    const grid = buildDemandGrid(CELLS);
    expect(grid[1][9]).toBeDefined();
    expect(grid[1][9].avgDemand).toBe(0.9);
  });
});
