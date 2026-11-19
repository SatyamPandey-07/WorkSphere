/**
 * @file MeetingOptimizer.ts
 * @description Groq-powered AI meeting optimizer that evaluates timezone overlap slots
 * against team urgency, duration constraints, and preferred time windows.
 * Integrates MultiAgentOrchestrator with token budget governance to prune auxiliary tools.
 */

import Groq from "groq-sdk";
import type { OverlapSlot } from "@/core/scheduling/TimezoneOverlapMatrix";
import {
  MultiAgentOrchestrator,
  type AgentToolDeclaration,
  type SubagentExecutionResult,
  type TokenTelemetryRecord,
} from "@/lib/agents/MultiAgentOrchestrator";
import {
  getErrorStatus,
  isRetryableLlmError,
  retryWithBackoff,
  type RetryOptions,
} from "@/lib/ai/retryWithBackoff";

export interface ParticipantBusyInterval {
  startUTC: number;
  endUTC: number;
}

export interface MeetingOptimizerOptions {
  /** Minimum recovery gap between meetings. Defaults to 15 minutes. */
  bufferMinutes?: number;
  /**
   * Retry policy for the LLM reasoning call in optimizeMeetingWithGovernor.
   * Transient errors (429, 502, 503, 504) are retried with exponential backoff
   * and jitter, 3 attempts by default.
   */
  retry?: RetryOptions;
}

export interface MeetingContext {
  title: string;
  participants: string[];
  durationMinutes: number;
  urgency: "low" | "medium" | "high" | "critical";
  preferredTimeOfDay: "morning" | "afternoon" | "evening";
  /** Optional IANA timezone for each participant, keyed by participant id. */
  participantTimezones?: Record<string, string>;
  /** Existing calendar blocks for each participant, expressed as UTC timestamps. */
  participantBusyIntervals?: Record<string, ParticipantBusyInterval[]>;
  /** Per-meeting override for the optimizer's configured recovery buffer. */
  bufferMinutes?: number;
}

export interface OptimizedMeetingResult {
  slots: OverlapSlot[];
  selectedSlot: OverlapSlot | null;
  rationale: string;
  telemetry: TokenTelemetryRecord | null;
}


/** Candidate venue metrics used by the multi-perspective consensus solver. */
export interface MeetingConsensusVenue {
  id: string;
  name: string;
  /** Travel distance in metres, keyed by participant id. */
  distanceByParticipantMeters: Record<string, number>;
  noiseDecibels: number;
  /** Outlet availability from 0 (none) to 1 (fully available). */
  powerOutletAvailability: number;
  wifiMbps?: number;
  hasOutdoorSeating?: boolean;
  hasBikeParking?: boolean;
}

export interface MeetingParticipantPreference {
  participantId: string;
  maxDistanceMeters?: number;
  maxNoiseDecibels?: number;
  minWifiMbps?: number;
  requiresPowerOutlet?: boolean;
  requiresOutdoorSeating?: boolean;
  requiresBikeParking?: boolean;
}

export interface MeetingConsensusOptions {
  weights?: { distance: number; noise: number; power: number };
  /** Number of ordered relaxation steps to allow (0–4). Defaults to 4. */
  maxRelaxationRounds?: number;
}

export interface MeetingConsensusRecommendation {
  venue: MeetingConsensusVenue;
  consensusScore: number;
  paretoRank: number;
  perspectiveScores: { distance: number; noise: number; power: number };
  rationale: string;
}

export interface MeetingConsensusResult {
  selectedVenue: MeetingConsensusRecommendation | null;
  recommendations: MeetingConsensusRecommendation[];
  reasoningBreakdown: string[];
  relaxationSteps: string[];
  elapsedMs: number;
}

export class MeetingOptimizer {
  private groq: Groq;
  private orchestrator: MultiAgentOrchestrator;
  private options: MeetingOptimizerOptions;

  constructor(
    apiKey?: string,
    orchestrator?: MultiAgentOrchestrator,
    options: MeetingOptimizerOptions = {},
  ) {
    this.options = { bufferMinutes: 15, ...options };
    const key = apiKey || process.env.GROQ_API_KEY || "dummy-key-for-build";
    this.groq = new Groq({
      apiKey: key,
    });
    this.orchestrator =
      orchestrator ||
      new MultiAgentOrchestrator(
        {
          maxTokenAllowance: 4096,
          pruningThreshold: 0.75,
          reserveCompletionTokens: 512,
          debug: false,
        },
        key
      );
  }

  public getOrchestrator(): MultiAgentOrchestrator {
    return this.orchestrator;
  }

