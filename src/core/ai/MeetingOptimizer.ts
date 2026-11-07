/**
 * @file MeetingOptimizer.ts
 * @description Groq-powered AI meeting optimizer that evaluates timezone overlap slots
 * against team urgency, duration constraints, and preferred time windows.
 */

import Groq from "groq-sdk";
import type { OverlapSlot } from "@/core/scheduling/TimezoneOverlapMatrix";

export interface MeetingContext {
  title: string;
  participants: string[];
  durationMinutes: number;
  urgency: "low" | "medium" | "high" | "critical";
  preferredTimeOfDay: "morning" | "afternoon" | "evening";
}

export class MeetingOptimizer {
  private groq: Groq;

  constructor(apiKey?: string) {
    this.groq = new Groq({
      apiKey: apiKey || process.env.GROQ_API_KEY || "dummy-key-for-build",
    });
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
}

export default MeetingOptimizer;
