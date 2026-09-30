/**
 * Tests for venue digital twin state synchronization.
 */

interface RealWorldState {
  venueId: string;
  timestamp: number;
  sensors: Record<string, number>;  // sensorId -> value
  occupancy: number;
  activeAmenities: string[];
}

interface DigitalTwinState extends RealWorldState {
  syncVersion: number;
  lastSyncedAt: number;
  pendingUpdates: string[];
}

function syncTwin(
  twin: DigitalTwinState,
  realWorld: RealWorldState,
  nowMs: number
): DigitalTwinState {
  return {
    ...twin,
    ...realWorld,
    syncVersion: twin.syncVersion + 1,
    lastSyncedAt: nowMs,
    pendingUpdates: [],
  };
}

function twinDrift(twin: DigitalTwinState, realWorld: RealWorldState): number {
  const sensorDrift = Object.entries(realWorld.sensors).reduce((sum, [id, val]) => {
    const twinVal = twin.sensors[id] ?? 0;
    return sum + Math.abs(val - twinVal);
  }, 0);
  const occupancyDrift = Math.abs(twin.occupancy - realWorld.occupancy);
  return sensorDrift + occupancyDrift;
}

function needsResync(twin: DigitalTwinState, realWorld: RealWorldState, maxDrift = 10): boolean {
  return twinDrift(twin, realWorld) > maxDrift;
}

function addPendingUpdate(twin: DigitalTwinState, updateId: string): DigitalTwinState {
  if (twin.pendingUpdates.includes(updateId)) return twin;
  return { ...twin, pendingUpdates: [...twin.pendingUpdates, updateId] };
}

const NOW = 1_700_000_000_000;
const REAL_WORLD: RealWorldState = {
  venueId: "v1", timestamp: NOW,
  sensors: { temp: 22, humidity: 45, co2: 600 },
  occupancy: 15, activeAmenities: ["wifi", "coffee"],
};

const TWIN: DigitalTwinState = {
  ...REAL_WORLD, syncVersion: 5, lastSyncedAt: NOW - 60_000,
  pendingUpdates: [],
};

describe("Venue digital twin", () => {
  it("syncTwin: updates all fields and increments version", () => {
    const newReal = { ...REAL_WORLD, occupancy: 18, timestamp: NOW };
    const updated = syncTwin(TWIN, newReal, NOW);
    expect(updated.occupancy).toBe(18);
    expect(updated.syncVersion).toBe(6);
    expect(updated.lastSyncedAt).toBe(NOW);
  });

  it("twinDrift: in sync → 0", () => {
    expect(twinDrift(TWIN, REAL_WORLD)).toBe(0);
  });

  it("twinDrift: occupancy changed → non-zero", () => {
    const deviated = { ...REAL_WORLD, occupancy: 20 };
    expect(twinDrift(TWIN, deviated)).toBe(5); // 20-15
  });

  it("needsResync: within tolerance → false", () => {
    expect(needsResync(TWIN, REAL_WORLD)).toBe(false);
  });

  it("needsResync: large drift → true", () => {
    const drifted = { ...REAL_WORLD, sensors: { temp: 30, humidity: 80, co2: 1200 }, occupancy: 30 };
    expect(needsResync(TWIN, drifted, 5)).toBe(true);
  });

  it("addPendingUpdate: adds update", () => {
    const updated = addPendingUpdate(TWIN, "update-1");
    expect(updated.pendingUpdates).toContain("update-1");
  });

  it("addPendingUpdate: no duplicate", () => {
    const t1 = addPendingUpdate(TWIN, "u1");
    const t2 = addPendingUpdate(t1, "u1");
    expect(t2.pendingUpdates.filter((u) => u === "u1")).toHaveLength(1);
  });
});
