/**
 * Tests for offline mutation sync queue (IndexedDB-backed).
 */

type MutationType = "create" | "update" | "delete";

interface SyncMutation {
  id: string;
  type: MutationType;
  entityType: string;
  payload: unknown;
  createdAt: number;
  retryCount: number;
}

function enqueueMutation(
  queue: SyncMutation[],
  mutation: SyncMutation
): SyncMutation[] {
  return [...queue, mutation];
}

function dequeueMutation(queue: SyncMutation[]): {
  next: SyncMutation | null;
  remaining: SyncMutation[];
} {
  if (queue.length === 0) return { next: null, remaining: [] };
  return { next: queue[0], remaining: queue.slice(1) };
}

function incrementRetry(mutation: SyncMutation): SyncMutation {
  return { ...mutation, retryCount: mutation.retryCount + 1 };
}

function dropExhausted(queue: SyncMutation[], maxRetries = 3): SyncMutation[] {
  return queue.filter((m) => m.retryCount < maxRetries);
}

function queueByEntityType(queue: SyncMutation[], entityType: string): SyncMutation[] {
  return queue.filter((m) => m.entityType === entityType);
}

const BASE = 1_700_000_000_000;
const M1: SyncMutation = { id: "m1", type: "create", entityType: "booking",  payload: {}, createdAt: BASE,       retryCount: 0 };
const M2: SyncMutation = { id: "m2", type: "update", entityType: "bookmark", payload: {}, createdAt: BASE + 100, retryCount: 3 };

describe("Offline sync queue", () => {
  it("enqueue adds to end", () => {
    const q = enqueueMutation([M1], M2);
    expect(q[1].id).toBe("m2");
  });

  it("dequeue removes first item", () => {
    const { next, remaining } = dequeueMutation([M1, M2]);
    expect(next!.id).toBe("m1");
    expect(remaining).toHaveLength(1);
  });

  it("dequeue empty queue → null", () => {
    expect(dequeueMutation([]).next).toBeNull();
  });

  it("incrementRetry increases retryCount", () => {
    expect(incrementRetry(M1).retryCount).toBe(1);
  });

  it("incrementRetry does not mutate original", () => {
    incrementRetry(M1);
    expect(M1.retryCount).toBe(0);
  });

  it("dropExhausted removes items with maxRetries reached", () => {
    const filtered = dropExhausted([M1, M2]);
    expect(filtered.map((m) => m.id)).toEqual(["m1"]);
  });

  it("queueByEntityType filters correctly", () => {
    const bookings = queueByEntityType([M1, M2], "booking");
    expect(bookings).toHaveLength(1);
    expect(bookings[0].id).toBe("m1");
  });

  it("queueByEntityType unknown type → empty", () => {
    expect(queueByEntityType([M1, M2], "review")).toHaveLength(0);
  });
});
