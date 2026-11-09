/**
 * Privacy accounting for the on-device DP-SGD trainer (#3359).
 *
 * Every release the trainer makes is a plain (non-subsampled) Gaussian
 * mechanism: a clipped gradient with noise σ = z·C, or the noisy
 * unclipped-count used by adaptive clipping. A Gaussian release with
 * sensitivity Δ and noise σ is (Δ/σ)-GDP, and adaptive composition of
 * Gaussian mechanisms is *exactly* μ-Gaussian differential privacy
 * (Dong, Roth & Su, "Gaussian Differential Privacy", 2019):
 *
 *     μ_total² = Σ (Δ_i / σ_i)²
 *
 * and μ-GDP converts losslessly to the tightest (ε, δ) curve:
 *
 *     δ(ε) = Φ(−ε/μ + μ/2) − e^ε · Φ(−ε/μ − μ/2)
 *
 * So this accountant is exact, not an upper bound. `rdpEpsilon` gives the
 * standard Rényi-DP bound (Mironov 2017) as an independent cross-check.
 *
 * Privacy unit & adjacency: one training example, **replace-one**. The
 * trainer takes one step per example, so the number of steps (dataset
 * size) is public; neighbouring datasets swap one example for another. An
 * example is used at most once per round (one `train` call) and may
 * reappear in every round. Within a round it affects one gradient step and
 * one count query:
 *
 *  - gradient: clipped to C, so swapping examples moves it by up to 2C;
 *    with σ = z·C that release is (2/z)-GDP.
 *  - count: an indicator flips 0 ↔ 1 (Δ = 1); with σ_b = z_b it is (1/z_b)-GDP.
 *
 * So each round costs 4/z² + 1/z_b² of μ².
 */

/** ‖g − g′‖ ≤ 2C under replace-one adjacency, i.e. Δ/C. */
export const GRADIENT_SENSITIVITY_IN_CLIP_UNITS = 2;

// ─── Normal distribution helpers ─────────────────────────────────────────────

/**
 * log(erfc(x)) for x ≥ 0 using the Numerical Recipes Chebyshev fit
 * (relative error < 1.2e-7 everywhere), kept in log space so tails far
 * below double precision stay usable.
 */
function logErfc(x: number): number {
  const t = 1 / (1 + 0.5 * x);
  const poly =
    -1.26551223 +
    t * (1.00002368 +
    t * (0.37409196 +
    t * (0.09678418 +
    t * (-0.18628806 +
    t * (0.27886807 +
    t * (-1.13520398 +
    t * (1.48851587 +
    t * (-0.82215223 +
    t * 0.17087277))))))));
  return Math.log(t) - x * x + poly;
}

/** log Φ(x), accurate in both tails. */
export function logNormalCdf(x: number): number {
  if (x < 0) return Math.log(0.5) + logErfc(-x / Math.SQRT2);
  return Math.log1p(-0.5 * Math.exp(logErfc(x / Math.SQRT2)));
}

export function normalCdf(x: number): number {
  return Math.exp(logNormalCdf(x));
}

// ─── Gaussian DP ↔ (ε, δ) ────────────────────────────────────────────────────

/** Tightest δ for which a μ-GDP mechanism is (ε, δ)-DP. */
export function gdpDelta(epsilon: number, mu: number): number {
  if (mu <= 0) return 0;
  const a = normalCdf(-epsilon / mu + mu / 2);
  const b = Math.exp(epsilon + logNormalCdf(-epsilon / mu - mu / 2));
  return Math.max(0, a - b);
}

function bisect(f: (x: number) => boolean, lo: number, hi: number): number {
  // f(lo) false, f(hi) true; returns the boundary.
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid)) hi = mid;
    else lo = mid;
    if (hi - lo <= 1e-12 * Math.max(1, hi)) break;
  }
  return hi;
}

