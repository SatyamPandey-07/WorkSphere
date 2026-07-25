import { calculateLevel } from "@/lib/gamification";

describe("calculateLevel", () => {
  it("returns level 1 with 0% progress for 0 XP", () => {
    const result = calculateLevel(0);
    expect(result.level).toBe(1);
    expect(result.xp).toBe(0);
    expect(result.xpInCurrentLevel).toBe(0);
    expect(result.xpForNextLevel).toBe(100);
    expect(result.progressPercent).toBe(0);
  });

  it("returns level 1 with correct progress for partial XP", () => {
    const result = calculateLevel(50);
    expect(result.level).toBe(1);
    expect(result.xp).toBe(50);
    expect(result.xpInCurrentLevel).toBe(50);
    expect(result.xpForNextLevel).toBe(100);
    expect(result.progressPercent).toBe(50);
  });

  it("advances to level 2 at exactly 100 XP", () => {
    const result = calculateLevel(100);
    expect(result.level).toBe(2);
    expect(result.xpInCurrentLevel).toBe(0);
    expect(result.xpForNextLevel).toBe(200);
    expect(result.progressPercent).toBe(0);
  });

  it("advances to level 3 at 300 XP (100 + 200)", () => {
    const result = calculateLevel(300);
    expect(result.level).toBe(3);
    expect(result.xpInCurrentLevel).toBe(0);
    expect(result.xpForNextLevel).toBe(300);
    expect(result.progressPercent).toBe(0);
  });

  it("handles mid-level XP correctly at level 2", () => {
    const result = calculateLevel(150);
    expect(result.level).toBe(2);
    expect(result.xpInCurrentLevel).toBe(50);
    expect(result.xpForNextLevel).toBe(200);
    expect(result.progressPercent).toBe(25);
  });

  it("handles large XP values without infinite loop", () => {
    const result = calculateLevel(100000);
    expect(result.level).toBeGreaterThan(1);
    expect(result.xpInCurrentLevel).toBeLessThan(result.xpForNextLevel);
    expect(result.progressPercent).toBeGreaterThanOrEqual(0);
    expect(result.progressPercent).toBeLessThanOrEqual(100);
  });

  it("never produces progressPercent above 100", () => {
    // Test XP at exact boundaries and just below
    const boundaries = [0, 99, 100, 299, 300, 599, 600];
    for (const xp of boundaries) {
      const result = calculateLevel(xp);
      expect(result.progressPercent).toBeLessThanOrEqual(100);
      expect(result.progressPercent).toBeGreaterThanOrEqual(0);
    }
  });

  it("maintains xpInCurrentLevel < xpForNextLevel invariant", () => {
    const xpValues = [0, 1, 50, 99, 100, 250, 1000, 5000];
    for (const xp of xpValues) {
      const result = calculateLevel(xp);
      expect(result.xpInCurrentLevel).toBeLessThan(result.xpForNextLevel);
    }
  });

  it("preserves the original xp value in the result", () => {
    const result = calculateLevel(777);
    expect(result.xp).toBe(777);
  });

  it("each level requires more XP than the previous", () => {
    // Level 2 needs 200, level 3 needs 300, etc.
    const result = calculateLevel(600); // level 1(100) + level 2(200) + level 3(300) = 600
    expect(result.level).toBe(4);
    expect(result.xpForNextLevel).toBe(400);
  });
});
