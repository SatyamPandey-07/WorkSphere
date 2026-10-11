import { DeskCollisionGrid } from '@/core/webgl/DeskCollisionGrid';

describe('DeskCollisionGrid Out-Of-Bounds Boundary Checks (#5604)', () => {
  const CELL_SIZE = 2.0;
  const WIDTH = 100;
  const HEIGHT = 80;

  let grid: DeskCollisionGrid;

  beforeEach(() => {
    grid = new DeskCollisionGrid(CELL_SIZE, WIDTH, HEIGHT);
  });

  describe('isOutOfBounds', () => {
    it('correctly identifies valid in-bounds coordinates', () => {
      expect(grid.isOutOfBounds(0, 0)).toBe(false);
      expect(grid.isOutOfBounds(50, 40)).toBe(false);
      expect(grid.isOutOfBounds(99.9, 79.9)).toBe(false);
    });

    it('identifies negative coordinates as out of bounds', () => {
      expect(grid.isOutOfBounds(-0.1, 10)).toBe(true);
      expect(grid.isOutOfBounds(10, -0.1)).toBe(true);
      expect(grid.isOutOfBounds(-5, -5)).toBe(true);
      expect(grid.isOutOfBounds(-1000, 50)).toBe(true);
    });

    it('identifies coordinates at or exceeding width and height as out of bounds', () => {
      // Exactly at width / height boundary
      expect(grid.isOutOfBounds(100, 50)).toBe(true);
      expect(grid.isOutOfBounds(50, 80)).toBe(true);
      expect(grid.isOutOfBounds(100, 80)).toBe(true);

      // Beyond width / height
      expect(grid.isOutOfBounds(150, 50)).toBe(true);
      expect(grid.isOutOfBounds(50, 120)).toBe(true);
      expect(grid.isOutOfBounds(9999, 9999)).toBe(true);
    });
  });

  describe('Out-of-bounds query and collision checks', () => {
    beforeEach(() => {
      // Insert desk at center (50, 40)
      grid.insert('desk-center', 50, 40, 2, 2);
      // Insert desk near boundary (0, 0)
      grid.insert('desk-origin', 1, 1, 2, 2);
    });

    it('returns empty array from query() for negative coordinates without throwing', () => {
      expect(() => grid.query(-5, 40)).not.toThrow();
      expect(grid.query(-5, 40)).toEqual([]);

      expect(() => grid.query(50, -10)).not.toThrow();
      expect(grid.query(50, -10)).toEqual([]);

      expect(() => grid.query(-10, -10, 5)).not.toThrow();
      expect(grid.query(-10, -10, 5)).toEqual([]);
    });

    it('returns empty array from query() for coordinates exceeding grid dimensions', () => {
      expect(() => grid.query(100, 40)).not.toThrow();
      expect(grid.query(100, 40)).toEqual([]);

      expect(() => grid.query(50, 80)).not.toThrow();
      expect(grid.query(50, 80)).toEqual([]);

      expect(() => grid.query(500, 500)).not.toThrow();
      expect(grid.query(500, 500)).toEqual([]);
    });

    it('returns false from checkCollision() for out-of-bounds coordinates', () => {
      expect(grid.checkCollision(-5, 40)).toBe(false);
      expect(grid.checkCollision(50, -5)).toBe(false);
      expect(grid.checkCollision(100, 40)).toBe(false);
      expect(grid.checkCollision(50, 80)).toBe(false);
      expect(grid.checkCollision(-999, -999)).toBe(false);
      expect(grid.checkCollision(999, 999)).toBe(false);
    });

    it('returns null from getDeskAt() for out-of-bounds coordinates', () => {
      expect(grid.getDeskAt(-1, 0)).toBeNull();
      expect(grid.getDeskAt(0, -1)).toBeNull();
      expect(grid.getDeskAt(100, 40)).toBeNull();
      expect(grid.getDeskAt(50, 80)).toBeNull();
      expect(grid.getDeskAt(-50, -50)).toBeNull();
    });

    it('successfully queries valid in-bounds desk coordinates', () => {
      expect(grid.query(50, 40, 1)).toEqual(['desk-center']);
      expect(grid.checkCollision(50, 40)).toBe(true);
      expect(grid.getDeskAt(50, 40)).toBe('desk-center');

      expect(grid.query(1, 1, 1)).toEqual(['desk-origin']);
      expect(grid.checkCollision(1, 1)).toBe(true);
      expect(grid.getDeskAt(1, 1)).toBe('desk-origin');
    });
  });

  describe('Out-of-bounds insertion and removal', () => {
    it('handles inserting desks completely outside bounding box safely without throwing', () => {
      expect(() => grid.insert('desk-outside-negative', -20, -20, 2, 2)).not.toThrow();
      expect(() => grid.insert('desk-outside-positive', 200, 200, 2, 2)).not.toThrow();

      // Ensure no phantom cells were created
      expect(grid.query(-20, -20)).toEqual([]);
      expect(grid.query(200, 200)).toEqual([]);
    });

    it('handles removing desks with out-of-bounds coordinates safely without throwing', () => {
      expect(() => grid.remove('desk-ghost', -10, -10, 2, 2)).not.toThrow();
      expect(() => grid.remove('desk-ghost', 500, 500, 2, 2)).not.toThrow();
    });
  });
});
