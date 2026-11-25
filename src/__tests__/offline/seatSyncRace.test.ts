import {
  SeatSyncCoordinator,
  seatSyncCoordinator,
} from "@/lib/offline/SeatSyncCoordinator";
import { SyncQueueManager } from "@/lib/offline";
import {
  PartykitRoomManager,
  type WebSocketLike,
  type VenueRoomEvent,
} from "@/lib/realtime/partykitRoomManager";

describe("Offline Sync Queue Flush & WebSocket Race Condition (#7854)", () => {
  beforeEach(() => {
    SeatSyncCoordinator.resetInstance();
    SyncQueueManager.resetInstance();
  });

  afterEach(() => {
    SeatSyncCoordinator.resetInstance();
    SyncQueueManager.resetInstance();
  });

  it("1 & 2 & 3 & 4 & 5: offline check-in draft is queued, flush starts, stale WS frame arrives while HTTP pending, optimistic state preserved, HTTP success reconciles", async () => {
    const venueId = "venue-alpha";
    const seatId = "seat-101";

    // 1. Offline check-in draft is queued
    let resolveHttp: (val: boolean) => void;
    const httpPromise = new Promise<boolean>((resolve) => {
      resolveHttp = resolve;
    });

    const syncQueue = new SyncQueueManager();
    syncQueue.registerHandler("checkin", async (_item) => {
      // In-flight HTTP POST
      return await httpPromise;
    });

    await syncQueue.enqueue({
      entity: "checkin",
      action: "create",
      payload: { venueId, seatId },
    });

    expect(await syncQueue.getPendingCount("checkin")).toBe(1);

    // 2. Queue flush starts for Desk A (seatId)
    const flushPromise = syncQueue.processQueue("checkin");

    // Allow processQueue to start syncItem and set inFlightReconciliation
    await new Promise((r) => setTimeout(r, 10));

    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatId)).toBe(
      true,
    );

    // 3. Stale WebSocket frame arrives while HTTP request is pending
    // Stale snapshot has epoch 0 or older sequence
    const staleSnapshotAcceptable = seatSyncCoordinator.shouldAcceptUpdate(
      venueId,
      seatId,
      0,
      0,
    );
    expect(staleSnapshotAcceptable).toBe(false);

    // 4. Optimistic check-in state remains protected
    const stalePacketAccepted = seatSyncCoordinator.acceptUpdate(
      venueId,
      seatId,
      0,
      0,
    );
    expect(stalePacketAccepted).toBe(false);

    // 5. HTTP success reconciles the state without reverting it
    resolveHttp!(true);
    const flushResult = await flushPromise;
    expect(flushResult.succeeded).toBe(1);
    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatId)).toBe(
      false,
    );
  });

  it("6 & 7: newer WebSocket frame is accepted after reconciliation; older arriving later is rejected", async () => {
    const venueId = "venue-alpha";
    const seatId = "seat-102";

    // Set server version baseline to epoch 1, sequence 10
    seatSyncCoordinator.recordServerVersion(venueId, seatId, 1, 10);

    // 7. Older frame arriving later (epoch 1, seq 9) is rejected
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 1, 9)).toBe(
      false,
    );
    expect(seatSyncCoordinator.acceptUpdate(venueId, seatId, 1, 9)).toBe(false);

    // Also older epoch (epoch 0, seq 20) is rejected
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 0, 20)).toBe(
      false,
    );

    // 6. Newer frame (epoch 1, seq 11) is accepted
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 1, 11)).toBe(
      true,
    );
    expect(seatSyncCoordinator.acceptUpdate(venueId, seatId, 1, 11)).toBe(true);

    // Current version updated to 11
    expect(seatSyncCoordinator.getVersion(venueId, seatId)?.sequenceId).toBe(
      11,
    );
  });

  it("8: two different seats can reconcile independently without blocking each other", async () => {
    const venueId = "venue-beta";
    const seatA = "desk-1";
    const seatB = "desk-2";

    let releaseA: () => void;
    const waitA = new Promise<void>((r) => (releaseA = r));

    let seatAStarted = false;
    let seatBFinished = false;

    // Start long-running reconciliation on seatA
    const pA = seatSyncCoordinator.runWithSeatLock(venueId, seatA, async () => {
      seatAStarted = true;
      seatSyncCoordinator.markReconciliationStart(venueId, seatA);
      await waitA;
      seatSyncCoordinator.markReconciliationEnd(venueId, seatA);
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(seatAStarted).toBe(true);
    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatA)).toBe(
      true,
    );
    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatB)).toBe(
      false,
    );

    // seatB should be able to acquire lock and run immediately without waiting for seatA
    const pB = seatSyncCoordinator.runWithSeatLock(venueId, seatB, async () => {
      seatSyncCoordinator.markReconciliationStart(venueId, seatB);
      seatSyncCoordinator.recordServerVersion(venueId, seatB, 1, 5);
      seatSyncCoordinator.markReconciliationEnd(venueId, seatB);
      seatBFinished = true;
    });

    await pB;
    expect(seatBFinished).toBe(true);
    expect(seatSyncCoordinator.getVersion(venueId, seatB)?.sequenceId).toBe(5);

    // Clean up seatA
    releaseA!();
    await pA;
    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatA)).toBe(
      false,
    );
  });

  it("9: multiple updates for the same seat are correctly serialized", async () => {
    const venueId = "venue-gamma";
    const seatId = "desk-99";

    const order: number[] = [];

    const op1 = seatSyncCoordinator.runWithSeatLock(
      venueId,
      seatId,
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      },
    );

    const op2 = seatSyncCoordinator.runWithSeatLock(
      venueId,
      seatId,
      async () => {
        order.push(2);
      },
    );

    const op3 = seatSyncCoordinator.runWithSeatLock(
      venueId,
      seatId,
      async () => {
        order.push(3);
      },
    );

    await Promise.all([op1, op2, op3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("10: HTTP failure preserves recoverable queued state and releases reconciliation lock", async () => {
    const venueId = "venue-delta";
    const seatId = "seat-fail";

    const syncQueue = new SyncQueueManager({ maxRetries: 3 });
    syncQueue.registerHandler("checkin", async () => {
      throw new Error("503 Service Unavailable");
    });

    await syncQueue.enqueue({
      entity: "checkin",
      action: "create",
      payload: { venueId, seatId },
    });

    const result = await syncQueue.processQueue("checkin");
    expect(result.failed).toBe(1);

    // Reconciliation lock is released on error
    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatId)).toBe(
      false,
    );

    // Queue item is preserved with incremented retry count
    const pending = await syncQueue.getQueue("checkin");
    expect(pending.length).toBe(1);
    expect(pending[0].retryCount).toBe(1);
  });

  it("11: duplicate WebSocket frames do not cause duplicate state transitions", async () => {
    const venueId = "venue-epsilon";
    const seatId = "seat-dup";

    // First arrival
    expect(seatSyncCoordinator.acceptUpdate(venueId, seatId, 1, 15)).toBe(true);

    // Duplicate frame with exact same epoch & sequenceId is rejected
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 1, 15)).toBe(
      false,
    );
    expect(seatSyncCoordinator.acceptUpdate(venueId, seatId, 1, 15)).toBe(
      false,
    );
  });

  it("12: reconnection does not reintroduce stale state into PartykitRoomManager", async () => {
    const sentMessages: string[] = [];
    const mockSocket: WebSocketLike = {
      send: (data: string) => sentMessages.push(data),
      close: () => {},
      readyState: 1,
      onopen: null,
      onclose: null,
      onmessage: null,
      onerror: null,
    };

    const room = "venue-room-1";
    const seatId = "desk-1";

    const manager = new PartykitRoomManager({
      room,
      socketFactory: () => mockSocket,
    });

    (manager as any).socket = mockSocket;
    (manager as any).state = "connected";

    // 1. Initial state at sequence 20
    (manager as any).handleIncomingMessage({
      type: "seat_snapshot",
      epoch: 1,
      sequenceId: 20,
      seats: [
        {
          seatId,
          userId: "user-1",
          status: "OCCUPIED",
          timestamp: 1000,
          sequenceId: 20,
        },
      ],
    });

    expect((manager as any).seats.get(seatId)?.status).toBe("OCCUPIED");

    // 2. Offline checkin flush baseline was sequence 25
    seatSyncCoordinator.recordServerVersion(room, seatId, 1, 25);

    // 3. Reconnect receives a stale replay with sequence 22 (older than 25)
    const staleReplayEvent: VenueRoomEvent = {
      type: "seat_checkin",
      epoch: 1,
      sequenceId: 22,
      timestamp: 2000,
      seat: {
        seatId,
        userId: "user-stale",
        status: "AVAILABLE",
        timestamp: 2000,
        sequenceId: 22,
      },
    };

    (manager as any).handleIncomingMessage({
      type: "sync_replay",
      events: [staleReplayEvent],
      toSeq: 22,
    });

    // Stale replay event was rejected by seatSyncCoordinator
    expect((manager as any).seats.get(seatId)?.status).toBe("OCCUPIED");
    expect((manager as any).seats.get(seatId)?.userId).toBe("user-1");

    // 4. Fresh event with sequence 30 arrives and is accepted
    const freshReplayEvent: VenueRoomEvent = {
      type: "seat_checkin",
      epoch: 1,
      sequenceId: 30,
      timestamp: 3000,
      seat: {
        seatId,
        userId: "user-fresh",
        status: "HELD",
        timestamp: 3000,
        sequenceId: 30,
      },
    };

    (manager as any).handleIncomingMessage({
      type: "seat_update",
      event: freshReplayEvent,
    });

    expect((manager as any).seats.get(seatId)?.status).toBe("HELD");
    expect((manager as any).seats.get(seatId)?.userId).toBe("user-fresh");
  });

  it("13 & 14: lock release occurs after success/failure, and fallback works when Web Locks are unavailable", async () => {
    // Test fallback when navigator.locks is absent
    const originalNavigatorLocks = (globalThis as any).navigator?.locks;
    try {
      if ((globalThis as any).navigator) {
        delete (globalThis as any).navigator.locks;
      }

      const venueId = "venue-fallback";
      const seatId = "seat-fallback-1";

      let ran = false;
      const res = await seatSyncCoordinator.runWithSeatLock(
        venueId,
        seatId,
        async () => {
          ran = true;
          return "success";
        },
      );

      expect(ran).toBe(true);
      expect(res).toBe("success");

      // Test lock release on exception in fallback environment
      let caught = false;
      try {
        await seatSyncCoordinator.runWithSeatLock(venueId, seatId, async () => {
          throw new Error("boom");
        });
      } catch (err: any) {
        caught = true;
        expect(err.message).toBe("boom");
      }
      expect(caught).toBe(true);

      // Verify next operation can still acquire the lock after failure
      let nextRan = false;
      await seatSyncCoordinator.runWithSeatLock(venueId, seatId, async () => {
        nextRan = true;
      });
      expect(nextRan).toBe(true);
    } finally {
      if (originalNavigatorLocks && (globalThis as any).navigator) {
        (globalThis as any).navigator.locks = originalNavigatorLocks;
      }
    }
  });

  it("15: legitimate WebSocket frames arriving during or after HTTP reconciliation are not permanently discarded", async () => {
    const venueId = "venue-sequence-safety";
    const seatId = "desk-42";

    // Baseline server sequence is 10 at epoch 1
    seatSyncCoordinator.recordServerVersion(venueId, seatId, 1, 10);

    // 1. Reconciliation starts for this seat
    seatSyncCoordinator.markReconciliationStart(venueId, seatId);
    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatId)).toBe(
      true,
    );

    // 2. A stale frame (sequence 10, or sequence 9) arriving during reconciliation is rejected
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 1, 9)).toBe(
      false,
    );
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 1, 10)).toBe(
      false,
    );

    // 3. A newer legitimate frame (sequence 11) from the server arriving during reconciliation IS accepted
    // (e.g. server acknowledged checkin or an admin event occurred with sequence 11)
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 1, 11)).toBe(
      true,
    );
    expect(seatSyncCoordinator.acceptUpdate(venueId, seatId, 1, 11)).toBe(true);

    // 4. Server restarts and issues a new epoch with sequence reset to 1 -> MUST be accepted
    expect(seatSyncCoordinator.shouldAcceptUpdate(venueId, seatId, 2, 1)).toBe(
      true,
    );
    expect(seatSyncCoordinator.acceptUpdate(venueId, seatId, 2, 1)).toBe(true);
    expect(seatSyncCoordinator.getVersion(venueId, seatId)?.epoch).toBe(2);
    expect(seatSyncCoordinator.getVersion(venueId, seatId)?.sequenceId).toBe(1);

    // 5. Reconciliation finishes cleanly
    seatSyncCoordinator.markReconciliationEnd(venueId, seatId);
    expect(seatSyncCoordinator.isReconciliationInFlight(venueId, seatId)).toBe(
      false,
    );
  });
});
