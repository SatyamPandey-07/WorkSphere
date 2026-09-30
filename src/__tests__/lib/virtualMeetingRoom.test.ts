/**
 * Tests for virtual meeting room session management.
 */

type MeetingStatus = "scheduled" | "live" | "ended";

interface VirtualMeeting {
  id: string;
  hostId: string;
  participants: string[];
  status: MeetingStatus;
  scheduledAt: number;
  startedAt: number | null;
  endedAt: number | null;
  maxParticipants: number;
}

function isMeetingFull(meeting: VirtualMeeting): boolean {
  return meeting.participants.length >= meeting.maxParticipants;
}

function joinMeeting(meeting: VirtualMeeting, userId: string): VirtualMeeting {
  if (meeting.status === "ended") throw new Error("Meeting has ended");
  if (isMeetingFull(meeting)) throw new Error("Meeting is full");
  if (meeting.participants.includes(userId)) return meeting; // already in
  return { ...meeting, participants: [...meeting.participants, userId] };
}

function leaveMeeting(meeting: VirtualMeeting, userId: string): VirtualMeeting {
  return { ...meeting, participants: meeting.participants.filter((p) => p !== userId) };
}

function startMeeting(meeting: VirtualMeeting, nowMs: number): VirtualMeeting {
  if (meeting.status !== "scheduled") throw new Error("Cannot start meeting");
  return { ...meeting, status: "live", startedAt: nowMs };
}

function endMeeting(meeting: VirtualMeeting, nowMs: number): VirtualMeeting {
  if (meeting.status !== "live") throw new Error("Meeting is not live");
  return { ...meeting, status: "ended", endedAt: nowMs, participants: [] };
}

const NOW = 1_700_000_000_000;
const MEETING: VirtualMeeting = {
  id: "m1", hostId: "u1", participants: ["u1", "u2"],
  status: "scheduled", scheduledAt: NOW + 3_600_000, startedAt: null, endedAt: null,
  maxParticipants: 5,
};

describe("Virtual meeting room", () => {
  it("isMeetingFull: 2/5 → false", () => {
    expect(isMeetingFull(MEETING)).toBe(false);
  });

  it("isMeetingFull: at capacity → true", () => {
    expect(isMeetingFull({ ...MEETING, participants: ["u1", "u2", "u3", "u4", "u5"] })).toBe(true);
  });

  it("joinMeeting: adds new participant", () => {
    const updated = joinMeeting(MEETING, "u3");
    expect(updated.participants).toContain("u3");
  });

  it("joinMeeting: no-op if already in meeting", () => {
    expect(joinMeeting(MEETING, "u1").participants).toHaveLength(2);
  });

  it("joinMeeting: throws when ended", () => {
    const ended = { ...MEETING, status: "ended" as MeetingStatus };
    expect(() => joinMeeting(ended, "u3")).toThrow("ended");
  });

  it("leaveMeeting: removes participant", () => {
    const updated = leaveMeeting(MEETING, "u2");
    expect(updated.participants).not.toContain("u2");
  });

  it("startMeeting: sets status to live", () => {
    const started = startMeeting(MEETING, NOW);
    expect(started.status).toBe("live");
    expect(started.startedAt).toBe(NOW);
  });

  it("startMeeting: throws if not scheduled", () => {
    const live = { ...MEETING, status: "live" as MeetingStatus };
    expect(() => startMeeting(live, NOW)).toThrow();
  });

  it("endMeeting: clears participants", () => {
    const live = { ...MEETING, status: "live" as MeetingStatus, startedAt: NOW - 100 };
    const ended = endMeeting(live, NOW);
    expect(ended.status).toBe("ended");
    expect(ended.participants).toHaveLength(0);
  });
});
