/**
 * Tests for automatic waitlist confirmation when a booking is cancelled.
 */

type WaitlistStatus = "waiting" | "notified" | "confirmed" | "expired";

interface WaitlistEntry {
  id: string;
  userId: string;
  venueId: string;
  date: string;
  joinedAt: number;
  status: WaitlistStatus;
  notifiedAt?: number;
  responseDeadlineMs?: number;
}

function findNextWaiting(entries: WaitlistEntry[]): WaitlistEntry | null {
  const waiting = entries
    .filter((e) => e.status === "waiting")
    .sort((a, b) => a.joinedAt - b.joinedAt);
  return waiting[0] ?? null;
}

function notifyEntry(entry: WaitlistEntry, nowMs: number, responseWindowMs = 3_600_000): WaitlistEntry {
  return {
    ...entry,
    status: "notified",
    notifiedAt: nowMs,
    responseDeadlineMs: nowMs + responseWindowMs,
  };
}

function hasResponseExpired(entry: WaitlistEntry, nowMs: number): boolean {
  if (entry.status !== "notified" || !entry.responseDeadlineMs) return false;
  return nowMs > entry.responseDeadlineMs;
}

function confirmEntry(entry: WaitlistEntry): WaitlistEntry {
  return { ...entry, status: "confirmed" };
}

const NOW = 1_700_000_000_000;
const ENTRIES: WaitlistEntry[] = [
  { id: "w1", userId: "u1", venueId: "v1", date: "2026-10-01", joinedAt: NOW - 3000, status: "waiting"  },
  { id: "w2", userId: "u2", venueId: "v1", date: "2026-10-01", joinedAt: NOW - 2000, status: "waiting"  },
  { id: "w3", userId: "u3", venueId: "v1", date: "2026-10-01", joinedAt: NOW - 1000, status: "notified", notifiedAt: NOW - 500, responseDeadlineMs: NOW + 3_500_000 },
];

describe("Waitlist auto-confirm", () => {
  it("findNextWaiting: returns earliest by joinedAt", () => {
    const next = findNextWaiting(ENTRIES);
    expect(next!.id).toBe("w1");
  });

  it("findNextWaiting: returns null if none waiting", () => {
    const none = ENTRIES.filter((e) => e.status !== "waiting");
    expect(findNextWaiting(none)).toBeNull();
  });

  it("notifyEntry sets status and deadline", () => {
    const notified = notifyEntry(ENTRIES[0], NOW);
    expect(notified.status).toBe("notified");
    expect(notified.responseDeadlineMs).toBe(NOW + 3_600_000);
  });

  it("notifyEntry is immutable", () => {
    notifyEntry(ENTRIES[0], NOW);
    expect(ENTRIES[0].status).toBe("waiting");
  });

  it("hasResponseExpired: within deadline → false", () => {
    expect(hasResponseExpired(ENTRIES[2], NOW)).toBe(false);
  });

  it("hasResponseExpired: past deadline → true", () => {
    expect(hasResponseExpired(ENTRIES[2], NOW + 4_000_000)).toBe(true);
  });

  it("hasResponseExpired: non-notified → false", () => {
    expect(hasResponseExpired(ENTRIES[0], NOW + 99_999_999)).toBe(false);
  });

  it("confirmEntry sets status to confirmed", () => {
    const confirmed = confirmEntry(ENTRIES[2]);
    expect(confirmed.status).toBe("confirmed");
  });
});
