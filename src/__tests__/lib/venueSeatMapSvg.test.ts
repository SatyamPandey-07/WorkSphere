/**
 * Tests for venue seat map SVG coordinate calculation.
 */

interface SeatMapConfig {
  rows: number;
  cols: number;
  seatWidth: number;   // pixels
  seatHeight: number;
  gapX: number;       // horizontal gap
  gapY: number;       // vertical gap
  originX: number;
  originY: number;
}

interface SeatCoordinate {
  row: number;
  col: number;
  x: number;
  y: number;
  centerX: number;
  centerY: number;
}

function getSeatCoordinate(config: SeatMapConfig, row: number, col: number): SeatCoordinate | null {
  if (row < 0 || row >= config.rows || col < 0 || col >= config.cols) return null;
  const x = config.originX + col * (config.seatWidth + config.gapX);
  const y = config.originY + row * (config.seatHeight + config.gapY);
  return {
    row, col, x, y,
    centerX: x + config.seatWidth / 2,
    centerY: y + config.seatHeight / 2,
  };
}

function totalMapWidth(config: SeatMapConfig): number {
  return config.cols * config.seatWidth + (config.cols - 1) * config.gapX;
}

function totalMapHeight(config: SeatMapConfig): number {
  return config.rows * config.seatHeight + (config.rows - 1) * config.gapY;
}

function allSeatCoordinates(config: SeatMapConfig): SeatCoordinate[] {
  const coords: SeatCoordinate[] = [];
  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.cols; col++) {
      const coord = getSeatCoordinate(config, row, col);
      if (coord) coords.push(coord);
    }
  }
  return coords;
}

const CONFIG: SeatMapConfig = {
  rows: 3, cols: 4, seatWidth: 40, seatHeight: 40, gapX: 10, gapY: 10, originX: 0, originY: 0,
};

describe("Venue seat map SVG coordinates", () => {
  it("getSeatCoordinate: (0,0) at origin", () => {
    const coord = getSeatCoordinate(CONFIG, 0, 0)!;
    expect(coord.x).toBe(0);
    expect(coord.y).toBe(0);
  });

  it("getSeatCoordinate: (0,1) offset by width+gap", () => {
    const coord = getSeatCoordinate(CONFIG, 0, 1)!;
    expect(coord.x).toBe(50); // 40+10
  });

  it("getSeatCoordinate: (1,0) offset by height+gap", () => {
    const coord = getSeatCoordinate(CONFIG, 1, 0)!;
    expect(coord.y).toBe(50); // 40+10
  });

  it("getSeatCoordinate: centerX = x + width/2", () => {
    const coord = getSeatCoordinate(CONFIG, 0, 0)!;
    expect(coord.centerX).toBe(20);
  });

  it("getSeatCoordinate: out of bounds → null", () => {
    expect(getSeatCoordinate(CONFIG, 5, 0)).toBeNull();
    expect(getSeatCoordinate(CONFIG, 0, 5)).toBeNull();
  });

  it("totalMapWidth: 4 cols × 40 + 3 gaps × 10 = 190", () => {
    expect(totalMapWidth(CONFIG)).toBe(190);
  });

  it("totalMapHeight: 3 rows × 40 + 2 gaps × 10 = 140", () => {
    expect(totalMapHeight(CONFIG)).toBe(140);
  });

  it("allSeatCoordinates: 3×4 = 12 seats", () => {
    expect(allSeatCoordinates(CONFIG)).toHaveLength(12);
  });
});
