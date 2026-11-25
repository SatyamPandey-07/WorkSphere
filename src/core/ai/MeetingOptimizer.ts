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
export function formatUtcOffsetLabel(unixMs: number, timeZone: string): string {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC'; const local = getLocalParts(unixMs, safeTz);
  const diffMin = Math.round((Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0) - Math.floor(unixMs / 60_000) * 60_000) / 60_000);
  if (diffMin === 0) return 'UTC+00:00';
  const sign = diffMin >= 0 ? '+' : '-'; const abs = Math.abs(diffMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
export function evaluateParticipantLocalWindow(participant: MeetingParticipant, startUnixMs: number, endUnixMs: number): ParticipantLocalWindow {
  const safeTz = isValidTimeZone(participant.timeZone) ? participant.timeZone : 'UTC';
  const s = getLocalParts(startUnixMs, safeTz); const e = getLocalParts(endUnixMs, safeTz);
  const reasons: Array<'before_08_00' | 'after_19_00'> = [];
  if (s.minutesOfDay < 480) reasons.push('before_08_00');
  const nextDay = endUnixMs > startUnixMs && (e.year > s.year || e.month > s.month || e.day > s.day);
  if (nextDay || e.minutesOfDay > 1140 || s.minutesOfDay > 1140) reasons.push('after_19_00');
  return { participantId: participant.id, name: participant.name, timeZone: safeTz, utcOffsetLabel: formatUtcOffsetLabel(startUnixMs, safeTz), localStartFormatted: s.formattedTime, localEndFormatted: e.formattedTime, localStartMinutesOfDay: s.minutesOfDay, localEndMinutesOfDay: e.minutesOfDay, isOutOfHours: reasons.length > 0, outOfHoursReasons: reasons };
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
  public buildRecommendationSummary(slot: MeetingSlotCandidate, participants: readonly MeetingParticipant[]): MeetingRecommendationSummary {
    const windows = participants.map((p) => evaluateParticipantLocalWindow(p, slot.startUnixMs, slot.endUnixMs));
    const outOfHoursCount = windows.filter((w) => w.isOutOfHours).length;
    const score = typeof slot.score === 'number' && Number.isFinite(slot.score) ? slot.score : Math.max(0, 100 - outOfHoursCount * 25);
    const summaryText = windows.map((w) => `${w.name ? `${w.name} (${w.participantId})` : w.participantId}: ${w.localStartFormatted}–${w.localEndFormatted} (${w.utcOffsetLabel}, ${w.timeZone})${w.isOutOfHours ? ` [OUT OF HOURS: ${w.outOfHoursReasons.join(', ')}]` : ' [In Hours]'}`).join('\n');
    return { startUnixMs: slot.startUnixMs, endUnixMs: slot.endUnixMs, score, outOfHoursCount, isFairForAllParticipants: outOfHoursCount === 0, participants: windows, summaryText };
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
