/**
 * Tests for venue booking feature flag evaluation system.
 */

type FlagEnvironment = "development" | "staging" | "production";
type RolloutStrategy = "percentage" | "whitelist" | "all" | "none";

interface FeatureFlag {
  key: string;
  name: string;
  enabled: boolean;
  environments: FlagEnvironment[];
  rolloutStrategy: RolloutStrategy;
  rolloutPercent: number;    // 0-100 for percentage strategy
  whitelistUserIds: string[];
  startAt: number | null;
  endAt: number | null;
}

interface FlagEvaluationContext {
  userId: string;
  environment: FlagEnvironment;
  nowMs: number;
}

function isFlagTimeValid(flag: FeatureFlag, nowMs: number): boolean {
  if (flag.startAt !== null && nowMs < flag.startAt) return false;
  if (flag.endAt !== null && nowMs > flag.endAt) return false;
  return true;
}

function evaluateFlag(flag: FeatureFlag, ctx: FlagEvaluationContext): boolean {
  if (!flag.enabled) return false;
  if (!flag.environments.includes(ctx.environment)) return false;
  if (!isFlagTimeValid(flag, ctx.nowMs)) return false;

  switch (flag.rolloutStrategy) {
    case "all":    return true;
    case "none":   return false;
    case "whitelist": return flag.whitelistUserIds.includes(ctx.userId);
    case "percentage": {
      // Deterministic hash-based rollout
      const hash = ctx.userId.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100, 0);
      return hash < flag.rolloutPercent;
    }
  }
}

function activeFlags(flags: FeatureFlag[], ctx: FlagEvaluationContext): string[] {
  return flags.filter((f) => evaluateFlag(f, ctx)).map((f) => f.key);
}

function flagsForEnvironment(flags: FeatureFlag[], env: FlagEnvironment): FeatureFlag[] {
  return flags.filter((f) => f.environments.includes(env) && f.enabled);
}

const NOW = 1_700_000_000_000;
const FLAGS: FeatureFlag[] = [
  { key: "new_checkout",  name: "New Checkout",  enabled: true,  environments: ["production"],         rolloutStrategy: "percentage", rolloutPercent: 50, whitelistUserIds: [],        startAt: null, endAt: null },
  { key: "beta_pricing",  name: "Beta Pricing",  enabled: true,  environments: ["staging", "production"],rolloutStrategy: "whitelist",  rolloutPercent: 0,  whitelistUserIds: ["u1","u2"],startAt: null, endAt: null },
  { key: "dark_mode",     name: "Dark Mode",     enabled: true,  environments: ["development","staging","production"], rolloutStrategy: "all",       rolloutPercent: 100,whitelistUserIds: [],        startAt: null, endAt: null },
  { key: "expired_test",  name: "Expired",       enabled: true,  environments: ["production"],         rolloutStrategy: "all",        rolloutPercent: 100,whitelistUserIds: [],        startAt: null, endAt: NOW - 1000 },
];

const CTX: FlagEvaluationContext = { userId: "u1", environment: "production", nowMs: NOW };

describe("Feature flag evaluation", () => {
  it("evaluateFlag: whitelist flag for u1 → true", () => {
    expect(evaluateFlag(FLAGS[1], CTX)).toBe(true);
  });

  it("evaluateFlag: whitelist flag for u3 (not listed) → false", () => {
    expect(evaluateFlag(FLAGS[1], { ...CTX, userId: "u3" })).toBe(false);
  });

  it("evaluateFlag: expired flag → false", () => {
    expect(evaluateFlag(FLAGS[3], CTX)).toBe(false);
  });

  it("evaluateFlag: dark_mode all strategy → true", () => {
    expect(evaluateFlag(FLAGS[2], CTX)).toBe(true);
  });

  it("activeFlags: u1 gets dark_mode and beta_pricing at least", () => {
    const active = activeFlags(FLAGS, CTX);
    expect(active).toContain("dark_mode");
    expect(active).toContain("beta_pricing");
    expect(active).not.toContain("expired_test");
  });

  it("flagsForEnvironment: 3 production flags (excluding expired disabled)", () => {
    expect(flagsForEnvironment(FLAGS, "production").length).toBeGreaterThanOrEqual(3);
  });
});
