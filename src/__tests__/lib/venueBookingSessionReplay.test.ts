/**
 * Tests for booking session replay data management.
 */

interface SessionReplayEvent {
  eventId: string;
  sessionId: string;
  type: "click" | "scroll" | "input" | "navigation" | "error";
  timestamp: number;
  element?: string;
  value?: string;
  errorMessage?: string;
}

interface SessionReplay {
  sessionId: string;
  userId: string;
  startMs: number;
  endMs: number | null;
  events: SessionReplayEvent[];
  hasErrors: boolean;
  completed: boolean;
}

function sessionDurationMs(session: SessionReplay, nowMs: number): number {
  const end = session.endMs ?? nowMs;
  return end - session.startMs;
}

function errorEvents(session: SessionReplay): SessionReplayEvent[] {
  return session.events.filter((e) => e.type === "error");
}

function clickEvents(session: SessionReplay): SessionReplayEvent[] {
  return session.events.filter((e) => e.type === "click");
}

function hasBookingError(session: SessionReplay): boolean {
  return session.events.some(
    (e) => e.type === "error" && e.errorMessage !== undefined
  );
}

function sessionEventFrequency(session: SessionReplay, type: string): number {
  const durationMin = sessionDurationMs(session, Date.now()) / 60_000;
  const count = session.events.filter((e) => e.type === type).length;
  return durationMin > 0 ? Math.round(count / durationMin * 10) / 10 : 0;
}

function compressReplayEvents(events: SessionReplayEvent[], maxEvents = 50): SessionReplayEvent[] {
  if (events.length <= maxEvents) return events;
  // Keep all errors + first/last + sample middle
  const errors = events.filter((e) => e.type === "error");
  const nonErrors = events.filter((e) => e.type !== "error");
  const first = nonErrors.slice(0, 5);
  const last = nonErrors.slice(-5);
  const middle = nonErrors.slice(5, -5);
  const step = Math.ceil(middle.length / (maxEvents - errors.length - 10));
  const sampled = middle.filter((_, i) => i % step === 0);
  return [...first, ...sampled, ...last, ...errors].slice(0, maxEvents);
}

const NOW = 1_700_000_000_000;
const SESSION: SessionReplay = {
  sessionId: "sr1", userId: "u1",
  startMs: NOW - 5 * 60_000, endMs: null,
  events: [
    { eventId: "e1", sessionId: "sr1", type: "click",  timestamp: NOW - 4 * 60_000, element: "search-button" },
    { eventId: "e2", sessionId: "sr1", type: "scroll", timestamp: NOW - 3 * 60_000 },
    { eventId: "e3", sessionId: "sr1", type: "error",  timestamp: NOW - 2 * 60_000, errorMessage: "Payment failed" },
    { eventId: "e4", sessionId: "sr1", type: "click",  timestamp: NOW - 1 * 60_000, element: "retry-button" },
  ],
  hasErrors: true, completed: false,
};

describe("Booking session replay", () => {
  it("sessionDurationMs: 5 min active session", () => {
    expect(sessionDurationMs(SESSION, NOW)).toBe(5 * 60_000);
  });

  it("errorEvents: 1 error event", () => {
    expect(errorEvents(SESSION)).toHaveLength(1);
  });

  it("clickEvents: 2 click events", () => {
    expect(clickEvents(SESSION)).toHaveLength(2);
  });

  it("hasBookingError: true for error with message", () => {
    expect(hasBookingError(SESSION)).toBe(true);
  });

  it("hasBookingError: false for no errors", () => {
    const noErrors = { ...SESSION, events: SESSION.events.filter((e) => e.type !== "error") };
    expect(hasBookingError(noErrors)).toBe(false);
  });

  it("compressReplayEvents: keeps within max events", () => {
    const manyEvents = Array.from({ length: 100 }, (_, i) => ({
      eventId: `e${i}`, sessionId: "sr1", type: "click" as const, timestamp: NOW - i * 1000,
    }));
    const compressed = compressReplayEvents(manyEvents, 50);
    expect(compressed).toHaveLength(50);
  });
});
