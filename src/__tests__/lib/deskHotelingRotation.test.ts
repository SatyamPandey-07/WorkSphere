/**
 * Tests for hot-desk rotation assignment logic.
 */

interface DeskAssignment {
  deskId: string;
  userId: string;
  date: string; // YYYY-MM-DD
}

function assignDesks(
  userIds: string[],
  desks: string[],
  date: string
): DeskAssignment[] {
  if (desks.length < userIds.length) {
    throw new Error("Not enough desks for all users");
  }
  // Simple sequential assignment
  return userIds.map((userId, i) => ({
    deskId: desks[i],
    userId,
    date,
  }));
}

function userDesk(assignments: DeskAssignment[], userId: string, date: string): string | null {
  const a = assignments.find((a) => a.userId === userId && a.date === date);
  return a ? a.deskId : null;
}

function desksInUse(assignments: DeskAssignment[], date: string): string[] {
  return assignments.filter((a) => a.date === date).map((a) => a.deskId);
}

describe("Hot-desk rotation assignment", () => {
  const DESKS = ["D1", "D2", "D3", "D4"];
  const USERS = ["u1", "u2", "u3"];

  it("assigns one desk per user", () => {
    const result = assignDesks(USERS, DESKS, "2026-10-01");
    expect(result).toHaveLength(3);
  });

  it("each user gets a unique desk", () => {
    const result = assignDesks(USERS, DESKS, "2026-10-01");
    const deskIds = result.map((r) => r.deskId);
    expect(new Set(deskIds).size).toBe(deskIds.length);
  });

  it("throws when not enough desks", () => {
    expect(() => assignDesks(["u1", "u2", "u3"], ["D1", "D2"], "2026-10-01")).toThrow();
  });

  it("userDesk returns correct desk", () => {
    const result = assignDesks(USERS, DESKS, "2026-10-01");
    expect(userDesk(result, "u1", "2026-10-01")).toBe("D1");
  });

  it("userDesk returns null for unknown user", () => {
    const result = assignDesks(USERS, DESKS, "2026-10-01");
    expect(userDesk(result, "u99", "2026-10-01")).toBeNull();
  });

  it("desksInUse returns all assigned desks for date", () => {
    const result = assignDesks(USERS, DESKS, "2026-10-01");
    expect(desksInUse(result, "2026-10-01")).toHaveLength(3);
  });

  it("desksInUse empty for different date", () => {
    const result = assignDesks(USERS, DESKS, "2026-10-01");
    expect(desksInUse(result, "2026-10-02")).toHaveLength(0);
  });
});
