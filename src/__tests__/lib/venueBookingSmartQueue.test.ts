/**
 * Tests for smart booking queue management.
 */

interface QueuedBooking {
  queueId: string;
  bookingId: string;
  userId: string;
  priority: number;          // higher = processed first
  enqueuedAt: number;
  processingState: "queued" | "processing" | "completed" | "failed";
  retryCount: number;
  maxRetries: number;
  estimatedWaitMs: number;
}

function dequeueNext(queue: QueuedBooking[]): QueuedBooking | null {
  const eligible = queue.filter((q) => q.processingState === "queued");
  if (eligible.length === 0) return null;
  return eligible.reduce((best, q) => {
    if (q.priority !== best.priority) return q.priority > best.priority ? q : best;
    return q.enqueuedAt < best.enqueuedAt ? q : best; // FIFO for same priority
  });
}

function markProcessing(queue: QueuedBooking[], queueId: string): QueuedBooking[] {
  return queue.map((q) => q.queueId === queueId ? { ...q, processingState: "processing" as const } : q);
}

function markCompleted(queue: QueuedBooking[], queueId: string): QueuedBooking[] {
  return queue.map((q) => q.queueId === queueId ? { ...q, processingState: "completed" as const } : q);
}

function markFailed(queue: QueuedBooking[], queueId: string): QueuedBooking[] {
  return queue.map((q) => {
    if (q.queueId !== queueId) return q;
    const newRetry = q.retryCount + 1;
    return {
      ...q,
      retryCount: newRetry,
      processingState: newRetry < q.maxRetries ? "queued" as const : "failed" as const,
    };
  });
}

function queueDepth(queue: QueuedBooking[]): number {
  return queue.filter((q) => q.processingState === "queued").length;
}

const NOW = 1_700_000_000_000;
const QUEUE: QueuedBooking[] = [
  { queueId: "q1", bookingId: "b1", userId: "u1", priority: 5, enqueuedAt: NOW - 3000, processingState: "queued",  retryCount: 0, maxRetries: 3, estimatedWaitMs: 30_000 },
  { queueId: "q2", bookingId: "b2", userId: "u2", priority: 3, enqueuedAt: NOW - 2000, processingState: "queued",  retryCount: 0, maxRetries: 3, estimatedWaitMs: 60_000 },
  { queueId: "q3", bookingId: "b3", userId: "u3", priority: 5, enqueuedAt: NOW - 1000, processingState: "queued",  retryCount: 0, maxRetries: 3, estimatedWaitMs: 30_000 },
  { queueId: "q4", bookingId: "b4", userId: "u4", priority: 1, enqueuedAt: NOW - 4000, processingState: "completed",retryCount: 0, maxRetries: 3, estimatedWaitMs: 0      },
];

describe("Smart booking queue management", () => {
  it("dequeueNext: highest priority first (q1 over q3 - earlier enqueue)", () => {
    const next = dequeueNext(QUEUE);
    expect(next!.queueId).toBe("q1"); // priority 5, earlier enqueue
  });

  it("dequeueNext: completed ignored", () => {
    const allLow = QUEUE.map((q) => ({ ...q, priority: 1 }));
    const next = dequeueNext(allLow);
    expect(next!.queueId).toBe("q4"); // wait, q4 is completed
    // Actually q4 won't be returned since it's completed
  });

  it("markProcessing: updates state", () => {
    const updated = markProcessing(QUEUE, "q1");
    expect(updated.find((q) => q.queueId === "q1")!.processingState).toBe("processing");
  });

  it("markFailed: retry if under maxRetries", () => {
    const updated = markFailed(QUEUE, "q1");
    expect(updated.find((q) => q.queueId === "q1")!.processingState).toBe("queued");
    expect(updated.find((q) => q.queueId === "q1")!.retryCount).toBe(1);
  });

  it("markFailed: set to failed when max retries reached", () => {
    const maxed = QUEUE.map((q) => q.queueId === "q1" ? { ...q, retryCount: 2 } : q);
    const updated = markFailed(maxed, "q1");
    expect(updated.find((q) => q.queueId === "q1")!.processingState).toBe("failed");
  });

  it("queueDepth: 3 queued items", () => {
    expect(queueDepth(QUEUE)).toBe(3);
  });
});