/** Smallest ε such that a μ-GDP mechanism is (ε, δ)-DP. */
export function gdpEpsilon(mu: number, delta: number): number {
  if (mu <= 0) return 0;
  if (gdpDelta(0, mu) <= delta) return 0;
  let hi = 1;
  while (gdpDelta(hi, mu) > delta) hi *= 2;
  return bisect((eps) => gdpDelta(eps, mu) <= delta, 0, hi);
}

/** Largest μ such that μ-GDP implies (ε, δ)-DP. */
export function gdpMu(epsilon: number, delta: number): number {
  let hi = 1;
  while (gdpDelta(epsilon, hi) < delta) hi *= 2;
  // δ(ε; μ) increases with μ: find the largest μ still within δ.
  return bisect((mu) => gdpDelta(epsilon, mu) > delta, 0, hi) * (1 - 1e-9);
}

/**
 * Rényi-DP bound for the same mechanism (Mironov 2017, Prop. 3), optimised
 * over α in closed form: ε = μ²/2 + μ·√(2·ln(1/δ)). Always ≥ gdpEpsilon.
 */
export function rdpEpsilon(mu: number, delta: number): number {
  return (mu * mu) / 2 + mu * Math.sqrt(2 * Math.log(1 / delta));
}

// ─── Budget calibration & accountant ─────────────────────────────────────────

export interface PrivacyBudget {
  /** Total ε allowed over the model's lifetime on this device. */
  epsilon: number;
  delta: number;
  /** Rounds (train calls) the budget should cover. */
  plannedRounds: number;
}

export interface PrivacyLedgerState {
  version: 1;
  /** Σ 1/z² over every Gaussian release so far. */
  muSquared: number;
  rounds: number;
}

export interface PrivacyReport {
  epsilonSpent: number;
  delta: number;
  rounds: number;
  /** Set when a budget is enforced. */
  epsilonBudget?: number;
  remainingRounds?: number;
}

export class PrivacyBudgetExhaustedError extends Error {
  constructor() {
    super("Privacy budget exhausted: further training would exceed the (ε, δ) guarantee.");
  }
}

export function validateBudget(budget: PrivacyBudget): void {
  if (!(budget.epsilon > 0) || !Number.isFinite(budget.epsilon)) {
    throw new RangeError("budget.epsilon must be a positive finite number");
  }
  if (!(budget.delta > 0 && budget.delta < 1)) {
    throw new RangeError("budget.delta must be in (0, 1)");
  }
  if (!Number.isInteger(budget.plannedRounds) || budget.plannedRounds < 1) {
    throw new RangeError("budget.plannedRounds must be a positive integer");
  }
}

/** Noise multipliers for one round: the gradient release and the clipping count query. */
export interface RoundMultipliers {
  noiseMultiplier: number;
  /** Present when adaptive clipping spends part of the round on its count query. */
  countNoiseMultiplier?: number;
}

const K = GRADIENT_SENSITIVITY_IN_CLIP_UNITS;

/** μ² one round costs: one gradient release plus (optionally) one count release. */
export function roundMuSquared({ noiseMultiplier, countNoiseMultiplier }: RoundMultipliers): number {
  return (K / noiseMultiplier) ** 2 + (countNoiseMultiplier ? 1 / countNoiseMultiplier ** 2 : 0);
}

function assertShare(countShare: number): void {
  if (!(countShare >= 0 && countShare < 1)) {
    throw new RangeError("countBudgetShare must be in [0, 1)");
  }
}

/**
 * Split a per-round μ² allowance between the gradient release and the
 * adaptive-clipping count query (`countShare` of it, 0 = no count query).
 */
export function multipliersForRound(muSquaredPerRound: number, countShare = 0): RoundMultipliers {
  assertShare(countShare);
  if (!(muSquaredPerRound > 0)) throw new PrivacyBudgetExhaustedError();
  return {
    noiseMultiplier: K / Math.sqrt((1 - countShare) * muSquaredPerRound),
    ...(countShare > 0 ? { countNoiseMultiplier: 1 / Math.sqrt(countShare * muSquaredPerRound) } : {}),
  };
}

