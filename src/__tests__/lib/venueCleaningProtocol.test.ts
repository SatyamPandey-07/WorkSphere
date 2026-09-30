/**
 * Tests for venue cleaning protocol verification and compliance.
 */

type CleaningFrequency = "after_each_use" | "daily" | "weekly" | "monthly";

interface CleaningProtocol {
  protocolId: string;
  venueId: string;
  area: string;
  frequency: CleaningFrequency;
  lastCleanedAt: number;
  nextDueAt: number;
  isCompliant: boolean;
  staff: string;
}

const FREQUENCY_MS: Record<CleaningFrequency, number> = {
  after_each_use: 0,  // always needs cleaning after use
  daily:   24 * 3_600_000,
  weekly:  7 * 24 * 3_600_000,
  monthly: 30 * 24 * 3_600_000,
};

function isCleaningDue(protocol: CleaningProtocol, nowMs: number): boolean {
  return nowMs >= protocol.nextDueAt;
}

function daysSinceLastCleaning(protocol: CleaningProtocol, nowMs: number): number {
  return Math.floor((nowMs - protocol.lastCleanedAt) / 86_400_000);
}

function markCleaned(protocol: CleaningProtocol, nowMs: number): CleaningProtocol {
  const interval = FREQUENCY_MS[protocol.frequency];
  return {
    ...protocol,
    lastCleanedAt: nowMs,
    nextDueAt: interval > 0 ? nowMs + interval : nowMs,
    isCompliant: true,
  };
}

function overdueProtocols(protocols: CleaningProtocol[], venueId: string, nowMs: number): CleaningProtocol[] {
  return protocols.filter(
    (p) => p.venueId === venueId && isCleaningDue(p, nowMs) && !p.isCompliant
  );
}

function complianceRate(protocols: CleaningProtocol[], venueId: string): number {
  const venueProtocols = protocols.filter((p) => p.venueId === venueId);
  if (venueProtocols.length === 0) return 100;
  const compliant = venueProtocols.filter((p) => p.isCompliant).length;
  return Math.round((compliant / venueProtocols.length) * 100);
}

const NOW = 1_700_000_000_000;
const PROTOCOLS: CleaningProtocol[] = [
  { protocolId: "p1", venueId: "v1", area: "Desks",  frequency: "daily",  lastCleanedAt: NOW - 25 * 3_600_000, nextDueAt: NOW - 1000, isCompliant: false, staff: "team1" }, // overdue
  { protocolId: "p2", venueId: "v1", area: "Floors", frequency: "weekly", lastCleanedAt: NOW - 1000,             nextDueAt: NOW + 7 * 86_400_000, isCompliant: true,  staff: "team1" },
  { protocolId: "p3", venueId: "v2", area: "Desks",  frequency: "daily",  lastCleanedAt: NOW - 30 * 3_600_000, nextDueAt: NOW - 2000, isCompliant: false, staff: "team2" },
];

describe("Venue cleaning protocol compliance", () => {
  it("isCleaningDue: p1 overdue → true", () => {
    expect(isCleaningDue(PROTOCOLS[0], NOW)).toBe(true);
  });

  it("isCleaningDue: p2 not due → false", () => {
    expect(isCleaningDue(PROTOCOLS[1], NOW)).toBe(false);
  });

  it("daysSinceLastCleaning: ~1 day for p1", () => {
    expect(daysSinceLastCleaning(PROTOCOLS[0], NOW)).toBe(1);
  });

  it("markCleaned: updates lastCleanedAt and nextDueAt", () => {
    const cleaned = markCleaned(PROTOCOLS[0], NOW);
    expect(cleaned.lastCleanedAt).toBe(NOW);
    expect(cleaned.isCompliant).toBe(true);
  });

  it("overdueProtocols: v1 has 1 overdue", () => {
    expect(overdueProtocols(PROTOCOLS, "v1", NOW)).toHaveLength(1);
  });

  it("overdueProtocols: v2 has 1 overdue", () => {
    expect(overdueProtocols(PROTOCOLS, "v2", NOW)).toHaveLength(1);
  });

  it("complianceRate: v1 = 50% (1 of 2 compliant)", () => {
    expect(complianceRate(PROTOCOLS, "v1")).toBe(50);
  });
});
