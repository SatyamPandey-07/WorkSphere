/**
 * Ties DP-SGD rounds to privacy accounting and adaptive clipping (#3359).
 * Pure logic so it can be tested directly; the worker persists `state()`.
 */

import {
  resolveAdaptiveClipping,
  type AdaptiveClippingConfig,
} from "./adaptiveClipping";
import { secureRandom, type RandomSource } from "./differentialPrivacy";
import { trainBatch, trainDpRound, type LinearVenueModelState } from "./linearVenueModel";
import {
  PrivacyAccountant,
  PrivacyBudgetExhaustedError,
  countMultiplierFor,
  type PrivacyReport,
  type RoundMultipliers,
} from "./privacyAccountant";
import type { DifferentialPrivacyConfig, VenueTrainExample } from "./types";
import type { TrainerPrivacyState } from "./weightDb";

export const DEFAULT_REPORTING_DELTA = 1e-5;

export interface RoundOutcome {
  steps: number;
  clipNorm: number;
  privacy: PrivacyReport;
}

export class DpTrainingSession {
  private readonly adaptive?: AdaptiveClippingConfig;
  private readonly accountant: PrivacyAccountant;
  private clipNorm: number;
  /** Set once a round ran without a finite guarantee (DP off or zero noise). */
  private unbounded = false;

  constructor(
    private readonly config: DifferentialPrivacyConfig,
    state?: TrainerPrivacyState | null,
  ) {
    if (config.adaptiveClipping) {
      const overrides = config.adaptiveClipping === true ? {} : config.adaptiveClipping;
      const bounds = resolveAdaptiveClipping(overrides);
      const start = overrides.initialClipNorm ?? config.maxGradNorm;
      this.adaptive = resolveAdaptiveClipping({
        ...overrides,
        initialClipNorm: Math.min(bounds.maxClipNorm, Math.max(bounds.minClipNorm, start)),
      });
    }

    const delta = config.budget?.delta ?? config.reportingDelta ?? DEFAULT_REPORTING_DELTA;
    this.accountant = new PrivacyAccountant(delta, config.budget, state?.ledger);
    this.clipNorm =
      this.adaptive && state?.clipNorm && state.clipNorm > 0
        ? Math.min(this.adaptive.maxClipNorm, Math.max(this.adaptive.minClipNorm, state.clipNorm))
        : (this.adaptive?.initialClipNorm ?? config.maxGradNorm);
  }

  get currentClipNorm(): number {
    return this.clipNorm;
  }

  report(): PrivacyReport {
    const report = this.accountant.report();
    return this.unbounded ? { ...report, epsilonSpent: Infinity } : report;
  }

  state(): TrainerPrivacyState {
    return { ledger: this.accountant.toJSON(), clipNorm: this.clipNorm, updatedAt: Date.now() };
  }

  /** Multipliers this round will use, without training. Throws if the budget is spent. */
  planRound(): RoundMultipliers {
    const countShare = this.adaptive?.countBudgetShare ?? 0;
    if (this.config.budget) return this.accountant.nextRound(countShare);
    const z = this.config.noiseMultiplier;
    return { noiseMultiplier: z, countNoiseMultiplier: countMultiplierFor(z, countShare) };
  }

  /**
   * Train one round. With a budget, the round is refused (nothing is
   * trained) when it would exceed (ε, δ).
   */
  runRound(
    model: LinearVenueModelState,
    examples: VenueTrainExample[],
    random: RandomSource = secureRandom,
  ): RoundOutcome {
    if (examples.length === 0) {
      return { steps: 0, clipNorm: this.clipNorm, privacy: this.report() };
    }

    // No finite guarantee: DP disabled, or clipping without noise.
    if (!this.config.enabled || (!this.config.budget && this.config.noiseMultiplier === 0)) {
      const steps = trainBatch(
        model,
        examples,
        this.config.enabled ? { ...this.config, maxGradNorm: this.clipNorm } : undefined,
        random,
      );
      this.unbounded = true;
      return { steps, clipNorm: this.clipNorm, privacy: this.report() };
    }

    const round = this.planRound();
    if (!this.accountant.canAfford(round)) throw new PrivacyBudgetExhaustedError();

    const result = trainDpRound(model, examples, { ...round, clipNorm: this.clipNorm }, this.adaptive, random);
    this.accountant.record(round);
    this.clipNorm = result.nextClipNorm;
    return { steps: result.steps, clipNorm: result.clipNorm, privacy: this.report() };
  }
}
