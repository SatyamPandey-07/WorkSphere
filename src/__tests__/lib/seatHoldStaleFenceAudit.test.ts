import {
  acquireSeatWebLock,
  extendSeatHold,
  onSeatHoldAuditEvent,
  getSeatHoldAuditEvents,
  clearSeatHoldAuditEvents,
  resetMemorySeatLocks,
  type StaleFenceTokenAuditEvent,
} from "@/lib/locks/seatHoldLock";

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn().mockReturnValue(null),
}));

describe("extendSeatHold stale fence token audit event (#10607)", () => {
  const VENUE_ID = "venue-test-101";
  const SEAT_ID = "seat-42";
  const USER_ID = "user-alice";

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-26T12:00:00.000Z"));
    resetMemorySeatLocks();
    clearSeatHoldAuditEvents();
  });

  afterEach(() => {
    clearSeatHoldAuditEvents();
    resetMemorySeatLocks();
    jest.useRealTimers();
  });

  it("emits a structured audit event containing seatId, expectedFenceToken, and receivedFenceToken when a non-monotonic fence token is rejected", async () => {
    // 1. Acquire initial seat hold lock with valid lease
    const acquireResult = await acquireSeatWebLock(
      VENUE_ID,
      SEAT_ID,
      USER_ID,
      "Alice",
      300,
    );
    expect(acquireResult.success).toBe(true);
    expect(acquireResult.lock?.fencingToken).toBeDefined();

    const expectedToken = acquireResult.lock!.fencingToken!;
    // Present a non-monotonic (stale / smaller or equal) token
    const staleReceivedToken = (Number(expectedToken) - 1).toString();

    // 2. Register audit listener
    const emittedEvents: StaleFenceTokenAuditEvent[] = [];
    const unsubscribe = onSeatHoldAuditEvent((event) => {
      emittedEvents.push(event);
    });

    // 3. Attempt to extend lease with stale token
    const extendResult = await extendSeatHold(
      VENUE_ID,
      SEAT_ID,
      USER_ID,
      staleReceivedToken,
    );

    unsubscribe();

    // 4. Verify extension rejection
    expect(extendResult.success).toBe(false);
    expect(extendResult.reason).toBe("STALE_TOKEN");

    // 5. Verify structured audit event emission and required fields
    expect(emittedEvents).toHaveLength(1);
    const auditEvent = emittedEvents[0];

    expect(auditEvent.eventType).toBe("STALE_FENCE_TOKEN_REJECTED");
    expect(auditEvent.seatId).toBe(SEAT_ID);
    expect(auditEvent.expectedFenceToken).toBe(expectedToken);
    expect(auditEvent.receivedFenceToken).toBe(staleReceivedToken);
    expect(auditEvent.reason).toBe("STALE_TOKEN");
    expect(auditEvent.timestamp).toBeDefined();

    // Also check via buffer accessor
    const bufferedEvents = getSeatHoldAuditEvents();
    expect(bufferedEvents).toHaveLength(1);
    expect(bufferedEvents[0].seatId).toBe(SEAT_ID);
    expect(bufferedEvents[0].expectedFenceToken).toBe(expectedToken);
    expect(bufferedEvents[0].receivedFenceToken).toBe(staleReceivedToken);
  });
});
