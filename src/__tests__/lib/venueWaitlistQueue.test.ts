/**
 * Tests for venue waitlist queue management.
 */

interface WaitlistEntry {
  userId: string;
  joinedAt: number;
  priority?: number; // higher = served first
}

function enqueue(queue: WaitlistEntry[], entry: WaitlistEntry): WaitlistEntry[] {
  return [...queue, entry];
}

function dequeue(queue: WaitlistEntry[]): { next: WaitlistEntry | null; remaining: WaitlistEntry[] } {
  if (queue.length === 0) return { next: null, remaining: [] };
  const sorted = [...queue].sort((a, b) => {
    const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
    return pDiff !== 0 ? pDiff : a.joinedAt - b.joinedAt;
  });
  return { next: sorted[0], remaining: sorted.slice(1) };
}

function queuePosition(queue: WaitlistEntry[], userId: string): number {
  const sorted = [...queue].sort((a, b) => {
    const pDiff = (b.priority ?? 0) - (a.priority ?? 0);
    return pDiff !== 0 ? pDiff : a.joinedAt - b.joinedAt;
  });
  const idx = sorted.findIndex((e) => e.userId === userId);
  return idx === -1 ? -1 : idx + 1;
}

const BASE = 1_700_000_000_000;
const E1: WaitlistEntry = { userId: "u1", joinedAt: BASE };
const E2: WaitlistEntry = { userId: "u2", joinedAt: BASE + 1000 };
const E3: WaitlistEntry = { userId: "u3", joinedAt: BASE + 500, priority: 1 };

describe("Venue waitlist queue", () => {
  it("enqueue adds to end", () => {
    const q = enqueue([E1], E2);
    expect(q).toHaveLength(2);
    expect(q[1].userId).toBe("u2");
  });

  it("dequeue empty queue → next null", () => {
    const { next } = dequeue([]);
    expect(next).toBeNull();
  });

  it("dequeue FIFO when no priority", () => {
    const { next } = dequeue([E1, E2]);
    expect(next!.userId).toBe("u1");
  });

  it("dequeue priority takes precedence", () => {
    const { next } = dequeue([E1, E2, E3]);
    expect(next!.userId).toBe("u3");
  });

  it("remaining has queue length - 1", () => {
    const { remaining } = dequeue([E1, E2, E3]);
    expect(remaining).toHaveLength(2);
  });

  it("queuePosition first in line → 1", () => {
    expect(queuePosition([E1, E2], "u1")).toBe(1);
  });

  it("queuePosition not in queue → -1", () => {
    expect(queuePosition([E1], "u99")).toBe(-1);
  });

  it("queuePosition respects priority ordering", () => {
    expect(queuePosition([E1, E3], "u1")).toBe(2);
    expect(queuePosition([E1, E3], "u3")).toBe(1);
  });
});
