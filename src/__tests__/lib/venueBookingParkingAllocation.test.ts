/**
 * Tests for venue parking space allocation logic.
 */

type SpaceType = "standard" | "accessible" | "ev_charging" | "vip" | "motorcycle";

interface ParkingSpace {
  id: string;
  type: SpaceType;
  level: number;
  isOccupied: boolean;
  reservedFor: string | null;
}

interface ParkingRequest {
  guestId: string;
  preferredType: SpaceType;
  needsAccessible: boolean;
  hasEv: boolean;
}

function availableSpaces(spaces: ParkingSpace[], type?: SpaceType): ParkingSpace[] {
  return spaces.filter((s) => !s.isOccupied && !s.reservedFor && (type ? s.type === type : true));
}

function allocateSpace(spaces: ParkingSpace[], request: ParkingRequest): ParkingSpace | null {
  if (request.needsAccessible) {
    const acc = availableSpaces(spaces, "accessible");
    if (acc.length) return acc[0];
  }
  if (request.hasEv) {
    const ev = availableSpaces(spaces, "ev_charging");
    if (ev.length) return ev[0];
  }
  const preferred = availableSpaces(spaces, request.preferredType);
  if (preferred.length) return preferred[0];
  return availableSpaces(spaces)[0] ?? null;
}

function occupancyRate(spaces: ParkingSpace[]): number {
  if (spaces.length === 0) return 0;
  return Math.round((spaces.filter((s) => s.isOccupied || s.reservedFor).length / spaces.length) * 100);
}

function levelSummary(spaces: ParkingSpace[]): Record<number, { total: number; available: number }> {
  const summary: Record<number, { total: number; available: number }> = {};
  for (const s of spaces) {
    if (!summary[s.level]) summary[s.level] = { total: 0, available: 0 };
    summary[s.level].total++;
    if (!s.isOccupied && !s.reservedFor) summary[s.level].available++;
  }
  return summary;
}

const SPACES: ParkingSpace[] = [
  { id: "p1", type: "standard",   level: 1, isOccupied: false, reservedFor: null },
  { id: "p2", type: "accessible", level: 1, isOccupied: false, reservedFor: null },
  { id: "p3", type: "ev_charging",level: 1, isOccupied: true,  reservedFor: null },
  { id: "p4", type: "vip",        level: 2, isOccupied: false, reservedFor: "g99" },
  { id: "p5", type: "standard",   level: 2, isOccupied: false, reservedFor: null },
];

describe("Parking space allocation", () => {
  it("availableSpaces: 3 free spaces total", () => {
    expect(availableSpaces(SPACES).length).toBe(3);
  });

  it("allocateSpace: accessible request → accessible space", () => {
    const req: ParkingRequest = { guestId: "g1", preferredType: "standard", needsAccessible: true, hasEv: false };
    expect(allocateSpace(SPACES, req)?.type).toBe("accessible");
  });

  it("allocateSpace: EV with no EV available → standard fallback", () => {
    const noEv = SPACES.filter((s) => s.type !== "ev_charging");
    const req: ParkingRequest = { guestId: "g2", preferredType: "standard", needsAccessible: false, hasEv: true };
    expect(allocateSpace(noEv, req)).not.toBeNull();
  });

  it("occupancyRate: 2 occupied of 5 = 40%", () => {
    expect(occupancyRate(SPACES)).toBe(40);
  });

  it("levelSummary: level 1 has 2 available of 3", () => {
    const summary = levelSummary(SPACES);
    expect(summary[1].total).toBe(3);
    expect(summary[1].available).toBe(2);
  });
});
