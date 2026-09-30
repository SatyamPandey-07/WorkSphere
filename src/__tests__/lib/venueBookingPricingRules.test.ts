/**
 * Tests for venue booking pricing rule engine.
 */

interface PricingRule {
  ruleId: string;
  name: string;
  condition: (context: PricingContext) => boolean;
  adjustment: (baseCents: number, context: PricingContext) => number;
  priority: number; // lower number = applied first
}

interface PricingContext {
  bookingHours: number;
  dayOfWeek: number;  // 0-6
  startHour: number;
  memberTier: "basic" | "silver" | "gold" | null;
  groupSize: number;
}

const PRICING_RULES: PricingRule[] = [
  {
    ruleId: "r1", name: "Weekend surcharge",
    condition: (ctx) => ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6,
    adjustment: (base) => Math.round(base * 1.15),
    priority: 1,
  },
  {
    ruleId: "r2", name: "Peak hours surcharge",
    condition: (ctx) => ctx.startHour >= 9 && ctx.startHour <= 11,
    adjustment: (base) => Math.round(base * 1.10),
    priority: 2,
  },
  {
    ruleId: "r3", name: "Gold member discount",
    condition: (ctx) => ctx.memberTier === "gold",
    adjustment: (base) => Math.round(base * 0.85),
    priority: 10,
  },
  {
    ruleId: "r4", name: "Group discount (5+)",
    condition: (ctx) => ctx.groupSize >= 5,
    adjustment: (base) => Math.round(base * 0.90),
    priority: 8,
  },
];

function applyPricingRules(baseCents: number, context: PricingContext, rules: PricingRule[]): number {
  const applicable = rules
    .filter((r) => r.condition(context))
    .sort((a, b) => a.priority - b.priority);
  return applicable.reduce((price, rule) => rule.adjustment(price, context), baseCents);
}

function appliedRuleNames(context: PricingContext, rules: PricingRule[]): string[] {
  return rules
    .filter((r) => r.condition(context))
    .sort((a, b) => a.priority - b.priority)
    .map((r) => r.name);
}

describe("Venue booking pricing rule engine", () => {
  it("applyPricingRules: no applicable rules → base price", () => {
    const ctx: PricingContext = { bookingHours: 2, dayOfWeek: 2, startHour: 14, memberTier: null, groupSize: 2 };
    expect(applyPricingRules(1000, ctx, PRICING_RULES)).toBe(1000);
  });

  it("applyPricingRules: weekend surcharge", () => {
    const ctx: PricingContext = { bookingHours: 2, dayOfWeek: 6, startHour: 14, memberTier: null, groupSize: 2 };
    expect(applyPricingRules(1000, ctx, PRICING_RULES)).toBe(1150);
  });

  it("applyPricingRules: gold member discount", () => {
    const ctx: PricingContext = { bookingHours: 2, dayOfWeek: 2, startHour: 14, memberTier: "gold", groupSize: 2 };
    expect(applyPricingRules(1000, ctx, PRICING_RULES)).toBe(850);
  });

  it("applyPricingRules: stacked rules (weekend + peak)", () => {
    const ctx: PricingContext = { bookingHours: 2, dayOfWeek: 6, startHour: 10, memberTier: null, groupSize: 2 };
    // 1000 → weekend 1150 → peak 1265
    expect(applyPricingRules(1000, ctx, PRICING_RULES)).toBe(1265);
  });

  it("appliedRuleNames: returns names of applicable rules", () => {
    const ctx: PricingContext = { bookingHours: 2, dayOfWeek: 6, startHour: 14, memberTier: "gold", groupSize: 6 };
    const names = appliedRuleNames(ctx, PRICING_RULES);
    expect(names).toContain("Weekend surcharge");
    expect(names).toContain("Gold member discount");
    expect(names).toContain("Group discount (5+)");
  });
});
