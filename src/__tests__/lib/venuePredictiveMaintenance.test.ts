/**
 * Tests for venue predictive maintenance scheduling.
 */

interface EquipmentAsset {
  assetId: string;
  venueId: string;
  name: string;
  lastMaintainedAt: number;
  maintenanceIntervalDays: number;
  currentConditionScore: number;  // 0-100 (100=perfect)
  criticality: "low" | "medium" | "high" | "critical";
  predictedFailureProbability: number; // 0-1
}

function maintenanceDueDate(asset: EquipmentAsset): number {
  return asset.lastMaintainedAt + asset.maintenanceIntervalDays * 86_400_000;
}

function isMaintenanceDue(asset: EquipmentAsset, nowMs: number): boolean {
  return nowMs >= maintenanceDueDate(asset);
}

function maintenanceUrgency(asset: EquipmentAsset, nowMs: number): "ok" | "due_soon" | "overdue" | "emergency" {
  if (asset.predictedFailureProbability > 0.7 || asset.currentConditionScore < 20) return "emergency";
  if (nowMs > maintenanceDueDate(asset)) return "overdue";
  const daysUntilDue = (maintenanceDueDate(asset) - nowMs) / 86_400_000;
  if (daysUntilDue <= 7) return "due_soon";
  return "ok";
}

function prioritizeAssets(assets: EquipmentAsset[], venueId: string, nowMs: number): EquipmentAsset[] {
  const urgencyOrder = { emergency: 0, overdue: 1, due_soon: 2, ok: 3 };
  return assets
    .filter((a) => a.venueId === venueId)
    .sort((a, b) => {
      const uA = maintenanceUrgency(a, nowMs);
      const uB = maintenanceUrgency(b, nowMs);
      if (urgencyOrder[uA] !== urgencyOrder[uB]) return urgencyOrder[uA] - urgencyOrder[uB];
      // Tie: critical assets first
      const critOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return critOrder[a.criticality] - critOrder[b.criticality];
    });
}

const NOW = 1_700_000_000_000;
const ASSETS: EquipmentAsset[] = [
  { assetId: "a1", venueId: "v1", name: "HVAC Unit",      lastMaintainedAt: NOW - 100 * 86_400_000, maintenanceIntervalDays: 90,  currentConditionScore: 75, criticality: "critical", predictedFailureProbability: 0.2 },
  { assetId: "a2", venueId: "v1", name: "Elevator",       lastMaintainedAt: NOW - 30 * 86_400_000,  maintenanceIntervalDays: 180, currentConditionScore: 90, criticality: "critical", predictedFailureProbability: 0.05 },
  { assetId: "a3", venueId: "v1", name: "Fire System",    lastMaintainedAt: NOW - 5 * 86_400_000,   maintenanceIntervalDays: 365, currentConditionScore: 15, criticality: "critical", predictedFailureProbability: 0.8  },
];

describe("Venue predictive maintenance", () => {
  it("isMaintenanceDue: 100 days since 90-day interval → overdue", () => {
    expect(isMaintenanceDue(ASSETS[0], NOW)).toBe(true);
  });

  it("isMaintenanceDue: 30 days since 180-day interval → not due", () => {
    expect(isMaintenanceDue(ASSETS[1], NOW)).toBe(false);
  });

  it("maintenanceUrgency: fire system (high failure probability) → emergency", () => {
    expect(maintenanceUrgency(ASSETS[2], NOW)).toBe("emergency");
  });

  it("maintenanceUrgency: HVAC overdue → overdue", () => {
    expect(maintenanceUrgency(ASSETS[0], NOW)).toBe("overdue");
  });

  it("maintenanceUrgency: elevator ok → ok", () => {
    expect(maintenanceUrgency(ASSETS[1], NOW)).toBe("ok");
  });

  it("prioritizeAssets: emergency first (fire system)", () => {
    const prioritized = prioritizeAssets(ASSETS, "v1", NOW);
    expect(prioritized[0].assetId).toBe("a3");
  });

  it("prioritizeAssets: overdue second (HVAC)", () => {
    const prioritized = prioritizeAssets(ASSETS, "v1", NOW);
    expect(prioritized[1].assetId).toBe("a1");
  });
});
