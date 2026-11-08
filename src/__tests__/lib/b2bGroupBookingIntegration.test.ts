/**
 * Integration tests for B2B group booking flow (Issue #2083).
 * Tests the AI context string for group size requirements.
 */

interface GroupBookingContext {
  headcount: number;
  requirePrivateArea: boolean;
  venueType?: string;
}

function buildGroupBookingQuery(ctx: GroupBookingContext): string {
  const parts: string[] = [];

  if (ctx.headcount > 1) {
    parts.push(`${ctx.headcount}-person group`);
  }

  if (ctx.requirePrivateArea) {
    parts.push("private meeting area");
  }

  if (ctx.venueType) {
    parts.push(ctx.venueType);
  }

  return parts.length > 0
    ? `Looking for: ${parts.join(", ")}.`
    : "Looking for a workspace.";
}

function canAccommodateGroup(
  meetingRoomCapacity: number | null | undefined,
  headcount: number,
): boolean {
  if (!meetingRoomCapacity) return false;
  return meetingRoomCapacity >= headcount;
}

describe("B2B group booking context building", () => {
  it("includes headcount in query for groups > 1", () => {
    const query = buildGroupBookingQuery({ headcount: 15, requirePrivateArea: false });
    expect(query).toContain("15-person group");
  });

  it("includes private area requirement", () => {
    const query = buildGroupBookingQuery({ headcount: 10, requirePrivateArea: true });
    expect(query).toContain("private meeting area");
  });

  it("single person query is simple", () => {
    const query = buildGroupBookingQuery({ headcount: 1, requirePrivateArea: false });
    expect(query).not.toContain("group");
  });

  it("combines headcount, private area, and venue type", () => {
    const query = buildGroupBookingQuery({
      headcount: 20,
      requirePrivateArea: true,
      venueType: "coworking",
    });
    expect(query).toContain("20-person group");
    expect(query).toContain("private meeting area");
    expect(query).toContain("coworking");
  });
});

describe("Group capacity check", () => {
  it("returns false when no capacity data", () => {
    expect(canAccommodateGroup(null, 10)).toBe(false);
    expect(canAccommodateGroup(undefined, 10)).toBe(false);
    expect(canAccommodateGroup(0, 10)).toBe(false);
  });

  it("returns true when capacity >= headcount", () => {
    expect(canAccommodateGroup(20, 15)).toBe(true);
    expect(canAccommodateGroup(10, 10)).toBe(true);
  });

  it("returns false when capacity < headcount", () => {
    expect(canAccommodateGroup(8, 12)).toBe(false);
    expect(canAccommodateGroup(4, 5)).toBe(false);
  });
});
