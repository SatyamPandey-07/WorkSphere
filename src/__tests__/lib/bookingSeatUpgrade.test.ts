/**
 * Tests for booking seat upgrade eligibility and cost.
 */

type SeatClass = "standard" | "comfort" | "premium";

interface SeatUpgradeOption {
  from: SeatClass;
  to: SeatClass;
  upgradeCostCents: number;
  availableUnits: number;
}

function canUpgrade(
  option: SeatUpgradeOption,
  required: number
): boolean {
  return option.availableUnits >= required;
}

function upgradeTotalCost(
  option: SeatUpgradeOption,
  seats: number,
  durationHours: number
): number {
  return option.upgradeCostCents * seats * durationHours;
}

function findCheapestUpgrade(
  options: SeatUpgradeOption[],
  from: SeatClass,
  requiredSeats: number
): SeatUpgradeOption | null {
  const eligible = options.filter(
    (o) => o.from === from && canUpgrade(o, requiredSeats)
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((min, o) => o.upgradeCostCents < min.upgradeCostCents ? o : min);
}

const UPGRADE_OPTIONS: SeatUpgradeOption[] = [
  { from: "standard", to: "comfort",  upgradeCostCents: 200, availableUnits: 5 },
  { from: "standard", to: "premium",  upgradeCostCents: 500, availableUnits: 2 },
  { from: "comfort",  to: "premium",  upgradeCostCents: 300, availableUnits: 2 },
];

describe("Booking seat upgrade", () => {
  it("canUpgrade: 3 units needed, 5 available → true", () => {
    expect(canUpgrade(UPGRADE_OPTIONS[0], 3)).toBe(true);
  });

  it("canUpgrade: 3 units needed, 2 available → false", () => {
    expect(canUpgrade(UPGRADE_OPTIONS[1], 3)).toBe(false);
  });

  it("upgradeTotalCost: 2 seats × 3h × 200 = 1200", () => {
    expect(upgradeTotalCost(UPGRADE_OPTIONS[0], 2, 3)).toBe(1200);
  });

  it("upgradeTotalCost: 1 seat × 1h", () => {
    expect(upgradeTotalCost(UPGRADE_OPTIONS[0], 1, 1)).toBe(200);
  });

  it("findCheapestUpgrade: standard cheapest is comfort", () => {
    expect(findCheapestUpgrade(UPGRADE_OPTIONS, "standard", 1)!.to).toBe("comfort");
  });

  it("findCheapestUpgrade: need 3 seats from standard → comfort (only option with 3+)", () => {
    expect(findCheapestUpgrade(UPGRADE_OPTIONS, "standard", 3)!.to).toBe("comfort");
  });

  it("findCheapestUpgrade: no options → null", () => {
    expect(findCheapestUpgrade(UPGRADE_OPTIONS, "premium", 1)).toBeNull();
  });

  it("findCheapestUpgrade: need too many seats → null", () => {
    expect(findCheapestUpgrade(UPGRADE_OPTIONS, "standard", 6)).toBeNull();
  });
});
