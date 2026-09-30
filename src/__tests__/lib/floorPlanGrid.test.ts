/**
 * Tests for floor plan grid coordinate to seat-index mapping.
 */

interface GridSize {
  rows: number;
  cols: number;
}

function seatIndex(row: number, col: number, grid: GridSize): number {
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) {
    throw new RangeError(`(${row},${col}) out of grid ${grid.rows}x${grid.cols}`);
  }
  return row * grid.cols + col;
}

function indexToCoords(index: number, grid: GridSize): { row: number; col: number } {
  if (index < 0 || index >= grid.rows * grid.cols) {
    throw new RangeError(`Index ${index} out of range`);
  }
  return { row: Math.floor(index / grid.cols), col: index % grid.cols };
}

function totalSeats(grid: GridSize): number {
  return grid.rows * grid.cols;
}

const GRID_5x10: GridSize = { rows: 5, cols: 10 };

describe("Floor plan grid mapping", () => {
  it("top-left corner is index 0", () => {
    expect(seatIndex(0, 0, GRID_5x10)).toBe(0);
  });

  it("top-right corner", () => {
    expect(seatIndex(0, 9, GRID_5x10)).toBe(9);
  });

  it("second row first col", () => {
    expect(seatIndex(1, 0, GRID_5x10)).toBe(10);
  });

  it("bottom-right corner", () => {
    expect(seatIndex(4, 9, GRID_5x10)).toBe(49);
  });

  it("out-of-bounds throws RangeError", () => {
    expect(() => seatIndex(5, 0, GRID_5x10)).toThrow(RangeError);
  });

  it("negative row throws", () => {
    expect(() => seatIndex(-1, 0, GRID_5x10)).toThrow(RangeError);
  });

  it("indexToCoords: index 0 → row 0 col 0", () => {
    expect(indexToCoords(0, GRID_5x10)).toEqual({ row: 0, col: 0 });
  });

  it("indexToCoords: index 15 → row 1 col 5", () => {
    expect(indexToCoords(15, GRID_5x10)).toEqual({ row: 1, col: 5 });
  });

  it("indexToCoords: out-of-range throws", () => {
    expect(() => indexToCoords(50, GRID_5x10)).toThrow(RangeError);
  });

  it("totalSeats is rows×cols", () => {
    expect(totalSeats(GRID_5x10)).toBe(50);
  });

  it("round-trip: seatIndex → indexToCoords", () => {
    const idx = seatIndex(3, 7, GRID_5x10);
    expect(indexToCoords(idx, GRID_5x10)).toEqual({ row: 3, col: 7 });
  });
});