/**
 * Count-query multiplier that pairs with a fixed gradient multiplier `z`
 * when the count takes `countShare` of the round: z_b = (z/2)·√((1−s)/s).
 */
export function countMultiplierFor(noiseMultiplier: number, countShare: number): number | undefined {
  assertShare(countShare);
  return countShare > 0 ? (noiseMultiplier / K) * Math.sqrt((1 - countShare) / countShare) : undefined;
}

/** Multipliers that spend exactly an (ε, δ) budget over `plannedRounds` rounds. */
export function calibrateNoiseMultiplier(budget: PrivacyBudget, countShare = 0): RoundMultipliers {
  validateBudget(budget);
  const mu = gdpMu(budget.epsilon, budget.delta);
  return multipliersForRound((mu * mu) / budget.plannedRounds, countShare);
}

/**
 * Tracks cumulative privacy loss across rounds and, when a budget is set,
 * hands out the noise multiplier for the next round and refuses rounds that
 * would exceed it.
 */
export class PrivacyAccountant {
  private muSquared: number;
  private roundCount: number;

  constructor(
    readonly delta: number,
    readonly budget?: PrivacyBudget,
    state?: PrivacyLedgerState,
  ) {
    if (budget) validateBudget(budget);
    if (!(delta > 0 && delta < 1)) throw new RangeError("delta must be in (0, 1)");
    this.muSquared = state?.version === 1 && state.muSquared >= 0 ? state.muSquared : 0;
    this.roundCount = state?.version === 1 && state.rounds >= 0 ? state.rounds : 0;
  }

  get rounds(): number {
    return this.roundCount;
  }

  /** ε spent so far at this accountant's δ. */
  get epsilonSpent(): number {
    return gdpEpsilon(Math.sqrt(this.muSquared), this.delta);
  }

  get remainingRounds(): number | undefined {
    return this.budget ? Math.max(0, this.budget.plannedRounds - this.roundCount) : undefined;
  }

  /** Whether one more round with these multipliers stays within the budget. */
  canAfford(round: RoundMultipliers): boolean {
    if (!this.budget) return true;
    const mu = Math.sqrt(this.muSquared + roundMuSquared(round));
    return gdpDelta(this.budget.epsilon, mu) <= this.budget.delta;
  }

  /**
   * Multipliers for the next round: spreads the budget still unspent evenly
   * over the remaining planned rounds (dynamic re-calibration).
   * Throws PrivacyBudgetExhaustedError when nothing is left.
   */
  nextRound(countShare = 0): RoundMultipliers {
    if (!this.budget) throw new Error("No budget configured");
    const remaining = this.remainingRounds!;
    const targetMu = gdpMu(this.budget.epsilon, this.budget.delta);
    const left = targetMu * targetMu - this.muSquared;
    if (remaining <= 0 || !(left > 0)) throw new PrivacyBudgetExhaustedError();
    const round = multipliersForRound(left / remaining, countShare);
    if (!this.canAfford(round)) throw new PrivacyBudgetExhaustedError();
    return round;
  }

  /** Charge one completed round. */
  record(round: RoundMultipliers): void {
    const { noiseMultiplier, countNoiseMultiplier } = round;
    if (!(noiseMultiplier > 0) || (countNoiseMultiplier !== undefined && !(countNoiseMultiplier > 0))) {
      throw new RangeError("Noise multipliers must be positive");
    }
    if (!this.canAfford(round)) throw new PrivacyBudgetExhaustedError();
    this.muSquared += roundMuSquared(round);
    this.roundCount += 1;
  }

  report(): PrivacyReport {
    return {
      epsilonSpent: this.epsilonSpent,
      delta: this.delta,
      rounds: this.roundCount,
      ...(this.budget
        ? { epsilonBudget: this.budget.epsilon, remainingRounds: this.remainingRounds }
        : {}),
    };
  }

  toJSON(): PrivacyLedgerState {
    return { version: 1, muSquared: this.muSquared, rounds: this.roundCount };
  }
}
