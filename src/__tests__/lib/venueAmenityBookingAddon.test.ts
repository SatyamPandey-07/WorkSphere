/**
 * Tests for venue amenity add-on selection during booking.
 */

interface AmenityAddon {
  addonId: string;
  name: string;
  priceCents: number;
  pricingModel: "per_hour" | "per_session" | "flat_fee";
  isAvailable: boolean;
  maxQuantity: number;
}

interface SelectedAddon {
  addonId: string;
  quantity: number;
  hours?: number;
}

function calculateAddonCost(
  addon: AmenityAddon,
  selected: SelectedAddon
): number {
  if (addon.pricingModel === "flat_fee") return addon.priceCents;
  if (addon.pricingModel === "per_session") return addon.priceCents * selected.quantity;
  if (addon.pricingModel === "per_hour") return addon.priceCents * (selected.hours ?? 1) * selected.quantity;
  return 0;
}

function validateAddonSelection(
  addon: AmenityAddon,
  selected: SelectedAddon
): { valid: boolean; reason?: string } {
  if (!addon.isAvailable) return { valid: false, reason: "Not available" };
  if (selected.quantity > addon.maxQuantity) return { valid: false, reason: `Max ${addon.maxQuantity}` };
  if (selected.quantity <= 0) return { valid: false, reason: "Quantity must be positive" };
  return { valid: true };
}

function totalAddonsCost(
  addons: AmenityAddon[],
  selections: SelectedAddon[]
): number {
  return selections.reduce((sum, sel) => {
    const addon = addons.find((a) => a.addonId === sel.addonId);
    return sum + (addon ? calculateAddonCost(addon, sel) : 0);
  }, 0);
}

const ADDONS: AmenityAddon[] = [
  { addonId: "a1", name: "Coffee",     priceCents: 300,  pricingModel: "per_session", isAvailable: true,  maxQuantity: 10 },
  { addonId: "a2", name: "Whiteboard", priceCents: 200,  pricingModel: "per_hour",    isAvailable: true,  maxQuantity: 2  },
  { addonId: "a3", name: "Projector",  priceCents: 1500, pricingModel: "flat_fee",    isAvailable: false, maxQuantity: 1  },
];

describe("Venue amenity booking add-ons", () => {
  it("calculateAddonCost: per_session × quantity", () => {
    expect(calculateAddonCost(ADDONS[0], { addonId: "a1", quantity: 5 })).toBe(1500);
  });

  it("calculateAddonCost: per_hour × hours × quantity", () => {
    expect(calculateAddonCost(ADDONS[1], { addonId: "a2", quantity: 1, hours: 3 })).toBe(600);
  });

  it("calculateAddonCost: flat_fee ignores quantity", () => {
    expect(calculateAddonCost(ADDONS[2], { addonId: "a3", quantity: 1 })).toBe(1500);
  });

  it("validateAddonSelection: unavailable → false", () => {
    const { valid, reason } = validateAddonSelection(ADDONS[2], { addonId: "a3", quantity: 1 });
    expect(valid).toBe(false);
    expect(reason).toContain("Not available");
  });

  it("validateAddonSelection: exceeds max → false", () => {
    const { valid } = validateAddonSelection(ADDONS[1], { addonId: "a2", quantity: 5 });
    expect(valid).toBe(false);
  });

  it("validateAddonSelection: valid selection", () => {
    expect(validateAddonSelection(ADDONS[0], { addonId: "a1", quantity: 3 }).valid).toBe(true);
  });

  it("totalAddonsCost: sum of all selected", () => {
    const selections: SelectedAddon[] = [
      { addonId: "a1", quantity: 2 },      // 2 × 300 = 600
      { addonId: "a2", quantity: 1, hours: 2 }, // 1 × 2h × 200 = 400
    ];
    expect(totalAddonsCost(ADDONS, selections)).toBe(1000);
  });
});
