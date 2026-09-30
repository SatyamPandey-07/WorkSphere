/**
 * Tests for support ticket priority queue.
 */

type TicketPriority = "low" | "medium" | "high" | "critical";

interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  priority: TicketPriority;
  createdAt: number;
  resolvedAt?: number;
}

const PRIORITY_ORDER: Record<TicketPriority, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

function sortByPriority(tickets: SupportTicket[]): SupportTicket[] {
  return [...tickets].sort((a, b) => {
    const diff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    return diff !== 0 ? diff : a.createdAt - b.createdAt; // tie-break: FIFO
  });
}

function openTickets(tickets: SupportTicket[]): SupportTicket[] {
  return tickets.filter((t) => !t.resolvedAt);
}

function escalate(ticket: SupportTicket): SupportTicket {
  const order: TicketPriority[] = ["low", "medium", "high", "critical"];
  const idx = order.indexOf(ticket.priority);
  const next = order[Math.min(idx + 1, order.length - 1)];
  return { ...ticket, priority: next };
}

const NOW = 1_700_000_000_000;
const TICKETS: SupportTicket[] = [
  { id: "t1", userId: "u1", subject: "Login issue",   priority: "medium",   createdAt: NOW - 3000 },
  { id: "t2", userId: "u2", subject: "Payment stuck", priority: "critical", createdAt: NOW - 2000 },
  { id: "t3", userId: "u3", subject: "UI glitch",     priority: "low",      createdAt: NOW - 1000 },
  { id: "t4", userId: "u1", subject: "Booking error", priority: "high",     createdAt: NOW - 500, resolvedAt: NOW - 100 },
];

describe("Support ticket priority queue", () => {
  it("sortByPriority: critical first", () => {
    const sorted = sortByPriority(TICKETS);
    expect(sorted[0].priority).toBe("critical");
  });

  it("sortByPriority: low last among open", () => {
    const sorted = sortByPriority(openTickets(TICKETS));
    expect(sorted[sorted.length - 1].priority).toBe("low");
  });

  it("openTickets excludes resolved", () => {
    const open = openTickets(TICKETS);
    expect(open.every((t) => !t.resolvedAt)).toBe(true);
  });

  it("openTickets count: 3 open", () => {
    expect(openTickets(TICKETS)).toHaveLength(3);
  });

  it("escalate: low → medium", () => {
    expect(escalate(TICKETS[2]).priority).toBe("medium");
  });

  it("escalate: high → critical", () => {
    expect(escalate(TICKETS[3]).priority).toBe("critical");
  });

  it("escalate: critical stays critical", () => {
    expect(escalate(TICKETS[1]).priority).toBe("critical");
  });

  it("escalate is immutable", () => {
    escalate(TICKETS[2]);
    expect(TICKETS[2].priority).toBe("low");
  });
});
