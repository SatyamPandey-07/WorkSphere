/**
 * Tests for venue booking state machine transitions.
 */

type BookingState = "draft" | "pending_payment" | "payment_processing" | "confirmed" | "active" | "completed" | "cancelled" | "refund_pending" | "refunded";

const VALID_TRANSITIONS: Record<BookingState, BookingState[]> = {
  draft:              ["pending_payment", "cancelled"],
  pending_payment:    ["payment_processing", "cancelled"],
  payment_processing: ["confirmed", "pending_payment", "cancelled"],
  confirmed:          ["active", "cancelled"],
  active:             ["completed", "cancelled"],
  completed:          ["refund_pending"],
  cancelled:          ["refund_pending"],
  refund_pending:     ["refunded"],
  refunded:           [],
};

function canTransition(from: BookingState, to: BookingState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

function reachableStates(from: BookingState, visited = new Set<BookingState>()): BookingState[] {
  if (visited.has(from)) return [];
  visited.add(from);
  const direct = VALID_TRANSITIONS[from];
  return [from, ...direct.flatMap((s) => reachableStates(s, visited))];
}

function isTerminalState(state: BookingState): boolean {
  return VALID_TRANSITIONS[state].length === 0;
}

function shortestPath(from: BookingState, to: BookingState): BookingState[] | null {
  if (from === to) return [from];
  const queue: BookingState[][] = [[from]];
  const visited = new Set<BookingState>();
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of VALID_TRANSITIONS[current]) {
      const newPath = [...path, next];
      if (next === to) return newPath;
      queue.push(newPath);
    }
  }
  return null;
}

describe("Booking state machine transitions", () => {
  it("canTransition: draft → pending_payment", () => {
    expect(canTransition("draft", "pending_payment")).toBe(true);
  });

  it("canTransition: completed → draft → false", () => {
    expect(canTransition("completed", "draft")).toBe(false);
  });

  it("isTerminalState: refunded → true", () => {
    expect(isTerminalState("refunded")).toBe(true);
  });

  it("isTerminalState: confirmed → false", () => {
    expect(isTerminalState("confirmed")).toBe(false);
  });

  it("shortestPath: draft → completed passes through key states", () => {
    const path = shortestPath("draft", "completed");
    expect(path).not.toBeNull();
    expect(path![0]).toBe("draft");
    expect(path![path!.length - 1]).toBe("completed");
  });

  it("shortestPath: no path from refunded → draft → null", () => {
    expect(shortestPath("refunded", "draft")).toBeNull();
  });
});
