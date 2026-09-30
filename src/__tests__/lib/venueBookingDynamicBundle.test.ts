/**
 * Tests for dynamic bundle creation based on booking context.
 */

interface BundleComponent {
  componentId: string;
  name: string;
  basePriceCents: number;
  isMandatory: boolean;
  eligibleForDiscount: boolean;
}

interface DynamicBundle {
  bundleId: string;
  bookingId: string;
  components: BundleComponent[];
  bundleDiscountPct: number;
  validUntil: number;
}

function bundleSubtotal(bundle: DynamicBundle): number {
  return bundle.components.reduce((s, c) => s + c.basePriceCents, 0);
}

function discountableSubtotal(bundle: DynamicBundle): number {
  return bundle.components
    .filter((c) => c.eligibleForDiscount)
    .reduce((s, c) => s + c.basePriceCents, 0);
}

function bundleTotal(bundle: DynamicBundle): number {
  const discountable = discountableSubtotal(bundle);
  const nonDiscountable = bundleSubtotal(bundle) - discountable;
  const discount = Math.round(discountable * (bundle.bundleDiscountPct / 100));
  return nonDiscountable + discountable - discount;
}

function canAddComponent(bundle: DynamicBundle, component: BundleComponent): boolean {
  // No duplicates
  return !bundle.components.some((c) => c.componentId === component.componentId);
}

function removeOptionalComponents(bundle: DynamicBundle): DynamicBundle {
  return {
    ...bundle,
    components: bundle.components.filter((c) => c.isMandatory),
  };
}

function isBundleExpired(bundle: DynamicBundle, nowMs: number): boolean {
  return nowMs >= bundle.validUntil;
}

const NOW = 1_700_000_000_000;
const BUNDLE: DynamicBundle = {
  bundleId: "db1", bookingId: "b1",
  components: [
    { componentId: "c1", name: "Space Rental",   basePriceCents: 4000, isMandatory: true,  eligibleForDiscount: false },
    { componentId: "c2", name: "Coffee Service", basePriceCents: 600,  isMandatory: false, eligibleForDiscount: true  },
    { componentId: "c3", name: "Printing",       basePriceCents: 400,  isMandatory: false, eligibleForDiscount: true  },
  ],
  bundleDiscountPct: 10,
  validUntil: NOW + 86_400_000,
};

describe("Dynamic bundle creation", () => {
  it("bundleSubtotal: 4000+600+400 = 5000", () => {
    expect(bundleSubtotal(BUNDLE)).toBe(5000);
  });

  it("discountableSubtotal: 600+400 = 1000", () => {
    expect(discountableSubtotal(BUNDLE)).toBe(1000);
  });

  it("bundleTotal: 4000 + 1000 - 10% of 1000 = 4900", () => {
    expect(bundleTotal(BUNDLE)).toBe(4900);
  });

  it("canAddComponent: new component → true", () => {
    const newComp: BundleComponent = { componentId: "c4", name: "Whiteboard", basePriceCents: 200, isMandatory: false, eligibleForDiscount: true };
    expect(canAddComponent(BUNDLE, newComp)).toBe(true);
  });

  it("canAddComponent: existing component → false", () => {
    expect(canAddComponent(BUNDLE, BUNDLE.components[0])).toBe(false);
  });

  it("removeOptionalComponents: keeps only mandatory", () => {
    const stripped = removeOptionalComponents(BUNDLE);
    expect(stripped.components).toHaveLength(1);
    expect(stripped.components[0].isMandatory).toBe(true);
  });

  it("isBundleExpired: not expired → false", () => {
    expect(isBundleExpired(BUNDLE, NOW)).toBe(false);
  });

  it("isBundleExpired: past validUntil → true", () => {
    expect(isBundleExpired(BUNDLE, NOW + 90_000_000)).toBe(true);
  });
});