  /**
   * Resolves competing venue preferences through independent distance, quietness,
   * and power-access perspectives, then combines them into a Pareto-ranked result.
   * The calculation is deterministic and local; it does not wait on an LLM/network call.
   */
  public optimizeMeetingConsensus(
    venues: MeetingConsensusVenue[],
    preferences: MeetingParticipantPreference[],
    options: MeetingConsensusOptions = {},
  ): MeetingConsensusResult {
    const startedAt = Date.now();
    if (!Array.isArray(venues) || venues.length === 0) {
      return {
        selectedVenue: null,
        recommendations: [],
        reasoningBreakdown: ["No candidate venues were supplied."],
        relaxationSteps: [],
        elapsedMs: Date.now() - startedAt,
      };
    }
    if (venues.length > 250 || preferences.length > 100) {
      throw new RangeError("Consensus is limited to 250 venues and 100 participant preferences per run.");
    }

    const suppliedWeights = options.weights ?? { distance: 0.4, noise: 0.35, power: 0.25 };
    const weightTotal = suppliedWeights.distance + suppliedWeights.noise + suppliedWeights.power;
    if (
      !Number.isFinite(weightTotal) ||
      weightTotal <= 0 ||
      [suppliedWeights.distance, suppliedWeights.noise, suppliedWeights.power].some(
        (weight) => !Number.isFinite(weight) || weight < 0,
      )
    ) {
      throw new RangeError("Consensus weights must be finite, non-negative, and have a positive total.");
    }
    const weights = {
      distance: suppliedWeights.distance / weightTotal,
      noise: suppliedWeights.noise / weightTotal,
      power: suppliedWeights.power / weightTotal,
    };
    const clamp = (value: number) => Math.max(0, Math.min(100, value));

    const relaxationRounds = Math.max(
      0,
      Math.min(4, Math.floor(options.maxRelaxationRounds ?? 4)),
    );
    const relaxationSteps: string[] = [];
    let eligible: MeetingConsensusVenue[] = [];

    const isEligible = (venue: MeetingConsensusVenue, round: number): boolean =>
      preferences.every((preference) => {
        const distance = venue.distanceByParticipantMeters[preference.participantId];
        if (
          Number.isFinite(preference.maxDistanceMeters) &&
          (!Number.isFinite(distance) ||
            distance > (preference.maxDistanceMeters as number) * (round >= 3 ? 1.5 : 1))
        ) {
          return false;
        }

        const noiseAllowance = round >= 2 ? 10 : 0;
        if (
          Number.isFinite(preference.maxNoiseDecibels) &&
          (!Number.isFinite(venue.noiseDecibels) ||
            venue.noiseDecibels > (preference.maxNoiseDecibels as number) + noiseAllowance)
        ) {
          return false;
        }

        const wifiFloor = round >= 2 ? (preference.minWifiMbps ?? 0) * 0.75 : preference.minWifiMbps;
        if (
          Number.isFinite(wifiFloor) &&
          wifiFloor !== undefined &&
          (!Number.isFinite(venue.wifiMbps) || (venue.wifiMbps as number) < wifiFloor)
        ) {
          return false;
        }

        if (
          round < 4 &&
          preference.requiresPowerOutlet &&
          (!Number.isFinite(venue.powerOutletAvailability) || venue.powerOutletAvailability < 0.5)
        ) {
          return false;
        }
        if (
          round < 1 &&
          preference.requiresOutdoorSeating &&
          venue.hasOutdoorSeating !== true
        ) {
          return false;
        }
        if (round < 1 && preference.requiresBikeParking && venue.hasBikeParking !== true) {
          return false;
        }
        return true;
      });

    const relaxationLabels = [
      "Relaxed optional outdoor-seating and bike-parking requirements.",
      "Allowed a 10 dB noise-ceiling increase and a 25% Wi-Fi target reduction.",
      "Expanded each participant's travel-distance ceiling by 50%.",
      "Converted mandatory power-outlet requirements into a scored preference.",
    ];

    for (let round = 0; round <= relaxationRounds; round += 1) {
      eligible = venues.filter((venue) => isEligible(venue, round));
      if (eligible.length > 0) break;
      if (round < relaxationRounds) relaxationSteps.push(relaxationLabels[round]);
    }

    if (eligible.length === 0) {
      return {
        selectedVenue: null,
        recommendations: [],
        reasoningBreakdown: [
          "No venue satisfied the participant constraints, even after all enabled relaxation steps.",
        ],
        relaxationSteps,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const scored = eligible.map((venue) => {
      const distances = preferences
        .map((preference) => venue.distanceByParticipantMeters[preference.participantId])
        .filter((distance) => Number.isFinite(distance) && distance >= 0);
      const averageDistance = distances.length
        ? distances.reduce((total, distance) => total + distance, 0) / distances.length
        : 0;
      const distance = clamp(100 - (averageDistance / 25_000) * 100);
      const noise = clamp(100 - venue.noiseDecibels);
      const power = clamp(venue.powerOutletAvailability * 100);
      const consensusScore =
        distance * weights.distance + noise * weights.noise + power * weights.power;

      return {
        venue,
        consensusScore,
        perspectiveScores: { distance, noise, power },
        paretoRank: 0,
      };
    });

    // Assign nondominated Pareto fronts in O(n²), avoiding repeated full sorting.
    const dominates = (a: (typeof scored)[number], b: (typeof scored)[number]) => {
      const dimensions = ["distance", "noise", "power"] as const;
      const noWorse = dimensions.every(
        (key) => a.perspectiveScores[key] >= b.perspectiveScores[key],
      );
      const strictlyBetter = dimensions.some(
        (key) => a.perspectiveScores[key] > b.perspectiveScores[key],
      );
      return noWorse && strictlyBetter;
    };
    const dominatedByCount = scored.map(
      (candidate) => scored.filter((other) => dominates(other, candidate)).length,
    );
    const dominatesIndexes = scored.map((candidate) =>
      scored
        .map((other, index) => (dominates(candidate, other) ? index : -1))
        .filter((index) => index >= 0),
    );
    let frontier = dominatedByCount
      .map((count, index) => (count === 0 ? index : -1))
      .filter((index) => index >= 0);
    let rank = 1;
    while (frontier.length > 0) {
      const nextFrontier: number[] = [];
      for (const index of frontier) {
        scored[index].paretoRank = rank;
        for (const dominatedIndex of dominatesIndexes[index]) {
          dominatedByCount[dominatedIndex] -= 1;
          if (dominatedByCount[dominatedIndex] === 0) nextFrontier.push(dominatedIndex);
        }
      }
      frontier = nextFrontier;
      rank += 1;
    }

    const recommendations: MeetingConsensusRecommendation[] = scored
      .sort((a, b) => a.paretoRank - b.paretoRank || b.consensusScore - a.consensusScore)
      .map((entry) => ({
        venue: entry.venue,
        consensusScore: Number(entry.consensusScore.toFixed(2)),
        paretoRank: entry.paretoRank,
        perspectiveScores: {
          distance: Number(entry.perspectiveScores.distance.toFixed(2)),
          noise: Number(entry.perspectiveScores.noise.toFixed(2)),
          power: Number(entry.perspectiveScores.power.toFixed(2)),
        },
        rationale: `${entry.venue.name} scored ${entry.consensusScore.toFixed(2)} overall (distance ${entry.perspectiveScores.distance.toFixed(1)}, quietness ${entry.perspectiveScores.noise.toFixed(1)}, power access ${entry.perspectiveScores.power.toFixed(1)}); Pareto front ${entry.paretoRank}.`,
      }));

    const selectedVenue = recommendations[0] ?? null;
    const reasoningBreakdown = selectedVenue
      ? [
          `Distance perspective: ${selectedVenue.perspectiveScores.distance.toFixed(1)}/100 using the average participant travel distance.`,
          `Quietness perspective: ${selectedVenue.perspectiveScores.noise.toFixed(1)}/100 using the venue's reported decibel level.`,
          `Power-access perspective: ${selectedVenue.perspectiveScores.power.toFixed(1)}/100 using outlet availability.`,
          `Consensus: normalized weights distance ${weights.distance.toFixed(2)}, quietness ${weights.noise.toFixed(2)}, and power ${weights.power.toFixed(2)}; the highest-ranked eligible Pareto candidate is selected.`,
          ...relaxationSteps,
        ]
      : [];

    return {
      selectedVenue,
      recommendations,
      reasoningBreakdown,
      relaxationSteps,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private getLocalFatigueFactor(timestamp: number, timeZone: string): number {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(timestamp));
      const hour = Number(parts.find((part) => part.type === "hour")?.value);

      if (!Number.isFinite(hour)) return 1;
      if (hour < 7 || hour >= 21) return 1.75;
      if (hour < 9) return 1.35;
      if (hour >= 18) return 1.25;
      return 1;
    } catch {
      // Unknown or missing IANA zones use a neutral factor rather than
      // excluding a candidate slot.
      return 1;
    }
  }

  private getBufferPenalty(
    slot: OverlapSlot,
    context: MeetingContext,
    bufferMinutes: number,
  ): number {
    if (bufferMinutes <= 0) return 0;

    const participants =
      slot.participants?.length > 0 ? slot.participants : context.participants;
    const midpoint = (slot.startUTC + slot.endUTC) / 2;
    let totalPenalty = 0;

    for (const participant of participants) {
      const busyIntervals = context.participantBusyIntervals?.[participant] ?? [];
      let nearestGapMinutes = Number.POSITIVE_INFINITY;

      for (const interval of busyIntervals) {
        if (
          !Number.isFinite(interval.startUTC) ||
          !Number.isFinite(interval.endUTC) ||
          interval.endUTC < interval.startUTC
        ) {
          continue;
        }

        let gapMinutes: number;
        if (interval.endUTC <= slot.startUTC) {
          gapMinutes = (slot.startUTC - interval.endUTC) / 60_000;
        } else if (interval.startUTC >= slot.endUTC) {
          gapMinutes = (interval.startUTC - slot.endUTC) / 60_000;
        } else {
          // An overlap leaves no recovery time.
          gapMinutes = 0;
        }

        nearestGapMinutes = Math.min(nearestGapMinutes, gapMinutes);
      }

      if (nearestGapMinutes < bufferMinutes) {
        const missingBuffer = bufferMinutes - Math.max(0, nearestGapMinutes);
        const shortfall = missingBuffer / bufferMinutes;
        const timeZone = context.participantTimezones?.[participant] ?? "UTC";
        const fatigueFactor = this.getLocalFatigueFactor(midpoint, timeZone);
        totalPenalty += shortfall * fatigueFactor;
      }
    }

    return totalPenalty;
  }

  public async optimizeMeeting(
    context: MeetingContext,
    overlaps: OverlapSlot[],
  ): Promise<OverlapSlot[]> {
    if (!overlaps || overlaps.length === 0) return [];

    const viableSlots = overlaps.filter(
      (slot) => slot.durationMinutes >= context.durationMinutes,
    );
    if (viableSlots.length === 0) return [];

    const bufferMinutes = Math.max(
      0,
      context.bufferMinutes ?? this.options.bufferMinutes ?? 15,
    );

    // Participation remains the primary priority. The recovery penalty
    // differentiates slots with equal attendance before the chronological tie-break.
    const score = (slot: OverlapSlot) =>
      slot.participantCount * 1_000_000 -
      this.getBufferPenalty(slot, context, bufferMinutes) * 1_000;

    return viableSlots.sort((a, b) => {
      const scoreDifference = score(b) - score(a);
      return scoreDifference !== 0 ? scoreDifference : a.startUTC - b.startUTC;
    });
  }

  /**
   * Enhanced meeting optimization using MultiAgentOrchestrator with token budget governance.
   * Leverages subagent reasoning across candidate slots and dynamic tool selection.
   */
  public async optimizeMeetingWithGovernor(
    context: MeetingContext,
    overlaps: OverlapSlot[],
    tools?: AgentToolDeclaration[]
  ): Promise<OptimizedMeetingResult> {
    const sortedSlots = await this.optimizeMeeting(context, overlaps);
    if (sortedSlots.length === 0) {
      return {
        slots: [],
        selectedSlot: null,
        rationale: "No viable overlapping slots found for requested duration.",
        telemetry: null,
      };
    }

    const candidateSummary = sortedSlots.slice(0, 5).map((s, idx) => ({
      slotIndex: idx,
      startUTC: new Date(s.startUTC).toISOString(),
      endUTC: new Date(s.endUTC).toISOString(),
      durationMinutes: s.durationMinutes,
      participantCount: s.participantCount,
    }));

    const taskInstruction = `Evaluate the following candidate meeting slots for meeting '${context.title}' with urgency '${context.urgency}' and preferred time '${context.preferredTimeOfDay}'. Candidates: ${JSON.stringify(candidateSummary)}. Select the best slot index and explain why.`;

    const selectedSlot = sortedSlots[0] || null;

    let subagentResult: SubagentExecutionResult;
    try {
      subagentResult = await retryWithBackoff(
        () =>
          this.orchestrator.invokeSubagent({
            subagentName: "MeetingSchedulingAgent",
            instruction: taskInstruction,
            context: { context, candidateSummary },
            tools,
            rethrowRetryableErrors: true,
          }),
        this.options.retry,
      );
    } catch (error) {
      if (!isRetryableLlmError(error)) {
        throw error;
      }
      // Retries are exhausted. The deterministic ranking is still valid, so keep
      // the negotiation session alive instead of failing the whole request.
      console.warn(
        `[MeetingOptimizer] LLM reasoning unavailable after retries (status ${getErrorStatus(error)}); using deterministic ranking.`,
      );
      return {
        slots: sortedSlots,
        selectedSlot,
        rationale:
          "AI reasoning is temporarily unavailable (upstream rate limit or outage). Showing the top ranked slot from deterministic scoring.",
        telemetry: null,
      };
    }

    return {
      slots: sortedSlots,
      selectedSlot,
      rationale: subagentResult.content,
      telemetry: subagentResult.telemetry,
    };
  }
}

export default MeetingOptimizer;
