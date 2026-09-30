/**
 * Tests for user achievement level and experience point progression.
 */

interface LevelConfig {
  level: number;
  minXp: number;
  title: string;
}

const LEVEL_CONFIG: LevelConfig[] = [
  { level: 1,  minXp: 0,     title: "Newcomer"       },
  { level: 2,  minXp: 100,   title: "Explorer"       },
  { level: 3,  minXp: 300,   title: "Regular"        },
  { level: 4,  minXp: 600,   title: "Established"    },
  { level: 5,  minXp: 1000,  title: "Senior Member"  },
  { level: 6,  minXp: 2000,  title: "Champion"       },
  { level: 7,  minXp: 5000,  title: "Elite"          },
];

function getLevelForXp(xp: number): LevelConfig {
  return [...LEVEL_CONFIG]
    .reverse()
    .find((l) => xp >= l.minXp) ?? LEVEL_CONFIG[0];
}

function xpToNextLevel(xp: number): number {
  const current = getLevelForXp(xp);
  const nextLevel = LEVEL_CONFIG.find((l) => l.level === current.level + 1);
  if (!nextLevel) return 0; // max level
  return nextLevel.minXp - xp;
}

function levelProgress(xp: number): number {
  const current = getLevelForXp(xp);
  const nextLevel = LEVEL_CONFIG.find((l) => l.level === current.level + 1);
  if (!nextLevel) return 100;
  const range = nextLevel.minXp - current.minXp;
  return Math.round(((xp - current.minXp) / range) * 100);
}

describe("User achievement level progression", () => {
  it("0 xp → level 1 (Newcomer)", () => {
    const l = getLevelForXp(0);
    expect(l.level).toBe(1);
    expect(l.title).toBe("Newcomer");
  });

  it("100 xp → level 2 (Explorer)", () => {
    expect(getLevelForXp(100).level).toBe(2);
  });

  it("999 xp → level 4 (Established)", () => {
    expect(getLevelForXp(999).level).toBe(4);
  });

  it("5000 xp → level 7 (Elite)", () => {
    expect(getLevelForXp(5000).title).toBe("Elite");
  });

  it("xpToNextLevel: 50 xp → need 50 more for level 2", () => {
    expect(xpToNextLevel(50)).toBe(50);
  });

  it("xpToNextLevel: max level → 0", () => {
    expect(xpToNextLevel(10000)).toBe(0);
  });

  it("levelProgress: 50 xp = 50% of level 1→2 range", () => {
    expect(levelProgress(50)).toBe(50);
  });

  it("levelProgress: max level → 100%", () => {
    expect(levelProgress(10000)).toBe(100);
  });

  it("levelProgress: at level boundary = 0%", () => {
    // exactly at level 2 (100 xp) → 0% into level 2-3 range
    expect(levelProgress(100)).toBe(0);
  });
});
