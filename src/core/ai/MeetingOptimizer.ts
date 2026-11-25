/**
 * @file MeetingOptimizer.ts
 * @description Groq-powered AI meeting optimizer that evaluates timezone overlap slots
 * against team urgency, duration constraints, and preferred time windows.
 * Integrates MultiAgentOrchestrator with token budget governance to prune auxiliary tools.
 * Also provides multi-objective Pareto frontier ranking for candidate meeting venues
 * evaluating travel fairness, WiFi reliability, and acoustic quietness.
 */

import Groq from "groq-sdk";
import type { OverlapSlot } from "@/core/scheduling/TimezoneOverlapMatrix";
import {
  MultiAgentOrchestrator,
  type AgentToolDeclaration,
  type TokenTelemetryRecord,
} from "@/lib/agents/MultiAgentOrchestrator";

export interface ParticipantBusyInterval {
  startUTC: number;
  endUTC: number;
}

export interface MeetingOptimizerOptions {
  /** Minimum recovery gap between meetings. Defaults to 15 minutes. */
  bufferMinutes?: number;
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

/**
 * Candidate venue for multi-objective Pareto optimization.
 */
export interface CandidateVenue {
  id: string;
  name: string;
  /**
   * Travel fairness score (higher is fairer / better). Missing/NaN defaults to 0.
   */
  travelFairness?: number;
  /**
   * WiFi reliability score (higher is better, e.g. 0-100 or 1-5). Missing/NaN defaults to 0.
   */
  wifiReliability?: number;
  /**
   * Acoustic quietness score (higher is quieter / better, e.g. 0-100 or 1-5). Missing/NaN defaults to 0.
   */
  acousticQuietness?: number;
  /** Additional arbitrary metadata */
  [key: string]: any;
}

export interface ParetoRankingResult {
  /** All non-dominated candidate venues along the Pareto frontier, ranked deterministically */
  paretoFrontier: CandidateVenue[];
  /** Candidate venues strictly dominated by at least one other venue */
  dominatedVenues: CandidateVenue[];
  /** Final ranked venues (Pareto frontier prioritized, followed by non-frontier or sorted) */
  rankedVenues: CandidateVenue[];
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

    const subagentResult = await this.orchestrator.invokeSubagent({
      subagentName: "MeetingSchedulingAgent",
      instruction: taskInstruction,
      context: { context, candidateSummary },
      tools,
    });

    const selectedSlot = sortedSlots[0] || null;

    return {
      slots: sortedSlots,
      selectedSlot,
      rationale: subagentResult.content,
      telemetry: subagentResult.telemetry,
    };
  }

  /**
   * Sanitizes and normalizes an objective score safely.
   */
  private sanitizeObjective(val: any): number {
    const num = Number(val);
    return Number.isFinite(num) ? num : 0;
  }

  /**
   * Evaluates if venue A strictly dominates venue B across all 3 objectives:
   * 1. travelFairness (higher is better)
   * 2. wifiReliability (higher is better)
   * 3. acousticQuietness (higher is better)
   *
   * A strictly dominates B if:
   * A >= B in all 3 objectives, AND
   * A > B in at least one objective.
   */
  public isStrictlyDominated(a: CandidateVenue, b: CandidateVenue): boolean {
    const aTF = this.sanitizeObjective(a.travelFairness);
    const aWifi = this.sanitizeObjective(a.wifiReliability);
    const aQuiet = this.sanitizeObjective(a.acousticQuietness);

    const bTF = this.sanitizeObjective(b.travelFairness);
    const bWifi = this.sanitizeObjective(b.wifiReliability);
    const bQuiet = this.sanitizeObjective(b.acousticQuietness);

    const atLeastAsGood = aTF >= bTF && aWifi >= bWifi && aQuiet >= bQuiet;
    const strictlyBetterInOne = aTF > bTF || aWifi > bWifi || aQuiet > bQuiet;

    return atLeastAsGood && strictlyBetterInOne;
  }

  /**
   * Deterministic tie-breaking comparator for venues.
   * Compares total objective aggregate score, then individual objectives, then stable ID/name.
   */
  private compareVenuesDeterministically(a: CandidateVenue, b: CandidateVenue): number {
    const aTF = this.sanitizeObjective(a.travelFairness);
    const aWifi = this.sanitizeObjective(a.wifiReliability);
    const aQuiet = this.sanitizeObjective(a.acousticQuietness);
    const aTotal = aTF + aWifi + aQuiet;

    const bTF = this.sanitizeObjective(b.travelFairness);
    const bWifi = this.sanitizeObjective(b.wifiReliability);
    const bQuiet = this.sanitizeObjective(b.acousticQuietness);
    const bTotal = bTF + bWifi + bQuiet;

    if (bTotal !== aTotal) {
      return bTotal - aTotal;
    }
    if (bTF !== aTF) {
      return bTF - aTF;
    }
    if (bWifi !== aWifi) {
      return bWifi - aWifi;
    }
    if (bQuiet !== aQuiet) {
      return bQuiet - aQuiet;
    }

    // Deterministic tie-breaker using stable identifiers
    const idA = String(a.id ?? a.name ?? "");
    const idB = String(b.id ?? b.name ?? "");
    return idA.localeCompare(idB);
  }

  /**
   * Computes the Pareto frontier of candidate venues across travel fairness,
   * WiFi reliability, and acoustic quietness.
   *
   * 1. Eliminates all strictly dominated venues.
   * 2. Preserves all non-dominated candidates on the Pareto frontier.
   * 3. Sorts venues deterministically using tie-breakers so repeated runs with
   *    identical inputs produce identical results regardless of input order.
   */
  public rankVenuesPareto(candidates: CandidateVenue[]): ParetoRankingResult {
    if (!candidates || candidates.length === 0) {
      return {
        paretoFrontier: [],
        dominatedVenues: [],
        rankedVenues: [],
      };
    }

    // Sort initial list deterministically to ensure order independence
    const cleanCandidates = [...candidates].sort((a, b) =>
      this.compareVenuesDeterministically(a, b),
    );

    const paretoFrontier: CandidateVenue[] = [];
    const dominatedVenues: CandidateVenue[] = [];

    for (let i = 0; i < cleanCandidates.length; i++) {
      const candidate = cleanCandidates[i];
      let dominated = false;

      for (let j = 0; j < cleanCandidates.length; j++) {
        if (i === j) continue;
        const other = cleanCandidates[j];
        if (this.isStrictlyDominated(other, candidate)) {
          dominated = true;
          break;
        }
      }

      if (dominated) {
        dominatedVenues.push(candidate);
      } else {
        paretoFrontier.push(candidate);
      }
    }

    paretoFrontier.sort((a, b) => this.compareVenuesDeterministically(a, b));
    dominatedVenues.sort((a, b) => this.compareVenuesDeterministically(a, b));

    // The final ranked list contains the Pareto frontier first, followed by dominated venues
    const rankedVenues = [...paretoFrontier, ...dominatedVenues];

    return {
      paretoFrontier,
      dominatedVenues,
      rankedVenues,
    };
  }
}

export default MeetingOptimizer;
