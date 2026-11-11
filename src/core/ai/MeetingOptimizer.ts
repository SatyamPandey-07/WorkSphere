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
  type TokenTelemetryRecord,
} from "@/lib/agents/MultiAgentOrchestrator";

export interface MeetingContext {
  title: string;
  participants: string[];
  durationMinutes: number;
  urgency: "low" | "medium" | "high" | "critical";
  preferredTimeOfDay: "morning" | "afternoon" | "evening";
}

export interface OptimizedMeetingResult {
  slots: OverlapSlot[];
  selectedSlot: OverlapSlot | null;
  rationale: string;
  telemetry: TokenTelemetryRecord | null;
}

export class MeetingOptimizer {
  private groq: Groq;
  private orchestrator: MultiAgentOrchestrator;

  constructor(apiKey?: string, orchestrator?: MultiAgentOrchestrator) {
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

  public async optimizeMeeting(
    context: MeetingContext,
    overlaps: OverlapSlot[],
  ): Promise<OverlapSlot[]> {
    if (!overlaps || overlaps.length === 0) return [];

    // Filter slots that accommodate the requested duration
    const viableSlots = overlaps.filter(
      (s) => s.durationMinutes >= context.durationMinutes,
    );
    if (viableSlots.length === 0) return [];

    // Sort by participant count (descending) and chronological start time
    return viableSlots.sort((a, b) => {
      if (b.participantCount !== a.participantCount) {
        return b.participantCount - a.participantCount;
      }
      return a.startUTC - b.startUTC;
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
}

export default MeetingOptimizer;
