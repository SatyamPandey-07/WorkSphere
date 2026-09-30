/**
 * Tests for smart desk assignment algorithm using team proximity.
 */

interface TeamMember {
  userId: string;
  teamId: string;
  preferredZone?: string;
}

interface DeskSlot {
  deskId: string;
  zone: string;
  floorNumber: number;
  isAvailable: boolean;
  nearbyDesks: string[]; // adjacent desk IDs
}

function assignTeamDesks(
  members: TeamMember[],
  desks: DeskSlot[],
  date: string
): Map<string, string> {
  const available = desks.filter((d) => d.isAvailable);
  const assignments = new Map<string, string>();

  // First pass: assign by preferred zone
  for (const member of members) {
    if (assignments.has(member.userId)) continue;
    const preferred = member.preferredZone
      ? available.find((d) => d.zone === member.preferredZone && !Array.from(assignments.values()).includes(d.deskId))
      : null;
    if (preferred) {
      assignments.set(member.userId, preferred.deskId);
    }
  }

  // Second pass: assign remaining by team proximity
  const unassigned = members.filter((m) => !assignments.has(m.userId));
  const usedDesks = new Set(assignments.values());

  for (const member of unassigned) {
    // Try to find desk near a teammate
    const teamAssignments = members
      .filter((m) => m.teamId === member.teamId && assignments.has(m.userId))
      .map((m) => assignments.get(m.userId)!);

    const nearTeam = available.find(
      (d) => !usedDesks.has(d.deskId) && d.nearbyDesks.some((nd) => teamAssignments.includes(nd))
    );

    if (nearTeam) {
      assignments.set(member.userId, nearTeam.deskId);
      usedDesks.add(nearTeam.deskId);
    } else {
      // Fallback: any available desk
      const fallback = available.find((d) => !usedDesks.has(d.deskId));
      if (fallback) {
        assignments.set(member.userId, fallback.deskId);
        usedDesks.add(fallback.deskId);
      }
    }
  }

  return assignments;
}

function teamClusterScore(assignments: Map<string, string>, members: TeamMember[], desks: DeskSlot[]): number {
  let adjacentPairs = 0;
  let totalPairs = 0;

  const teamMembers = members.filter((m, i, arr) => arr.indexOf(m) === i);
  for (let i = 0; i < teamMembers.length; i++) {
    for (let j = i + 1; j < teamMembers.length; j++) {
      if (teamMembers[i].teamId !== teamMembers[j].teamId) continue;
      totalPairs++;
      const deskA = assignments.get(teamMembers[i].userId);
      const deskB = assignments.get(teamMembers[j].userId);
      if (!deskA || !deskB) continue;
      const desk = desks.find((d) => d.deskId === deskA);
      if (desk && desk.nearbyDesks.includes(deskB)) adjacentPairs++;
    }
  }
  return totalPairs === 0 ? 100 : Math.round((adjacentPairs / totalPairs) * 100);
}

const DESKS: DeskSlot[] = [
  { deskId: "d1", zone: "teamA", floorNumber: 1, isAvailable: true, nearbyDesks: ["d2", "d3"] },
  { deskId: "d2", zone: "teamA", floorNumber: 1, isAvailable: true, nearbyDesks: ["d1", "d3"] },
  { deskId: "d3", zone: "teamA", floorNumber: 1, isAvailable: true, nearbyDesks: ["d1", "d2"] },
  { deskId: "d4", zone: "quiet", floorNumber: 2, isAvailable: true, nearbyDesks: []           },
];

const MEMBERS: TeamMember[] = [
  { userId: "u1", teamId: "t1", preferredZone: "teamA" },
  { userId: "u2", teamId: "t1" },
  { userId: "u3", teamId: "t1" },
];

describe("Smart desk assignment", () => {
  it("assignTeamDesks: assigns all members", () => {
    const assignments = assignTeamDesks(MEMBERS, DESKS, "2026-10-01");
    expect(assignments.size).toBe(3);
  });

  it("assignTeamDesks: preferred zone honored for u1", () => {
    const assignments = assignTeamDesks(MEMBERS, DESKS, "2026-10-01");
    const u1Desk = DESKS.find((d) => d.deskId === assignments.get("u1"));
    expect(u1Desk!.zone).toBe("teamA");
  });

  it("assignTeamDesks: no duplicate desks", () => {
    const assignments = assignTeamDesks(MEMBERS, DESKS, "2026-10-01");
    const usedDesks = Array.from(assignments.values());
    expect(new Set(usedDesks).size).toBe(usedDesks.length);
  });

  it("teamClusterScore: all in adjacent desks → high score", () => {
    const assignments = assignTeamDesks(MEMBERS, DESKS, "2026-10-01");
    const score = teamClusterScore(assignments, MEMBERS, DESKS);
    expect(score).toBeGreaterThan(50);
  });
});
