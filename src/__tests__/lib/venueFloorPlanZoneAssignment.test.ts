/**
 * Tests for venue floor plan zone-to-team assignment.
 */

interface Team {
  teamId: string;
  name: string;
  size: number;
  preferredZone?: string;
  requiresQuiet: boolean;
  needsWhiteboardAccess: boolean;
}

interface FloorPlanZone {
  zoneId: string;
  venueId: string;
  name: string;
  capacity: number;
  type: "open" | "quiet" | "collaborative" | "private";
  hasWhiteboard: boolean;
  currentTeamId: string | null;
}

function isZoneCompatible(zone: FloorPlanZone, team: Team): boolean {
  if (team.requiresQuiet && zone.type !== "quiet" && zone.type !== "private") return false;
  if (team.needsWhiteboardAccess && !zone.hasWhiteboard) return false;
  if (zone.capacity < team.size) return false;
  return true;
}

function assignZone(
  zones: FloorPlanZone[],
  team: Team
): FloorPlanZone | null {
  const compatible = zones.filter(
    (z) => z.currentTeamId === null && isZoneCompatible(z, team)
  );

  if (compatible.length === 0) return null;

  // Prefer requested zone, then smallest fitting zone
  if (team.preferredZone) {
    const preferred = compatible.find((z) => z.zoneId === team.preferredZone);
    if (preferred) return preferred;
  }

  return compatible.reduce((min, z) => z.capacity < min.capacity ? z : min);
}

function assignTeamsToZones(
  zones: FloorPlanZone[],
  teams: Team[]
): Map<string, string> {
  const assignments = new Map<string, string>();
  const occupiedZones = new Set<string>();

  for (const team of teams) {
    const availableZones = zones.filter((z) => !occupiedZones.has(z.zoneId));
    const match = assignZone(availableZones, team);
    if (match) {
      assignments.set(team.teamId, match.zoneId);
      occupiedZones.add(match.zoneId);
    }
  }

  return assignments;
}

const ZONES: FloorPlanZone[] = [
  { zoneId: "z1", venueId: "v1", name: "Quiet Corner", capacity: 6,  type: "quiet",         hasWhiteboard: false, currentTeamId: null },
  { zoneId: "z2", venueId: "v1", name: "Open Space",   capacity: 20, type: "open",          hasWhiteboard: true,  currentTeamId: null },
  { zoneId: "z3", venueId: "v1", name: "Collab Room",  capacity: 8,  type: "collaborative", hasWhiteboard: true,  currentTeamId: null },
];

const TEAMS: Team[] = [
  { teamId: "t1", name: "Dev Team",    size: 5, requiresQuiet: true,  needsWhiteboardAccess: false },
  { teamId: "t2", name: "Design Team", size: 4, requiresQuiet: false, needsWhiteboardAccess: true  },
];

describe("Floor plan zone assignment", () => {
  it("isZoneCompatible: quiet zone for quiet team → true", () => {
    expect(isZoneCompatible(ZONES[0], TEAMS[0])).toBe(true);
  });

  it("isZoneCompatible: open zone for quiet team → false", () => {
    expect(isZoneCompatible(ZONES[1], TEAMS[0])).toBe(false);
  });

  it("isZoneCompatible: no whiteboard for whiteboard team → false", () => {
    expect(isZoneCompatible(ZONES[0], TEAMS[1])).toBe(false);
  });

  it("assignZone: dev team gets quiet zone", () => {
    const assigned = assignZone(ZONES, TEAMS[0]);
    expect(assigned!.type).toBe("quiet");
  });

  it("assignZone: design team gets whiteboard zone", () => {
    const assigned = assignZone(ZONES, TEAMS[1]);
    expect(assigned!.hasWhiteboard).toBe(true);
  });

  it("assignTeamsToZones: each team gets different zone", () => {
    const assignments = assignTeamsToZones(ZONES, TEAMS);
    expect(assignments.size).toBe(2);
    expect(assignments.get("t1")).not.toBe(assignments.get("t2"));
  });
});
