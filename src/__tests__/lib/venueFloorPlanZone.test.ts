/**
 * Tests for venue floor plan zone management (quiet, collaborative, phone).
 */

type ZoneType = "quiet" | "collaborative" | "phone_booths" | "kitchen" | "reception";

interface FloorZone {
  zoneId: string;
  type: ZoneType;
  capacity: number;
  currentOccupancy: number;
  soundPolicy: "silent" | "whisper" | "normal" | "loud";
}

function zoneUtilization(zone: FloorZone): number {
  if (zone.capacity === 0) return 0;
  return Math.round((zone.currentOccupancy / zone.capacity) * 100);
}

function availableCapacity(zone: FloorZone): number {
  return Math.max(0, zone.capacity - zone.currentOccupancy);
}

function getQuietZones(zones: FloorZone[]): FloorZone[] {
  return zones.filter((z) => z.soundPolicy === "silent" || z.soundPolicy === "whisper");
}

function totalFloorCapacity(zones: FloorZone[]): number {
  return zones.reduce((sum, z) => sum + z.capacity, 0);
}

function suggestZoneForPurpose(
  zones: FloorZone[],
  purpose: "focus" | "call" | "team"
): FloorZone | null {
  const preferred: Record<string, ZoneType[]> = {
    focus: ["quiet"],
    call:  ["phone_booths"],
    team:  ["collaborative"],
  };
  const targetTypes = preferred[purpose];
  const available = zones.filter(
    (z) => targetTypes.includes(z.type) && availableCapacity(z) > 0
  );
  if (available.length === 0) return null;
  return available.reduce((best, z) =>
    availableCapacity(z) > availableCapacity(best) ? z : best
  );
}

const ZONES: FloorZone[] = [
  { zoneId: "z1", type: "quiet",         capacity: 20, currentOccupancy: 10, soundPolicy: "silent"  },
  { zoneId: "z2", type: "collaborative", capacity: 30, currentOccupancy: 5,  soundPolicy: "normal"  },
  { zoneId: "z3", type: "phone_booths",  capacity: 6,  currentOccupancy: 4,  soundPolicy: "whisper" },
  { zoneId: "z4", type: "kitchen",       capacity: 10, currentOccupancy: 3,  soundPolicy: "loud"    },
];

describe("Venue floor plan zones", () => {
  it("zoneUtilization: 10/20 = 50%", () => {
    expect(zoneUtilization(ZONES[0])).toBe(50);
  });

  it("zoneUtilization: 0 capacity → 0", () => {
    expect(zoneUtilization({ ...ZONES[0], capacity: 0 })).toBe(0);
  });

  it("availableCapacity: 20 - 10 = 10", () => {
    expect(availableCapacity(ZONES[0])).toBe(10);
  });

  it("availableCapacity: clamps to 0 when overcrowded", () => {
    expect(availableCapacity({ ...ZONES[0], currentOccupancy: 25 })).toBe(0);
  });

  it("getQuietZones: silent + whisper zones", () => {
    const quiet = getQuietZones(ZONES);
    expect(quiet.map((z) => z.zoneId)).toContain("z1");
    expect(quiet.map((z) => z.zoneId)).toContain("z3");
  });

  it("totalFloorCapacity: 20+30+6+10 = 66", () => {
    expect(totalFloorCapacity(ZONES)).toBe(66);
  });

  it("suggestZoneForPurpose: focus → quiet zone", () => {
    expect(suggestZoneForPurpose(ZONES, "focus")!.type).toBe("quiet");
  });

  it("suggestZoneForPurpose: call → phone booth", () => {
    expect(suggestZoneForPurpose(ZONES, "call")!.type).toBe("phone_booths");
  });

  it("suggestZoneForPurpose: no availability → null", () => {
    const full = ZONES.map((z) => ({ ...z, currentOccupancy: z.capacity }));
    expect(suggestZoneForPurpose(full, "focus")).toBeNull();
  });
});
