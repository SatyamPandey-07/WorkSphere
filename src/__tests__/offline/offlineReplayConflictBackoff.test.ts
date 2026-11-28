import { DtnBundleInbox } from "@/network/dtnBundleInbox";
import { SyncQueue } from "@/worker/bookingSync/SyncQueue";

describe("Offline Sync Idempotency, Conflict Resolution, and Backoff", () => {
  it("assembles out-of-order DTN fragments once and ignores duplicate replays within TTL", () => {
    let now = 1_000;
    const inbox = new DtnBundleInbox({ defaultTtlMs: 10_000, nowFn: () => now });
    const part1 = new TextEncoder().encode("world");
    const part0 = new TextEncoder().encode("hello ");

    expect(
      inbox.ingestFragment({ bundleId: "b-1", fragmentIndex: 1, totalFragments: 2, payload: part1 }),
    ).toBeNull();
    const assembled = inbox.ingestFragment({
      bundleId: "b-1",
      fragmentIndex: 0,
      totalFragments: 2,
      payload: part0,
    });
    expect(assembled).not.toBeNull();
    expect(new TextDecoder().decode(assembled!.payload)).toBe("hello world");
    expect(inbox.hasCompletedBundle("b-1")).toBe(true);

    // Replaying any fragment of b-1 must be ignored idempotently
    expect(
      inbox.ingestFragment({ bundleId: "b-1", fragmentIndex: 0, totalFragments: 2, payload: part0 }),
    ).toBeNull();
    expect(inbox.getPendingCount()).toBe(0);
  });

  it("surfaces conflict status and transitions repeated failures to dead_letter with backoff", async () => {
    const queue = new SyncQueue("test-node", 2);
    const store = queue.getDraftStore();

    await store.saveDraft({
      id: "booking-123",
      venueId: "v-1",
      userId: "u-1",
      payload: { seatId: "A2" },
      timestamp: Date.now(),
      vectorClock: { "test-node": 1 },
    });

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "booking-123",
        version: 2,
        payload: { seatId: "B9" },
        vectorClock: { "server-node": 1 },
      }),
    }) as unknown as typeof fetch;

    await queue.processQueue();
    expect(queue.getRetryMetadata("booking-123")?.status).toBe("conflict");

    // Failing draft transitions to retry with backoff then dead_letter
    await store.saveDraft({
      id: "booking-fail",
      venueId: "v-1",
      userId: "u-1",
      payload: { seatId: "C1" },
      timestamp: Date.now(),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch;

    await queue.processQueue();
    const firstRetry = queue.getRetryMetadata("booking-fail");
    expect(firstRetry?.status).toBe("retry");
    expect(firstRetry?.attempts).toBe(1);

    // Force backoff elapsed to trigger second attempt -> dead_letter
    firstRetry!.nextAttemptAtMs = 0;
    await queue.processQueue();
    expect(queue.getRetryMetadata("booking-fail")?.status).toBe("dead_letter");
    expect(queue.getDeadLetterDrafts()).toHaveLength(1);

    global.fetch = originalFetch;
  });
});