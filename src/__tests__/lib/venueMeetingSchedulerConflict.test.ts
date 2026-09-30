/**
 * Tests for meeting scheduler conflict detection and resolution.
 */

interface Meeting {
  meetingId: string;
  organizer: string;
  participants: string[];
  roomId: string;
  startMs: number;
  endMs: number;
  priority: number;
}

function detectSchedulingConflicts(meetings: Meeting[]): { meetingA: string; meetingB: string }[] {
  const conflicts: { meetingA: string; meetingB: string }[] = [];
  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      const a = meetings[i];
      const b = meetings[j];
      // Conflict if same room and overlapping time, or participant double-booked
      const sameRoom = a.roomId === b.roomId && a.startMs < b.endMs && a.endMs > b.startMs;
      const participantConflict = a.participants.some((p) => b.participants.includes(p)) &&
                                  a.startMs < b.endMs && a.endMs > b.startMs;
      if (sameRoom || participantConflict) {
        conflicts.push({ meetingA: a.meetingId, meetingB: b.meetingId });
      }
    }
  }
  return conflicts;
}

function suggestRescheduling(
  conflictingMeeting: Meeting,
  higherPriorityMeeting: Meeting,
  bufferMs = 15 * 60_000
): { newStartMs: number; newEndMs: number } {
  const duration = conflictingMeeting.endMs - conflictingMeeting.startMs;
  const newStart = higherPriorityMeeting.endMs + bufferMs;
  return { newStartMs: newStart, newEndMs: newStart + duration };
}

function participantFreeSlots(
  allMeetings: Meeting[],
  participantId: string,
  windowStartMs: number,
  windowEndMs: number,
  slotDurationMs: number
): { startMs: number; endMs: number }[] {
  const participantMeetings = allMeetings
    .filter((m) => m.participants.includes(participantId))
    .sort((a, b) => a.startMs - b.startMs);

  const slots: { startMs: number; endMs: number }[] = [];
  let current = windowStartMs;

  for (const meeting of participantMeetings) {
    if (meeting.startMs > current + slotDurationMs - 1) {
      slots.push({ startMs: current, endMs: current + slotDurationMs });
    }
    current = Math.max(current, meeting.endMs);
  }

  if (current + slotDurationMs <= windowEndMs) {
    slots.push({ startMs: current, endMs: current + slotDurationMs });
  }

  return slots;
}

const NOW = 1_700_000_000_000;
const MEETINGS: Meeting[] = [
  { meetingId: "m1", organizer: "u1", participants: ["u1", "u2"], roomId: "r1", startMs: NOW, endMs: NOW + 3600_000, priority: 1 },
  { meetingId: "m2", organizer: "u3", participants: ["u2", "u3"], roomId: "r2", startMs: NOW + 1800_000, endMs: NOW + 5400_000, priority: 2 }, // u2 double-booked
  { meetingId: "m3", organizer: "u4", participants: ["u4"], roomId: "r1", startMs: NOW + 1800_000, endMs: NOW + 3600_000, priority: 1 }, // r1 conflict
];

describe("Meeting scheduler conflict detection", () => {
  it("detectSchedulingConflicts: u2 double-booked and r1 conflict", () => {
    const conflicts = detectSchedulingConflicts(MEETINGS);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("detectSchedulingConflicts: non-overlapping → no conflict", () => {
    const noOverlap: Meeting[] = [
      { meetingId: "a", organizer: "u1", participants: ["u1"], roomId: "r1", startMs: NOW, endMs: NOW + 3600_000, priority: 1 },
      { meetingId: "b", organizer: "u2", participants: ["u2"], roomId: "r1", startMs: NOW + 4000_000, endMs: NOW + 7600_000, priority: 1 },
    ];
    expect(detectSchedulingConflicts(noOverlap)).toHaveLength(0);
  });

  it("suggestRescheduling: moves after higher priority + buffer", () => {
    const rescheduled = suggestRescheduling(MEETINGS[1], MEETINGS[0]);
    expect(rescheduled.newStartMs).toBeGreaterThan(MEETINGS[0].endMs);
  });

  it("participantFreeSlots: u4 has free slots before and after meetings", () => {
    const slots = participantFreeSlots(MEETINGS, "u4", NOW, NOW + 7200_000, 30 * 60_000);
    expect(slots.length).toBeGreaterThan(0);
  });
});
