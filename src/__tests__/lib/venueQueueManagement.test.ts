/**
 * Tests for venue entry queue (ticketing/virtual queue) management.
 */

interface QueueTicket {
  ticketId: string;
  userId: string;
  venueId: string;
  issuedAt: number;
  calledAt: number | null;
  servedAt: number | null;
  estimatedWaitMs: number;
}

function queuePosition(tickets: QueueTicket[], ticketId: string): number {
  const waiting = tickets
    .filter((t) => t.calledAt === null)
    .sort((a, b) => a.issuedAt - b.issuedAt);
  const idx = waiting.findIndex((t) => t.ticketId === ticketId);
  return idx === -1 ? -1 : idx + 1;
}

function callNextTicket(tickets: QueueTicket[], nowMs: number): QueueTicket[] {
  const nextIdx = tickets.findIndex((t) => t.calledAt === null);
  if (nextIdx === -1) return tickets;
  return tickets.map((t, i) => (i === nextIdx ? { ...t, calledAt: nowMs } : t));
}

function averageWaitMs(tickets: QueueTicket[]): number {
  const served = tickets.filter((t) => t.calledAt !== null && t.issuedAt !== null);
  if (served.length === 0) return 0;
  return served.reduce((sum, t) => sum + (t.calledAt! - t.issuedAt), 0) / served.length;
}

function waitingCount(tickets: QueueTicket[]): number {
  return tickets.filter((t) => t.calledAt === null).length;
}

const NOW = 1_700_000_000_000;
const TICKETS: QueueTicket[] = [
  { ticketId: "t1", userId: "u1", venueId: "v1", issuedAt: NOW - 900_000, calledAt: NOW - 600_000, servedAt: null, estimatedWaitMs: 300_000 },
  { ticketId: "t2", userId: "u2", venueId: "v1", issuedAt: NOW - 600_000, calledAt: null, servedAt: null, estimatedWaitMs: 300_000 },
  { ticketId: "t3", userId: "u3", venueId: "v1", issuedAt: NOW - 300_000, calledAt: null, servedAt: null, estimatedWaitMs: 600_000 },
];

describe("Venue queue management", () => {
  it("queuePosition: t2 is first in waiting", () => {
    expect(queuePosition(TICKETS, "t2")).toBe(1);
  });

  it("queuePosition: t3 is second in waiting", () => {
    expect(queuePosition(TICKETS, "t3")).toBe(2);
  });

  it("queuePosition: already called → -1", () => {
    expect(queuePosition(TICKETS, "t1")).toBe(-1);
  });

  it("waitingCount: 2 waiting", () => {
    expect(waitingCount(TICKETS)).toBe(2);
  });

  it("callNextTicket: calls t2 (earliest waiting)", () => {
    const updated = callNextTicket(TICKETS, NOW);
    expect(updated.find((t) => t.ticketId === "t2")!.calledAt).toBe(NOW);
  });

  it("callNextTicket: t3 still waiting", () => {
    const updated = callNextTicket(TICKETS, NOW);
    expect(updated.find((t) => t.ticketId === "t3")!.calledAt).toBeNull();
  });

  it("averageWaitMs: t1 waited 300s = 300000ms", () => {
    expect(averageWaitMs(TICKETS)).toBe(300_000);
  });

  it("averageWaitMs: no served tickets → 0", () => {
    const noServed = TICKETS.map((t) => ({ ...t, calledAt: null }));
    expect(averageWaitMs(noServed)).toBe(0);
  });
});
