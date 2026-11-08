import { calculateLevel } from "@/lib/gamification";

describe("calculateLevel", () => {
  describe("zero XP", () => {
    it("returns level 1 for 0 XP", () => {
      const result = calculateLevel(0);
      expect(result.level).toBe(1);
    });

    it("returns progressPercent 0 for 0 XP", () => {
      expect(calculateLevel(0).progressPercent).toBe(0);
    });

    it("returns xpForNextLevel 100 at level 1", () => {
      expect(calculateLevel(0).xpForNextLevel).toBe(100);
    });
  });

  describe("boundary XP values", () => {
    it("stays at level 1 for XP = 99 (one below first threshold)", () => {
      const result = calculateLevel(99);
      expect(result.level).toBe(1);
      expect(result.xpInCurrentLevel).toBe(99);
    });

    it("advances to level 2 at exactly XP = 100", () => {
      const result = calculateLevel(100);
      expect(result.level).toBe(2);
      expect(result.xpInCurrentLevel).toBe(0);
    });

    it("advances to level 3 at XP = 100 + 200 = 300", () => {
      const result = calculateLevel(300);
      expect(result.level).toBe(3);
      expect(result.xpInCurrentLevel).toBe(0);
    });

    it("stays at level 2 for XP = 299 (one below second threshold)", () => {
      const result = calculateLevel(299);
      expect(result.level).toBe(2);
    });

    it("advances to level 4 at XP = 100 + 200 + 300 = 600", () => {
      const result = calculateLevel(600);
      expect(result.level).toBe(4);
      expect(result.xpInCurrentLevel).toBe(0);
    });
  });

  describe("progressPercent", () => {
    it("returns 50 progressPercent at halfway through a level", () => {
      // Level 1 threshold = 100 XP; halfway = 50 XP
      expect(calculateLevel(50).progressPercent).toBe(50);
    });

    it("returns 25 progressPercent at quarter through level 2", () => {
      // Level 2 threshold = 200 XP; 100 XP into it = 50%, quarter = 50 XP in
      expect(calculateLevel(100 + 50).progressPercent).toBe(25);
    });

    it("caps progressPercent at 100", () => {
      // Exactly at level boundary should be 0 in next level, not > 100
      const result = calculateLevel(100);
      expect(result.progressPercent).toBeLessThanOrEqual(100);
    });

    it("returns 99 progressPercent for XP = 99", () => {
      expect(calculateLevel(99).progressPercent).toBe(99);
    });
  });

  describe("raw XP passthrough", () => {
    it("always returns the original XP as result.xp", () => {
      expect(calculateLevel(0).xp).toBe(0);
      expect(calculateLevel(250).xp).toBe(250);
      expect(calculateLevel(10000).xp).toBe(10000);
    });
  });

  describe("large XP values", () => {
    it("handles very large XP without infinite loop", () => {
      expect(() => calculateLevel(1_000_000)).not.toThrow();
    });

    it("returns a high level for 1,000,000 XP", () => {
      const result = calculateLevel(1_000_000);
      expect(result.level).toBeGreaterThan(100);
    });
  });
});
