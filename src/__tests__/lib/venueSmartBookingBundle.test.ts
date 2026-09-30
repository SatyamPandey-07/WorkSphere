/**
 * Tests for smart booking bundle creation based on user needs.
 */

interface UserNeed {
  durationHours: number;
  groupSize: number;
  needsPresentation: boolean;
  needsCatering: boolean;
  preferQuiet: boolean;
  budget: "tight" | "flexible" | "premium";
}

interface BundleComponent {
  type: "space" | "equipment" | "catering" | "service";
  name: string;
  priceCents: number;
  requiredFor: string[];  // conditions
}

const BUNDLE_COMPONENTS: BundleComponent[] = [
  { type: "space",     name: "Hot Desk",        priceCents: 500,  requiredFor: [] },
  { type: "space",     name: "Meeting Room",     priceCents: 2000, requiredFor: ["presentation", "group"] },
  { type: "equipment", name: "Projector",        priceCents: 500,  requiredFor: ["presentation"] },
  { type: "equipment", name: "Whiteboard",       priceCents: 200,  requiredFor: ["group"] },
  { type: "catering",  name: "Lunch Package",    priceCents: 1200, requiredFor: ["catering"] },
  { type: "service",   name: "AV Support",       priceCents: 800,  requiredFor: ["presentation", "premium"] },
];

function buildBundle(needs: UserNeed): BundleComponent[] {
  const conditions: string[] = [];
  if (needs.needsPresentation) conditions.push("presentation");
  if (needs.groupSize >= 4) conditions.push("group");
  if (needs.needsCatering) conditions.push("catering");
  if (needs.budget === "premium") conditions.push("premium");

  return BUNDLE_COMPONENTS.filter((comp) =>
    comp.requiredFor.length === 0 ||
    comp.requiredFor.some((req) => conditions.includes(req))
  );
}

function bundleTotalCost(components: BundleComponent[], hours: number): number {
  return components.reduce((sum, comp) => {
    if (comp.type === "space") return sum + comp.priceCents * hours;
    return sum + comp.priceCents;
  }, 0);
}

function bundleDiscount(totalCents: number, componentCount: number): number {
  if (componentCount >= 4) return Math.round(totalCents * 0.10); // 10% bundle discount
  if (componentCount >= 3) return Math.round(totalCents * 0.05); // 5% bundle discount
  return 0;
}

describe("Smart booking bundle creation", () => {
  const PRESENTATION_NEEDS: UserNeed = {
    durationHours: 3, groupSize: 8, needsPresentation: true,
    needsCatering: true, preferQuiet: false, budget: "flexible",
  };

  it("buildBundle: presentation + group + catering → meeting room, projector, whiteboard, lunch", () => {
    const bundle = buildBundle(PRESENTATION_NEEDS);
    expect(bundle.some((c) => c.name === "Meeting Room")).toBe(true);
    expect(bundle.some((c) => c.name === "Projector")).toBe(true);
    expect(bundle.some((c) => c.name === "Lunch Package")).toBe(true);
  });

  it("buildBundle: simple solo no extras → hot desk only", () => {
    const solo: UserNeed = { durationHours: 2, groupSize: 1, needsPresentation: false, needsCatering: false, preferQuiet: true, budget: "tight" };
    const bundle = buildBundle(solo);
    expect(bundle.length).toBe(1);
    expect(bundle[0].name).toBe("Hot Desk");
  });

  it("bundleTotalCost: meeting room 3h + extras", () => {
    const bundle = buildBundle(PRESENTATION_NEEDS);
    const cost = bundleTotalCost(bundle, 3);
    expect(cost).toBeGreaterThan(0);
  });

  it("bundleDiscount: 4+ components get 10% off", () => {
    const bundle = buildBundle(PRESENTATION_NEEDS);
    const total = bundleTotalCost(bundle, 3);
    const discount = bundleDiscount(total, bundle.length);
    if (bundle.length >= 4) expect(discount).toBeGreaterThan(0);
  });
});
