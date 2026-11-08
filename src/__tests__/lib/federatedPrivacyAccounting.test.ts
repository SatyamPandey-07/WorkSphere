/**
 * @jest-environment node
 *
 * Adaptive clipping + (ε, δ) privacy accounting for the federated venue
 * trainer (#3359). The math is checked three independent ways: against
 * numerical integration of the Gaussian mechanism's privacy profile,
 * against the Rényi-DP bound, and empirically by attacking the real
 * training mechanism on neighbouring datasets.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  PrivacyAccountant,
  PrivacyBudgetExhaustedError,
  calibrateNoiseMultiplier,
  countMultiplierFor,
  gdpDelta,
  gdpEpsilon,
  gdpMu,
  normalCdf,
  rdpEpsilon,
  roundMuSquared,
  type PrivacyBudget,
} from "@/lib/federated/privacyAccountant";
import {
  DEFAULT_ADAPTIVE_CLIPPING,
  nextClipNorm,
  noisyUnclippedFraction,
  resolveAdaptiveClipping,
} from "@/lib/federated/adaptiveClipping";
import { DpTrainingSession } from "@/lib/federated/dpTrainingSession";
import { createInitialModel, featuresFromArray, trainDpRound } from "@/lib/federated/linearVenueModel";
import { resolveDpConfig } from "@/lib/federated/differentialPrivacy";
import {
  loadPrivacyState,
  purgeStaleWeights,
  resetWeightDbCache,
  savePrivacyState,
  saveWeights,
} from "@/lib/federated/weightDb";
import { DEFAULT_DP_CONFIG, FEATURE_DIM } from "@/lib/federated/types";

/** Deterministic uniform [0, 1) source (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const zeroModel = (lr = 1) => {
  const m = createInitialModel(lr);
  m.weights.fill(0);
  m.bias = 0;
  return m;
};

// ─── 1. The mathematics ───────────────────────────────────────────────────────

describe("Gaussian DP mathematics", () => {
  it("computes the normal CDF accurately, including far tails", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-8) / 6.22096057427178e-16).toBeCloseTo(1, 5);
  });

  it("matches numerical integration of the Gaussian mechanism's privacy profile", () => {
    // δ(ε) = ∫ max(0, φ(x − μ) − e^ε φ(x)) dx for N(μ,1) vs N(0,1).
    const phi = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
    const integrate = (eps: number, mu: number) => {
      const h = 1e-4;
      let sum = 0;
      for (let x = -12; x <= 12 + mu; x += h) sum += Math.max(0, phi(x - mu) - Math.exp(eps) * phi(x)) * h;
      return sum;
    };
    for (const [eps, mu] of [[0, 1], [1, 1], [2, 2], [0.5, 0.3], [4, 1.5]]) {
      expect(gdpDelta(eps, mu)).toBeCloseTo(integrate(eps, mu), 5);
    }
  });

  it("inverts consistently between ε, δ and μ", () => {
    for (const [mu, delta] of [[0.5, 1e-5], [1, 1e-5], [2, 1e-6], [0.1, 1e-3]]) {
      const eps = gdpEpsilon(mu, delta);
      expect(gdpDelta(eps, mu)).toBeLessThanOrEqual(delta * (1 + 1e-6));
      expect(gdpDelta(eps * 0.99, mu)).toBeGreaterThan(delta);
      expect(gdpMu(eps, delta)).toBeCloseTo(mu, 6);
    }
  });

  it("is never looser than the Rényi-DP bound for the same mechanism", () => {
    for (const mu of [0.05, 0.3, 1, 3, 8]) {
      for (const delta of [1e-3, 1e-5, 1e-8]) {
        expect(gdpEpsilon(mu, delta)).toBeLessThanOrEqual(rdpEpsilon(mu, delta) + 1e-9);
      }
    }
  });

  it("charges replace-one gradient sensitivity 2C plus the count query", () => {
    expect(roundMuSquared({ noiseMultiplier: 2 })).toBeCloseTo(1, 12); // (2/2)²
    expect(roundMuSquared({ noiseMultiplier: 2, countNoiseMultiplier: 4 })).toBeCloseTo(1 + 1 / 16, 12);
    // countMultiplierFor keeps the count at exactly its share of the round
    const z = 1.5;
    const zb = countMultiplierFor(z, 0.1)!;
    expect((1 / zb ** 2) / roundMuSquared({ noiseMultiplier: z, countNoiseMultiplier: zb })).toBeCloseTo(0.1, 12);
  });
});

// ─── 2. Budget calibration & accountant ───────────────────────────────────────

describe("PrivacyAccountant", () => {
  const budget: PrivacyBudget = { epsilon: 3, delta: 1e-5, plannedRounds: 50 };

  it.each([0, 0.1, 0.3])(
    "calibrates σ so planned rounds spend the (ε, δ) budget exactly (count share %p)",
    (share) => {
      const round = calibrateNoiseMultiplier(budget, share);
      const acc = new PrivacyAccountant(budget.delta, budget);
      for (let r = 0; r < budget.plannedRounds; r++) acc.record(round);
      expect(acc.epsilonSpent).toBeLessThanOrEqual(budget.epsilon + 1e-9);
      expect(acc.epsilonSpent).toBeGreaterThan(budget.epsilon * 0.999);
      // the guarantee itself: δ at the budget's ε is within the budget's δ
      expect(gdpDelta(budget.epsilon, gdpMu(acc.epsilonSpent, budget.delta))).toBeLessThanOrEqual(budget.delta * 1.000001);
    },
  );

  it("refuses rounds beyond the budget", () => {
    const acc = new PrivacyAccountant(budget.delta, budget);
    for (let r = 0; r < budget.plannedRounds; r++) acc.record(acc.nextRound(0.1));
    expect(() => acc.nextRound(0.1)).toThrow(PrivacyBudgetExhaustedError);
    expect(() => acc.record({ noiseMultiplier: 1 })).toThrow(PrivacyBudgetExhaustedError);
    expect(acc.epsilonSpent).toBeLessThanOrEqual(budget.epsilon + 1e-9);
  });

  it("re-calibrates the remaining rounds after under-spending early ones", () => {
    const acc = new PrivacyAccountant(budget.delta, budget);
    const planned = acc.nextRound().noiseMultiplier;
    for (let r = 0; r < 10; r++) acc.record({ noiseMultiplier: planned * 3 }); // much noisier than needed
    const later = acc.nextRound().noiseMultiplier;
    expect(later).toBeLessThan(planned); // leftover budget → less noise later
    while ((acc.remainingRounds ?? 0) > 0) acc.record(acc.nextRound());
    expect(acc.epsilonSpent).toBeLessThanOrEqual(budget.epsilon + 1e-9);
    expect(acc.epsilonSpent).toBeGreaterThan(budget.epsilon * 0.999);
  });

  it("resumes from a persisted ledger", () => {
    const a = new PrivacyAccountant(budget.delta, budget);
    for (let r = 0; r < 7; r++) a.record(a.nextRound());
    const b = new PrivacyAccountant(budget.delta, budget, JSON.parse(JSON.stringify(a.toJSON())));
    expect(b.rounds).toBe(7);
    expect(b.epsilonSpent).toBeCloseTo(a.epsilonSpent, 12);
    expect(b.remainingRounds).toBe(43);
  });
});

// ─── 3. Empirical attack on the real mechanism ────────────────────────────────

describe("trainDpRound privacy (empirical)", () => {
  it("is exactly as distinguishable as the accountant charges, and no more", () => {
    // Neighbouring datasets that differ in one example whose clipped
    // gradients point in opposite directions (the worst case).
    const C = 0.25; // ≠ 1 so a bug using σ = z instead of z·C is caught
    const z = 2;
    const features = featuresFromArray(Array(FEATURE_DIM).fill(1));
    const u = 1 / Math.sqrt(FEATURE_DIM + 1); // unit direction incl. bias
    const random = seeded(7);

    const statistic = (label: 0 | 1) => {
      const m = zeroModel(1);
      trainDpRound(m, [{ features, label }], { noiseMultiplier: z, clipNorm: C }, undefined, random);
      // project −Δw onto the gradient direction
      return -(m.weights.reduce((s, w) => s + w * u, 0) + m.bias * u);
    };

    const N = 20000;
    let falsePositive = 0; // dataset with label 0 classified as label 1
    let falseNegative = 0;
    for (let i = 0; i < N; i++) {
      if (statistic(0) < 0) falsePositive++; // label 1 → gradient −C·u → statistic < 0
      if (statistic(1) >= 0) falseNegative++;
    }
    const fpr = falsePositive / N;
    const fnr = falseNegative / N;

    // Optimal test error for μ-GDP is Φ(−μ/2); μ comes from the accountant.
    const mu = Math.sqrt(roundMuSquared({ noiseMultiplier: z }));
    const expected = normalCdf(-mu / 2);
    const tolerance = 4 * Math.sqrt((expected * (1 - expected)) / N);
    expect(Math.abs(fpr - expected)).toBeLessThan(tolerance);
    expect(Math.abs(fnr - expected)).toBeLessThan(tolerance);

    // And the (ε, δ) the accountant reports holds for this attack.
    const delta = 1e-5;
    const eps = gdpEpsilon(mu, delta);
    expect(fpr + Math.exp(eps) * fnr).toBeGreaterThanOrEqual(1 - delta - tolerance);
    expect(fnr + Math.exp(eps) * fpr).toBeGreaterThanOrEqual(1 - delta - tolerance);
  });
});

// ─── 4. Adaptive clipping ─────────────────────────────────────────────────────

describe("adaptive clipping", () => {
  it("converges to the target quantile of gradient norms using only the noisy count", () => {
    const random = seeded(3);
    // log-normal per-example gradient norms with median 0.8
    const norms = Array.from({ length: 64 }, () => {
      const u1 = Math.max(random(), 1e-12);
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * random());
      return 0.8 * Math.exp(0.5 * g);
    });
    const sorted = [...norms].sort((a, b) => a - b);
    const median = (sorted[31] + sorted[32]) / 2;

    const cfg = resolveAdaptiveClipping({ initialClipNorm: 5, maxClipNorm: 10 });
    let C = cfg.initialClipNorm;
    for (let round = 0; round < 400; round++) {
      const unclipped = norms.filter((n) => n <= C).length;
      C = nextClipNorm(C, noisyUnclippedFraction(unclipped, norms.length, 4, random), cfg);
    }
    expect(C / median).toBeGreaterThan(0.8);
    expect(C / median).toBeLessThan(1.25);
  });

  it("releases the unclipped count with Gaussian noise, never the exact value", () => {
    const features = featuresFromArray(Array(FEATURE_DIM).fill(0.5));
    const batch = Array.from({ length: 20 }, (_, i) => ({ features, label: (i % 2) as 0 | 1 }));
    const fractions = Array.from({ length: 200 }, (_, seed) =>
      trainDpRound(
        zeroModel(0.01),
        batch,
        { noiseMultiplier: 1, countNoiseMultiplier: 4, clipNorm: 0.4 },
        DEFAULT_ADAPTIVE_CLIPPING,
        seeded(seed + 1),
      ).noisyUnclippedFraction!,
    );
    const mean = fractions.reduce((a, b) => a + b, 0) / fractions.length;
    const sd = Math.sqrt(fractions.reduce((a, b) => a + (b - mean) ** 2, 0) / fractions.length);
    expect(sd).toBeGreaterThan(0.15); // ≈ z_b / m = 0.2
    expect(sd).toBeLessThan(0.25);
  });

  it("keeps the bound inside [min, max] so outliers can't explode it", () => {
    const cfg = resolveAdaptiveClipping({ minClipNorm: 0.1, maxClipNorm: 2, initialClipNorm: 1 });
    let C = 1;
    for (let i = 0; i < 100; i++) C = nextClipNorm(C, -5, cfg); // every gradient clipped
    expect(C).toBe(2);
    for (let i = 0; i < 100; i++) C = nextClipNorm(C, 5, cfg);
    expect(C).toBe(0.1);
  });

  it("bounds every applied update by lr × (clip + noise) even for extreme gradients", () => {
    const model = zeroModel(0.5);
    const huge = featuresFromArray(Array(FEATURE_DIM).fill(1));
    const res = trainDpRound(
      model,
      [{ features: huge, label: 1 }],
      { noiseMultiplier: 1e-9, countNoiseMultiplier: 1, clipNorm: 0.3 },
      DEFAULT_ADAPTIVE_CLIPPING,
      seeded(1),
    );
    const step = Math.hypot(...model.weights, model.bias);
    expect(step).toBeLessThanOrEqual(0.5 * 0.3 + 1e-6);
    expect(res.nextClipNorm).toBeGreaterThan(res.clipNorm); // it was clipped → bound grows
  });

  it("validates its configuration", () => {
    expect(() => resolveAdaptiveClipping({ targetQuantile: 1 })).toThrow(RangeError);
    expect(() => resolveAdaptiveClipping({ minClipNorm: 2, maxClipNorm: 1 })).toThrow(RangeError);
    expect(() => resolveAdaptiveClipping({ countBudgetShare: 0 })).toThrow(RangeError);
    expect(() => resolveDpConfig({ budget: { epsilon: -1, delta: 1e-5, plannedRounds: 5 } })).toThrow();
  });
});

// ─── 5. Training session (what the worker runs) ───────────────────────────────

describe("DpTrainingSession", () => {
  const examples = Array.from({ length: 16 }, (_, i) => ({
    features: featuresFromArray(Array.from({ length: FEATURE_DIM }, (_, j) => ((i + j) % 5) / 5)),
    label: (i % 2) as 0 | 1,
  }));

  it("stops training at the budget, leaving the model untouched", () => {
    const config = resolveDpConfig({
      budget: { epsilon: 2, delta: 1e-5, plannedRounds: 3 },
      adaptiveClipping: true,
    });
    const session = new DpTrainingSession(config);
    const model = zeroModel(0.05);
    for (let r = 0; r < 3; r++) session.runRound(model, examples, seeded(r));
    expect(session.report().epsilonSpent).toBeLessThanOrEqual(2 + 1e-9);
    expect(session.report().remainingRounds).toBe(0);

    const before = Array.from(model.weights);
    expect(() => session.runRound(model, examples, seeded(9))).toThrow(PrivacyBudgetExhaustedError);
    expect(Array.from(model.weights)).toEqual(before);
  });

  it("restores the spent budget and clip bound from persisted state", () => {
    const config = resolveDpConfig({
      budget: { epsilon: 4, delta: 1e-5, plannedRounds: 10 },
      adaptiveClipping: true,
    });
    const first = new DpTrainingSession(config);
    for (let r = 0; r < 4; r++) first.runRound(zeroModel(), examples, seeded(r));
    const restored = new DpTrainingSession(config, JSON.parse(JSON.stringify(first.state())));
    expect(restored.report()).toEqual(first.report());
    expect(restored.currentClipNorm).toBeCloseTo(first.currentClipNorm, 12);
  });

  it("tracks cumulative ε with a fixed noise multiplier when no budget is set", () => {
    const session = new DpTrainingSession(resolveDpConfig({ noiseMultiplier: 4 }));
    const spent: number[] = [];
    for (let r = 0; r < 5; r++) {
      session.runRound(zeroModel(), examples, seeded(r));
      spent.push(session.report().epsilonSpent);
    }
    expect(spent.every((e, i) => i === 0 || e > spent[i - 1])).toBe(true);
    expect(spent[4]).toBeCloseTo(gdpEpsilon(Math.sqrt(5 * roundMuSquared({ noiseMultiplier: 4 })), 1e-5), 9);
  });

  it("reports an unbounded loss when DP is disabled", () => {
    const session = new DpTrainingSession({ ...DEFAULT_DP_CONFIG, enabled: false });
    session.runRound(zeroModel(), examples);
    expect(session.report().epsilonSpent).toBe(Infinity);
  });
});

// ─── 6. Ledger persistence ────────────────────────────────────────────────────

describe("privacy ledger persistence", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetWeightDbCache();
  });

  it("survives purgeStaleWeights so the spent budget is never reset", async () => {
    await saveWeights({ weights: new Float32Array(FEATURE_DIM), bias: 0, updatedAt: 0 });
    const state = { ledger: { version: 1 as const, muSquared: 3.5, rounds: 12 }, clipNorm: 0.7, updatedAt: 0 };
    await savePrivacyState(state);

    const purged = await purgeStaleWeights(1);
    expect(purged.deletedCount).toBe(1); // the weights went
    expect(await loadPrivacyState()).toEqual(state); // the ledger stayed
  });
});
