/**
 * Tests for venue power outage contingency planning.
 */

interface BackupPowerCapacity {
  venueId: string;
  generatorKw: number;
  batteryKwh: number;
  criticalSystemsKw: number;    // minimum required for critical ops
  avgConsumptionKw: number;
}

function estimatedBackupHours(capacity: BackupPowerCapacity): number {
  if (capacity.avgConsumptionKw <= 0) return 0;
  // Battery first, then generator provides continuous power
  const batteryHours = capacity.batteryKwh / capacity.avgConsumptionKw;
  const generatorHours = capacity.generatorKw >= capacity.criticalSystemsKw ? 72 : 0; // 3-day max
  return Math.round((batteryHours + generatorHours) * 10) / 10;
}

function canSupportCriticalOps(capacity: BackupPowerCapacity): boolean {
  return (
    capacity.generatorKw >= capacity.criticalSystemsKw ||
    capacity.batteryKwh / capacity.criticalSystemsKw >= 2 // 2h battery
  );
}

function powerSuficiencyRatio(capacity: BackupPowerCapacity): number {
  if (capacity.criticalSystemsKw === 0) return 1;
  const totalBackup = capacity.generatorKw + (capacity.batteryKwh / 4); // battery as kW equivalent
  return Math.round((totalBackup / capacity.criticalSystemsKw) * 100) / 100;
}

function contingencyPlan(capacity: BackupPowerCapacity): "excellent" | "adequate" | "marginal" | "insufficient" {
  const hours = estimatedBackupHours(capacity);
  if (hours >= 48) return "excellent";
  if (hours >= 24) return "adequate";
  if (hours >= 4) return "marginal";
  return "insufficient";
}

const GOOD_BACKUP: BackupPowerCapacity = {
  venueId: "v1", generatorKw: 20, batteryKwh: 40,
  criticalSystemsKw: 8, avgConsumptionKw: 10,
};

const WEAK_BACKUP: BackupPowerCapacity = {
  venueId: "v2", generatorKw: 0, batteryKwh: 5,
  criticalSystemsKw: 8, avgConsumptionKw: 10,
};

describe("Venue power outage contingency", () => {
  it("estimatedBackupHours: battery + generator = long backup", () => {
    expect(estimatedBackupHours(GOOD_BACKUP)).toBeGreaterThan(70);
  });

  it("estimatedBackupHours: no generator, small battery = 0.5h", () => {
    expect(estimatedBackupHours(WEAK_BACKUP)).toBeCloseTo(0.5, 1);
  });

  it("canSupportCriticalOps: good backup → true", () => {
    expect(canSupportCriticalOps(GOOD_BACKUP)).toBe(true);
  });

  it("canSupportCriticalOps: weak backup → false", () => {
    expect(canSupportCriticalOps(WEAK_BACKUP)).toBe(false);
  });

  it("contingencyPlan: good backup → excellent", () => {
    expect(contingencyPlan(GOOD_BACKUP)).toBe("excellent");
  });

  it("contingencyPlan: weak backup → insufficient", () => {
    expect(contingencyPlan(WEAK_BACKUP)).toBe("insufficient");
  });

  it("powerSuficiencyRatio: more than 1 for good backup", () => {
    expect(powerSuficiencyRatio(GOOD_BACKUP)).toBeGreaterThan(1);
  });
});
