/**
 * Tests for floor plan wayfinding path calculation.
 */

interface GridPoint {
  x: number;
  y: number;
}

function manhattanDistance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshevDistance(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function pathPoints(from: GridPoint, to: GridPoint): GridPoint[] {
  const points: GridPoint[] = [];
  let { x, y } = from;

  // Simple L-shaped path: horizontal then vertical
  while (x !== to.x) {
    x += x < to.x ? 1 : -1;
    points.push({ x, y });
  }
  while (y !== to.y) {
    y += y < to.y ? 1 : -1;
    points.push({ x, y });
  }

  return points;
}

function isPointOnPath(path: GridPoint[], point: GridPoint): boolean {
  return path.some((p) => p.x === point.x && p.y === point.y);
}

function pathLength(path: GridPoint[], start: GridPoint): number {
  return manhattanDistance(start, path.length > 0 ? path[path.length - 1] : start);
}

describe("Floor plan wayfinding", () => {
  it("manhattanDistance: (0,0) to (3,4) = 7", () => {
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });

  it("manhattanDistance: same point = 0", () => {
    expect(manhattanDistance({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(0);
  });

  it("chebyshevDistance: (0,0) to (3,4) = 4", () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(4);
  });

  it("pathPoints: from (0,0) to (2,2) has 4 steps", () => {
    expect(pathPoints({ x: 0, y: 0 }, { x: 2, y: 2 })).toHaveLength(4);
  });

  it("pathPoints: ends at destination", () => {
    const path = pathPoints({ x: 0, y: 0 }, { x: 3, y: 2 });
    const last = path[path.length - 1];
    expect(last.x).toBe(3);
    expect(last.y).toBe(2);
  });

  it("pathPoints: same start and end → empty path", () => {
    expect(pathPoints({ x: 1, y: 1 }, { x: 1, y: 1 })).toHaveLength(0);
  });

  it("isPointOnPath: midpoint on path → true", () => {
    const path = pathPoints({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(isPointOnPath(path, { x: 1, y: 0 })).toBe(true);
  });

  it("isPointOnPath: off-path point → false", () => {
    const path = pathPoints({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(isPointOnPath(path, { x: 5, y: 5 })).toBe(false);
  });
});
