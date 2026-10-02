// Self-contained tests for user XP/level calculation logic
// Mirrors the gamification system: level thresholds, titles, and progress

interface LevelResult {
  level: number;
  title: string;
  xpInCurrentLevel: number;
  xpForNextLevel: number;
  progressPercent: number;
}

// XP thresholds: cumulative XP required to reach each level
const LEVEL_THRESHOLDS: number[] = [0, 100, 300, 600, 1000, 1500];
const LEVEL_TITLES: string[] = [
  "Newcomer",
  "Explorer",
  "Regular",
  "Veteran",
  "Expert",
  "Master",
];

function calculateXpLevel(totalXp: number): LevelResult {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }
  level = Math.min(level, LEVEL_THRESHOLDS.length);

  const currentThreshold = LEVEL_THRESHOLDS[level - 1];
  const nextThreshold =
    level < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[level] : null;

  const xpInCurrentLevel = totalXp - currentThreshold;
  const xpForNextLevel = nextThreshold !== null ? nextThreshold - currentThreshold : 0;

  const progressPercent =
    nextThreshold !== null
      ? Math.min(100, Math.round((xpInCurrentLevel / xpForNextLevel) * 100))
      : 100;

  return {
    level,
    title: LEVEL_TITLES[level - 1] ?? "Master",
    xpInCurrentLevel,
    xpForNextLevel,
    progressPercent,
  };
}

describe("userXpCalculation - XP level boundaries", () => {
  it("starts at level 1 with 0 XP", () => {
    const r = calculateXpLevel(0);
    expect(r.level).toBe(1);
    expect(r.title).toBe("Newcomer");
  });

  it("advances to level 2 at exactly 100 XP (L1→L2 boundary)", () => {
    const r = calculateXpLevel(100);
    expect(r.level).toBe(2);
  });

  it("stays at level 1 with 99 XP (one below L1→L2 boundary)", () => {
    const r = calculateXpLevel(99);
    expect(r.level).toBe(1);
  });

  it("advances to level 3 at exactly 300 XP (L1+L2 cumulative)", () => {
    const r = calculateXpLevel(300);
    expect(r.level).toBe(3);
  });

  it("stays at level 2 with 299 XP (one below L2→L3 boundary)", () => {
    const r = calculateXpLevel(299);
    expect(r.level).toBe(2);
  });

  it("advances to level 4 at exactly 600 XP", () => {
    const r = calculateXpLevel(600);
    expect(r.level).toBe(4);
  });
});

describe("userXpCalculation - level title names", () => {
  it("returns 'Newcomer' at level 1", () => {
    expect(calculateXpLevel(0).title).toBe("Newcomer");
  });

  it("returns 'Explorer' at level 2", () => {
    expect(calculateXpLevel(100).title).toBe("Explorer");
  });

  it("returns 'Regular' at level 3", () => {
    expect(calculateXpLevel(300).title).toBe("Regular");
  });

  it("returns 'Veteran' at level 4", () => {
    expect(calculateXpLevel(600).title).toBe("Veteran");
  });

  it("returns 'Expert' at level 5", () => {
    expect(calculateXpLevel(1000).title).toBe("Expert");
  });
});

describe("userXpCalculation - XP progress percentage", () => {
  it("returns 0% progress at the start of level 1", () => {
    expect(calculateXpLevel(0).progressPercent).toBe(0);
  });

  it("returns 50% progress at the midpoint of level 1 (50 XP)", () => {
    expect(calculateXpLevel(50).progressPercent).toBe(50);
  });

  it("returns 100% progress at the max level", () => {
    expect(calculateXpLevel(1500).progressPercent).toBe(100);
  });

  it("never exceeds 100% even with very high XP", () => {
    expect(calculateXpLevel(99999).progressPercent).toBeLessThanOrEqual(100);
  });

  it("returns 0% at the start of level 2 (exactly 100 XP)", () => {
    expect(calculateXpLevel(100).progressPercent).toBe(0);
  });

  it("returns 50% midpoint of level 2 (100 + 100 = 200 XP, level 2 spans 100-300)", () => {
    // Level 2 spans 100-300 (200 XP range). Midpoint = 200 XP total.
    expect(calculateXpLevel(200).progressPercent).toBe(50);
  });
});
