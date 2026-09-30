/**
 * Tests for venue digital signage content scheduling.
 */

type ContentType = "announcement" | "promotion" | "wayfinding" | "capacity" | "emergency";

interface SignageContent {
  contentId: string;
  venueId: string;
  type: ContentType;
  title: string;
  message: string;
  priority: number;     // 1-10
  displaySeconds: number;
  activeFrom: number;
  activeUntil: number;
  targetZones: string[];
}

function isContentActive(content: SignageContent, nowMs: number): boolean {
  return nowMs >= content.activeFrom && nowMs < content.activeUntil;
}

function getActiveContents(
  contents: SignageContent[],
  venueId: string,
  zone: string,
  nowMs: number
): SignageContent[] {
  return contents
    .filter((c) =>
      c.venueId === venueId &&
      (c.targetZones.length === 0 || c.targetZones.includes(zone)) &&
      isContentActive(c, nowMs)
    )
    .sort((a, b) => b.priority - a.priority);
}

function getEmergencyContent(
  contents: SignageContent[],
  venueId: string,
  nowMs: number
): SignageContent | null {
  const emergency = contents.find(
    (c) => c.venueId === venueId && c.type === "emergency" && isContentActive(c, nowMs)
  );
  return emergency ?? null;
}

function totalDisplayCycle(contents: SignageContent[]): number {
  return contents.reduce((sum, c) => sum + c.displaySeconds, 0);
}

const NOW = 1_700_000_000_000;
const CONTENTS: SignageContent[] = [
  { contentId: "s1", venueId: "v1", type: "announcement", title: "Welcome",    message: "Open 9-9",   priority: 5,  displaySeconds: 10, activeFrom: NOW - 1000, activeUntil: NOW + 86400_000, targetZones: [] },
  { contentId: "s2", venueId: "v1", type: "promotion",    title: "Coffee 20%", message: "Today only", priority: 3,  displaySeconds: 15, activeFrom: NOW - 1000, activeUntil: NOW + 86400_000, targetZones: ["lobby"] },
  { contentId: "s3", venueId: "v1", type: "emergency",    title: "Fire Drill", message: "Evacuate",   priority: 10, displaySeconds: 5,  activeFrom: NOW - 500,  activeUntil: NOW + 3600_000,  targetZones: [] },
  { contentId: "s4", venueId: "v2", type: "announcement", title: "v2 content", message: "Other",      priority: 5,  displaySeconds: 10, activeFrom: NOW - 1000, activeUntil: NOW + 86400_000, targetZones: [] },
];

describe("Venue digital signage", () => {
  it("isContentActive: within window → true", () => {
    expect(isContentActive(CONTENTS[0], NOW)).toBe(true);
  });

  it("isContentActive: expired → false", () => {
    const expired = { ...CONTENTS[0], activeUntil: NOW - 1 };
    expect(isContentActive(expired, NOW)).toBe(false);
  });

  it("getActiveContents: v1 lobby sorted by priority", () => {
    const active = getActiveContents(CONTENTS, "v1", "lobby", NOW);
    expect(active[0].priority).toBeGreaterThanOrEqual(active[1].priority);
  });

  it("getActiveContents: zone filter includes global (no targetZones)", () => {
    const active = getActiveContents(CONTENTS, "v1", "quiet", NOW);
    expect(active.some((c) => c.type === "announcement")).toBe(true);
  });

  it("getActiveContents: different venue → excluded", () => {
    const active = getActiveContents(CONTENTS, "v1", "lobby", NOW);
    expect(active.every((c) => c.venueId === "v1")).toBe(true);
  });

  it("getEmergencyContent: emergency is active → returns it", () => {
    expect(getEmergencyContent(CONTENTS, "v1", NOW)).not.toBeNull();
  });

  it("getEmergencyContent: no emergency → null", () => {
    expect(getEmergencyContent(CONTENTS, "v2", NOW)).toBeNull();
  });

  it("totalDisplayCycle: sums displaySeconds", () => {
    expect(totalDisplayCycle([CONTENTS[0], CONTENTS[1]])).toBe(25);
  });
});
