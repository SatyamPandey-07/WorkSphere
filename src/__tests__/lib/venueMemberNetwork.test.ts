/**
 * Tests for venue member social network and connection management.
 */

interface MemberConnection {
  fromUserId: string;
  toUserId: string;
  venueId: string;
  connectedAt: number;
  strength: number; // 1-5 based on interaction frequency
}

function sharedVenueConnections(
  connections: MemberConnection[],
  userId: string,
  venueId: string
): string[] {
  return connections
    .filter((c) => c.venueId === venueId && (c.fromUserId === userId || c.toUserId === userId))
    .map((c) => c.fromUserId === userId ? c.toUserId : c.fromUserId);
}

function strongestConnections(
  connections: MemberConnection[],
  userId: string,
  limit = 5
): MemberConnection[] {
  return connections
    .filter((c) => c.fromUserId === userId || c.toUserId === userId)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit);
}

function connectionStrengthAvg(
  connections: MemberConnection[],
  userId: string
): number {
  const userConns = connections.filter(
    (c) => c.fromUserId === userId || c.toUserId === userId
  );
  if (userConns.length === 0) return 0;
  return userConns.reduce((s, c) => s + c.strength, 0) / userConns.length;
}

function networkSize(connections: MemberConnection[], userId: string): number {
  const seen = new Set<string>();
  for (const c of connections) {
    if (c.fromUserId === userId) seen.add(c.toUserId);
    if (c.toUserId === userId) seen.add(c.fromUserId);
  }
  return seen.size;
}

const NOW = 1_700_000_000_000;
const CONNECTIONS: MemberConnection[] = [
  { fromUserId: "u1", toUserId: "u2", venueId: "v1", connectedAt: NOW - 7200_000, strength: 4 },
  { fromUserId: "u1", toUserId: "u3", venueId: "v1", connectedAt: NOW - 3600_000, strength: 2 },
  { fromUserId: "u2", toUserId: "u4", venueId: "v1", connectedAt: NOW - 1800_000, strength: 3 },
  { fromUserId: "u1", toUserId: "u4", venueId: "v2", connectedAt: NOW - 900_000,  strength: 5 },
];

describe("Venue member network", () => {
  it("sharedVenueConnections: u1 at v1 = [u2, u3]", () => {
    const conns = sharedVenueConnections(CONNECTIONS, "u1", "v1");
    expect(conns).toContain("u2");
    expect(conns).toContain("u3");
  });

  it("strongestConnections: u1 sorted by strength", () => {
    const top = strongestConnections(CONNECTIONS, "u1");
    expect(top[0].strength).toBeGreaterThanOrEqual(top[1].strength);
  });

  it("connectionStrengthAvg: u1 = (4+2+5)/3 ≈ 3.67", () => {
    expect(connectionStrengthAvg(CONNECTIONS, "u1")).toBeCloseTo(11 / 3);
  });

  it("connectionStrengthAvg: no connections → 0", () => {
    expect(connectionStrengthAvg(CONNECTIONS, "u99")).toBe(0);
  });

  it("networkSize: u1 has 3 unique connections", () => {
    expect(networkSize(CONNECTIONS, "u1")).toBe(3);
  });

  it("networkSize: unknown user → 0", () => {
    expect(networkSize(CONNECTIONS, "u99")).toBe(0);
  });
});
