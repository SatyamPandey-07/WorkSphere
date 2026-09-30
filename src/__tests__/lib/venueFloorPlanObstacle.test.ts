/**
 * Tests for floor plan obstacle and blocked area detection.
 */

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectanglesOverlap(a: Rectangle, b: Rectangle): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function rectangleArea(rect: Rectangle): number {
  return rect.width * rect.height;
}

function isPointInsideRect(x: number, y: number, rect: Rectangle): boolean {
  return x >= rect.x && x < rect.x + rect.width &&
         y >= rect.y && y < rect.y + rect.height;
}

function totalBlockedArea(obstacles: Rectangle[]): number {
  return obstacles.reduce((sum, o) => sum + rectangleArea(o), 0);
}

function freeArea(floorPlan: Rectangle, obstacles: Rectangle[]): number {
  // Simplified: subtract sum of obstacle areas (no intersection handling)
  return Math.max(0, rectangleArea(floorPlan) - totalBlockedArea(obstacles));
}

describe("Floor plan obstacle detection", () => {
  const ROOM: Rectangle = { x: 0, y: 0, width: 100, height: 50 };

  it("rectanglesOverlap: overlapping rects → true", () => {
    const a: Rectangle = { x: 0, y: 0, width: 10, height: 10 };
    const b: Rectangle = { x: 5, y: 5, width: 10, height: 10 };
    expect(rectanglesOverlap(a, b)).toBe(true);
  });

  it("rectanglesOverlap: non-overlapping → false", () => {
    const a: Rectangle = { x: 0, y: 0, width: 10, height: 10 };
    const b: Rectangle = { x: 20, y: 20, width: 10, height: 10 };
    expect(rectanglesOverlap(a, b)).toBe(false);
  });

  it("rectanglesOverlap: adjacent (touching) → false", () => {
    const a: Rectangle = { x: 0, y: 0, width: 10, height: 10 };
    const b: Rectangle = { x: 10, y: 0, width: 10, height: 10 };
    expect(rectanglesOverlap(a, b)).toBe(false);
  });

  it("rectangleArea: 10x5 = 50", () => {
    expect(rectangleArea({ x: 0, y: 0, width: 10, height: 5 })).toBe(50);
  });

  it("isPointInsideRect: inside → true", () => {
    expect(isPointInsideRect(5, 3, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it("isPointInsideRect: outside → false", () => {
    expect(isPointInsideRect(15, 3, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("isPointInsideRect: on boundary (exclusive right) → false", () => {
    expect(isPointInsideRect(10, 0, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("totalBlockedArea sums all obstacles", () => {
    const obstacles: Rectangle[] = [
      { x: 0, y: 0, width: 5, height: 5 },   // 25
      { x: 10, y: 10, width: 4, height: 4 },  // 16
    ];
    expect(totalBlockedArea(obstacles)).toBe(41);
  });

  it("freeArea = floorPlan - obstacles", () => {
    const obstacles: Rectangle[] = [{ x: 0, y: 0, width: 20, height: 10 }];
    expect(freeArea(ROOM, obstacles)).toBe(3800);
  });
});
