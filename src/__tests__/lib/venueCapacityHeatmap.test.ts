/**
 * Tests for venue occupancy heatmap data generation.
 */

interface HeatmapCell {
  hour: number;  // 0-23
  dayOfWeek: number; // 0=Sun, 6=Sat
  occupancyPct: number;
}

function buildHeatmapGrid(): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (let day = 0; day <= 6; day++) {
    for (let hour = 0; hour <= 23; hour++) {
      cells.push({ hour, dayOfWeek: day, occupancyPct: 0 });
    }
  }
  return cells;
}

function updateCell(
  grid: HeatmapCell[],
  dayOfWeek: number,
  hour: number,
  occupancyPct: number
): HeatmapCell[] {
  return grid.map((cell) =>
    cell.dayOfWeek === dayOfWeek && cell.hour === hour
      ? { ...cell, occupancyPct }
      : cell
  );
}

function peakCell(grid: HeatmapCell[]): HeatmapCell | null {
  if (grid.length === 0) return null;
  return grid.reduce((peak, cell) =>
    cell.occupancyPct > peak.occupancyPct ? cell : peak
  );
}

function averageOccupancy(grid: HeatmapCell[]): number {
  if (grid.length === 0) return 0;
  return grid.reduce((sum, c) => sum + c.occupancyPct, 0) / grid.length;
}

describe("Venue capacity heatmap", () => {
  it("buildHeatmapGrid has 168 cells (7 days × 24 hours)", () => {
    expect(buildHeatmapGrid()).toHaveLength(168);
  });

  it("all initial cells have 0 occupancy", () => {
    const grid = buildHeatmapGrid();
    expect(grid.every((c) => c.occupancyPct === 0)).toBe(true);
  });

  it("updateCell modifies the correct cell", () => {
    const grid = updateCell(buildHeatmapGrid(), 1, 9, 75);
    const cell = grid.find((c) => c.dayOfWeek === 1 && c.hour === 9)!;
    expect(cell.occupancyPct).toBe(75);
  });

  it("updateCell does not change other cells", () => {
    const grid = updateCell(buildHeatmapGrid(), 1, 9, 75);
    const others = grid.filter((c) => !(c.dayOfWeek === 1 && c.hour === 9));
    expect(others.every((c) => c.occupancyPct === 0)).toBe(true);
  });

  it("peakCell returns cell with highest occupancy", () => {
    let grid = buildHeatmapGrid();
    grid = updateCell(grid, 3, 14, 90);
    grid = updateCell(grid, 5, 20, 50);
    const peak = peakCell(grid)!;
    expect(peak.dayOfWeek).toBe(3);
    expect(peak.hour).toBe(14);
  });

  it("peakCell empty grid → null", () => {
    expect(peakCell([])).toBeNull();
  });

  it("averageOccupancy of fresh grid → 0", () => {
    expect(averageOccupancy(buildHeatmapGrid())).toBe(0);
  });
});
