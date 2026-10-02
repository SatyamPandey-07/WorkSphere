import {
  attachJitteredBackoff,
  SessionResyncQueue,
  ConnectionState,
} from "@/lib/partySocketReconnect";

describe("PartyKit Reconnection Queue & State Resynchronization (#3363)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("1. Sequence Handling", () => {
    it("tracks increasing sequence numbers and updates lastSeq monotonically", () => {
      const queue = new SessionResyncQueue();
      expect(queue.lastSeq).toBe(0);

      const event1 = { type: "chat", sequenceId: 1, epoch: 100, messageId: "m1" };
      const res1 = queue.handleLiveEvent(event1);
      expect(res1.shouldApply).toBe(true);
      expect(queue.lastSeq).toBe(1);

      const event2 = { type: "chat", sequenceId: 2, epoch: 100, messageId: "m2" };
      const res2 = queue.handleLiveEvent(event2);
      expect(res2.shouldApply).toBe(true);
      expect(queue.lastSeq).toBe(2);

      expect(queue.lastEpoch).toBe(100);
    });

    it("creates reconnect sync request with the correct lastSeq and epoch", () => {
      const queue = new SessionResyncQueue();
      queue.lastSeq = 42;
      queue.lastEpoch = 12345;

      const syncReqStr = queue.createSyncRequest();
      const syncReq = JSON.parse(syncReqStr);

      expect(syncReq.type).toBe("sync_request");
      expect(syncReq.lastSeq).toBe(42);
      expect(syncReq.epoch).toBe(12345);
    });
  });

  describe("2. Ordered Catch-up Replay", () => {
    it("replays missed events in strict sequence order (11 -> 12 -> 13 -> 14)", () => {
      const queue = new SessionResyncQueue();
      queue.lastSeq = 10;
      queue.lastEpoch = 1;

      // Unordered events from server replay payload
      const missedEvents = [
        { type: "chat", sequenceId: 13, epoch: 1, messageId: "e13", content: "third" },
        { type: "chat", sequenceId: 11, epoch: 1, messageId: "e11", content: "first" },
        { type: "chat", sequenceId: 14, epoch: 1, messageId: "e14", content: "fourth" },
        { type: "chat", sequenceId: 12, epoch: 1, messageId: "e12", content: "second" },
      ];

      const applied = queue.handleSyncReplay(missedEvents);

      expect(applied.map((e) => e.sequenceId)).toEqual([11, 12, 13, 14]);
      expect(applied.map((e) => e.content)).toEqual(["first", "second", "third", "fourth"]);
      expect(queue.lastSeq).toBe(14);
    });
  });

  describe("3. Deduplication", () => {
    it("ignores duplicate replayed events and live events with same messageId", () => {
      const queue = new SessionResyncQueue();
      queue.lastSeq = 5;
      queue.lastEpoch = 1;

      const event1 = { type: "chat", sequenceId: 6, epoch: 1, messageId: "msg-abc", content: "Hello" };
      const res1 = queue.handleLiveEvent(event1);
      expect(res1.shouldApply).toBe(true);
      expect(queue.lastSeq).toBe(6);

      // Same message arrives again
      const res2 = queue.handleLiveEvent(event1);
      expect(res2.shouldApply).toBe(false);

      // Replay also contains the same message
      const replayed = queue.handleSyncReplay([event1]);
      expect(replayed).toHaveLength(0);
    });

    it("drops stale sequence numbers that were already applied", () => {
      const queue = new SessionResyncQueue();
      queue.lastSeq = 20;
      queue.lastEpoch = 1;

      const staleEvent = { type: "chat", sequenceId: 15, epoch: 1, messageId: "m15" };
      const res = queue.handleLiveEvent(staleEvent);
      expect(res.shouldApply).toBe(false);
    });
  });

  describe("4. Client-side Offline Queue", () => {
    it("queues outgoing replayable messages when offline and preserves order", () => {
      const queue = new SessionResyncQueue();

      const msgA = JSON.stringify({ type: "new-message", message: { id: "m-1", text: "A" } });
      const msgB = JSON.stringify({ type: "map-update", update: { lat: 10, lng: 20 } });
      const ephemeralCursor = JSON.stringify({ type: "cursor", x: 100, y: 200 });

      expect(queue.enqueue(msgA)).toBe(true);
      expect(queue.enqueue(ephemeralCursor)).toBe(false); // Ephemeral should be skipped
      expect(queue.enqueue(msgB)).toBe(true);

      expect(queue.getOfflineActions()).toEqual([msgA, msgB]);

      const sent: any[] = [];
      const flushResult = queue.flush((data) => sent.push(data));

      expect(flushResult.actionsCount).toBe(2);
      expect(sent).toEqual([msgA, msgB]);
      expect(queue.getOfflineActions()).toHaveLength(0);
    });

    it("does not flush queue twice if reconnect triggers multiple times", () => {
      const queue = new SessionResyncQueue();
      queue.enqueue("msg-1");
      queue.enqueue("msg-2");

      const sent: any[] = [];
      queue.flush((data) => sent.push(data));
      expect(sent).toHaveLength(2);

      // Subsequent flush call
      queue.flush((data) => sent.push(data));
      expect(sent).toHaveLength(2); // Still 2, not 4
    });
  });

  describe("5. Race Conditions (Replay vs Live Events)", () => {
    it("buffers live events arriving during catch-up and applies them in order after replay", () => {
      const queue = new SessionResyncQueue();
      queue.lastSeq = 100;
      queue.lastEpoch = 1;

      // Socket is reconnecting, enters catch-up mode
      queue.isCatchingUp = true;

      // Server emits live event 104 while replay is on the wire
      const liveEvent104 = { type: "chat", sequenceId: 104, epoch: 1, messageId: "m104", text: "live" };
      const liveResult = queue.handleLiveEvent(liveEvent104);
      expect(liveResult.shouldApply).toBe(false); // Stashed in pendingLiveEvents!

      // Replay arrives with missed events 101, 102, 103
      const replayPayload = [
        { type: "chat", sequenceId: 101, epoch: 1, messageId: "m101", text: "event 101" },
        { type: "chat", sequenceId: 102, epoch: 1, messageId: "m102", text: "event 102" },
        { type: "chat", sequenceId: 103, epoch: 1, messageId: "m103", text: "event 103" },
      ];

      const applied = queue.handleSyncReplay(replayPayload);

      // The returned list should contain 101, 102, 103 AND automatically drain 104!
      expect(applied.map((e) => e.sequenceId)).toEqual([101, 102, 103, 104]);
      expect(queue.lastSeq).toBe(104);
    });
  });

  describe("6. Socket Integration & 5-Second Disconnect Acceptance Test", () => {
    it("simulates a 5-second disconnect and reconnect: resumes session seamlessly with all missed events replayed in order", () => {
      const eventListeners: Record<string, Array<(...args: any[]) => void>> = {};
      const mockSend = jest.fn();

      const socket = {
        _retryCount: 0,
        _getNextDelay: () => 10,
        send: mockSend,
        addEventListener: (event: string, cb: (...args: any[]) => void) => {
          if (!eventListeners[event]) eventListeners[event] = [];
          eventListeners[event].push(cb);
        },
      } as any;

      attachJitteredBackoff(socket);

      const receivedMessages: any[] = [];
      socket.addEventListener("message", (event: any) => {
        receivedMessages.push(JSON.parse(event.data));
      });

      // 1. Client connects initially
      eventListeners["open"]?.forEach((cb) => cb());
      expect(socket.__worksphereState).toBe(ConnectionState.CONNECTED);

      // 2. Client receives events through sequence N=10
      for (let i = 1; i <= 10; i++) {
        eventListeners["message"]?.forEach((cb) =>
          cb({
            data: JSON.stringify({
              type: "new-message",
              sequenceId: i,
              epoch: 1000,
              messageId: `msg-${i}`,
              text: `Message ${i}`,
            }),
          }),
        );
      }
      expect(receivedMessages).toHaveLength(10);
      expect(socket.__worksphereResyncQueue.lastSeq).toBe(10);

      // 3. Connection is interrupted for 5 seconds (5000ms)
      eventListeners["close"]?.forEach((cb) => cb({ code: 1006, reason: "Network timeout" }));
      expect(socket.__worksphereState).toBe(ConnectionState.CLOSED);

      // Client queues a message while disconnected
      const queuedMessage = JSON.stringify({
        type: "new-message",
        messageId: "client-queued-1",
        message: { id: "client-queued-1", text: "Offline chat" },
      });
      socket.send(queuedMessage);
      expect(mockSend).not.toHaveBeenCalled(); // buffered, not sent yet

      // Advance time by 5 seconds
      jest.advanceTimersByTime(5000);

      // 4. Server in background generated events 11, 12, 13
      // 5. Client reconnects
      eventListeners["open"]?.forEach((cb) => cb());
      expect(socket.__worksphereState).toBe(ConnectionState.CONNECTED);

      // Client automatically sends sync_request with lastSeq=10
      expect(mockSend).toHaveBeenCalledWith(
        JSON.stringify({
          type: "sync_request",
          lastSeq: 10,
          epoch: 1000,
        }),
      );

      // 6. Server responds with sync_replay containing 11, 12, 13
      const missedEvents = [
        { type: "new-message", sequenceId: 11, epoch: 1000, messageId: "msg-11", text: "Missed 11" },
        { type: "new-message", sequenceId: 12, epoch: 1000, messageId: "msg-12", text: "Missed 12" },
        { type: "new-message", sequenceId: 13, epoch: 1000, messageId: "msg-13", text: "Missed 13" },
      ];

      eventListeners["message"]?.forEach((cb) =>
        cb({
          data: JSON.stringify({
            type: "sync_replay",
            epoch: 1000,
            fromSeq: 11,
            toSeq: 13,
            events: missedEvents,
          }),
        }),
      );

      // 7. Client applies all missed events in exact order
      expect(receivedMessages).toHaveLength(13);
      expect(receivedMessages[10].sequenceId).toBe(11);
      expect(receivedMessages[11].sequenceId).toBe(12);
      expect(receivedMessages[12].sequenceId).toBe(13);
      expect(socket.__worksphereResyncQueue.lastSeq).toBe(13);

      // 8. Offline queue was flushed right after replay!
      expect(mockSend).toHaveBeenCalledWith(queuedMessage);

      // 9. Live event 14 arrives
      eventListeners["message"]?.forEach((cb) =>
        cb({
          data: JSON.stringify({
            type: "new-message",
            sequenceId: 14,
            epoch: 1000,
            messageId: "msg-14",
            text: "Live 14",
          }),
        }),
      );
      expect(receivedMessages).toHaveLength(14);
      expect(receivedMessages[13].sequenceId).toBe(14);
      expect(socket.__worksphereResyncQueue.lastSeq).toBe(14);
    });
  });
});
