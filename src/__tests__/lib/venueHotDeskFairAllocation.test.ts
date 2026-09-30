/**
 * Tests for fair hot-desk allocation ensuring equal access.
 */

interface HotDeskClaim {
  userId: string;
  venueId: string;
  date: string;
  claimedAt: number;
  seatId: string;
}

function userClaimsOnDate(claims: HotDeskClaim[], userId: string, venueId: string, date: string): number {
  return claims.filter((c) => c.userId === userId && c.venueId === venueId && c.date === date).length;
}

function isFairAllocation(
  claims: HotDeskClaim[],
  userId: string,
  venueId: string,
  date: string,
  maxPerUserPerDay: number
): boolean {
  return userClaimsOnDate(claims, userId, venueId, date) < maxPerUserPerDay;
}

function fairQueuePosition(
  claims: HotDeskClaim[],
  userId: string,
  date: string,
  venueId: string
): number {
  const dateClaims = claims
    .filter((c) => c.venueId === venueId && c.date === date)
    .sort((a, b) => a.claimedAt - b.claimedAt);
  const idx = dateClaims.findIndex((c) => c.userId === userId);
  return idx === -1 ? -1 : idx + 1;
}

function heavyUsers(
  claims: HotDeskClaim[],
  venueId: string,
  period: string[],
  threshold: number
): string[] {
  const counts: Record<string, number> = {};
  claims
    .filter((c) => c.venueId === venueId && period.includes(c.date))
    .forEach((c) => { counts[c.userId] = (counts[c.userId] ?? 0) + 1; });
  return Object.entries(counts)
    .filter(([, n]) => n >= threshold)
    .map(([id]) => id);
}

const NOW = 1_700_000_000_000;
const CLAIMS: HotDeskClaim[] = [
  { userId: "u1", venueId: "v1", date: "2026-10-01", claimedAt: NOW - 3000, seatId: "s1" },
  { userId: "u2", venueId: "v1", date: "2026-10-01", claimedAt: NOW - 2000, seatId: "s2" },
  { userId: "u1", venueId: "v1", date: "2026-10-02", claimedAt: NOW - 1000, seatId: "s1" },
  { userId: "u3", venueId: "v1", date: "2026-10-01", claimedAt: NOW - 1500, seatId: "s3" },
];

describe("Hot-desk fair allocation", () => {
  it("userClaimsOnDate: u1 at v1 on Oct 1 = 1", () => {
    expect(userClaimsOnDate(CLAIMS, "u1", "v1", "2026-10-01")).toBe(1);
  });

  it("isFairAllocation: u1 below limit of 2 → true", () => {
    expect(isFairAllocation(CLAIMS, "u1", "v1", "2026-10-01", 2)).toBe(true);
  });

  it("isFairAllocation: u1 at limit of 1 → false", () => {
    expect(isFairAllocation(CLAIMS, "u1", "v1", "2026-10-01", 1)).toBe(false);
  });

  it("fairQueuePosition: u1 first claim = position 1", () => {
    expect(fairQueuePosition(CLAIMS, "u1", "2026-10-01", "v1")).toBe(1);
  });

  it("fairQueuePosition: u2 second claim = position 2", () => {
    expect(fairQueuePosition(CLAIMS, "u2", "2026-10-01", "v1")).toBe(2);
  });

  it("fairQueuePosition: not in queue → -1", () => {
    expect(fairQueuePosition(CLAIMS, "u99", "2026-10-01", "v1")).toBe(-1);
  });

  it("heavyUsers: u1 uses v1 twice across period → qualifies", () => {
    const period = ["2026-10-01", "2026-10-02"];
    const heavy = heavyUsers(CLAIMS, "v1", period, 2);
    expect(heavy).toContain("u1");
  });
});
