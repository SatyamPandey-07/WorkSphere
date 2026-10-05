/**
 * Regression tests: the in-order resync layer must never stall on a sequence gap.
 *
 * SessionResyncQueue used to buffer every event whose sequenceId was not exactly
 * lastSeq + 1 and had no way to ever fill the gap. A client that joined a room
 * after the first event (lastSeq = 0), a sender that was excluded from the
 * broadcast of its own message, or any hole in the numbering therefore froze the
 * live stream for good.
 */
import {
  attachJitteredBackoff,
  ConnectionState,
  SessionResyncQueue,
} from "@/lib/partySocketReconnect";

const ev = (sequenceId: number, extra: Record<string, unknown> = {}) => ({
  type: "chat",
  sequenceId,
  epoch: 1,
  messageId: `m${sequenceId}`,
  ...extra,
});

describe("SessionResyncQueue: baseline", () => {
  it("adopts the first event it sees as its baseline instead of waiting for earlier numbers", () => {
    const queue = new SessionResyncQueue();

    // Joined a room whose server is already at sequence 57.
    const first = queue.handleLiveEvent(ev(57, { epoch: 900 }));
    expect(first.shouldApply).toBe(true);
    expect(queue.lastSeq).toBe(57);
    expect(queue.lastEpoch).toBe(900);

    expect(queue.handleLiveEvent(ev(58, { epoch: 900 })).shouldApply).toBe(true);
    expect(queue.lastSeq).toBe(58);
  });

  it("adopts a new baseline when the server restarts with a newer epoch", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 50;
    queue.lastEpoch = 100;

    // Restarted server: new epoch, numbering starts over (and we may miss #1..#2).
    const res = queue.handleLiveEvent(ev(3, { epoch: 200 }));
    expect(res.shouldApply).toBe(true);
    expect(queue.lastEpoch).toBe(200);
    expect(queue.lastSeq).toBe(3);
  });

  it("drops stragglers from an older server epoch", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 5;
    queue.lastEpoch = 200;

    const res = queue.handleLiveEvent(ev(6, { epoch: 100 }));
    expect(res.shouldApply).toBe(false);
    expect(queue.lastSeq).toBe(5);
    expect(queue.lastEpoch).toBe(200);
  });

  it("does not throw away buffered events that belong to the current epoch", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 5;
    queue.lastEpoch = 1;
    queue.handleLiveEvent(ev(7)); // gap, buffered
    queue.handleLiveEvent(ev(6)); // fills it
    expect(queue.drainPendingLiveEvents().map((e) => e.sequenceId)).toEqual([7]);
  });
});

describe("SessionResyncQueue: gap recovery", () => {
  it("buffers a gapped event and asks for a sync exactly once", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 5;
    queue.lastEpoch = 1;

    const first = queue.handleLiveEvent(ev(8));
    expect(first.shouldApply).toBe(false);
    expect(first.needsSync).toBe(true);

    // Same gap, request already in flight: do not flood the server.
    const second = queue.handleLiveEvent(ev(9));
    expect(second.shouldApply).toBe(false);
    expect(second.needsSync).toBe(false);
  });

  it("does not ask for a sync while a replay is already being applied", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 100;
    queue.lastEpoch = 1;
    queue.isCatchingUp = true;

    const res = queue.handleLiveEvent(ev(104));
    expect(res.shouldApply).toBe(false);
    expect(res.needsSync).toBeFalsy();
  });

  it("re-requests after the retry window if the server never answered", () => {
    jest.useFakeTimers();
    try {
      const queue = new SessionResyncQueue();
      queue.lastSeq = 5;
      queue.lastEpoch = 1;

      expect(queue.handleLiveEvent(ev(8)).needsSync).toBe(true);
      expect(queue.handleLiveEvent(ev(9)).needsSync).toBe(false);

      jest.setSystemTime(Date.now() + 6_000);
      expect(queue.handleLiveEvent(ev(10)).needsSync).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("advances to toSeq after a replay so a trailing hole cannot block buffered live events", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 5;
    queue.lastEpoch = 1;

    queue.handleLiveEvent(ev(9)); // buffered behind a gap

    // Server replays #6 only; #7 and #8 were never part of the shared stream.
    const applied = queue.handleSyncReplay([ev(6)], 8, 1);

    expect(applied.map((e) => e.sequenceId)).toEqual([6, 9]);
    expect(queue.lastSeq).toBe(9);
  });

  it("settles to the server's position on sync_ack and releases buffered events", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 5;
    queue.lastEpoch = 1;
    queue.handleLiveEvent(ev(9));

    const drained = queue.settle(8, 1);
    expect(drained.map((e) => e.sequenceId)).toEqual([9]);
    expect(queue.lastSeq).toBe(9);
  });

  it("keeps advancing when a buffered event turns out to be a duplicate", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 5;
    queue.lastEpoch = 1;

    queue.handleLiveEvent(ev(7)); // buffered
    queue.handleLiveEvent(ev(8)); // buffered
    queue.markProcessed("m7"); // #7 was delivered another way (e.g. a replay)

    const applied = queue.handleSyncReplay([ev(6)], 6, 1);

    // Skipping the duplicate #7 must still consume its slot, otherwise #8 is stuck.
    expect(applied.map((e) => e.sequenceId)).toEqual([6, 8]);
    expect(queue.lastSeq).toBe(8);
  });
});

describe("SessionResyncQueue: msg_ack for the sender's own events", () => {
  const ack = (sequenceId: number, extra: Record<string, unknown> = {}) => ({
    type: "msg_ack",
    messageId: `own-${sequenceId}`,
    status: "processed",
    sequenceId,
    epoch: 1,
    ...extra,
  });

  it("advances the position to the slot the server assigned to our own message", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 4;
    queue.lastEpoch = 1;

    const res = queue.handleAck(ack(5));
    expect(queue.lastSeq).toBe(5);
    expect(res.needsSync).toBe(false);

    // The next event from someone else is now contiguous and applies directly.
    expect(queue.handleLiveEvent(ev(6)).shouldApply).toBe(true);
  });

  it("remembers our own message id so a replay never echoes it back to us", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 4;
    queue.lastEpoch = 1;
    queue.handleAck(ack(5));

    const applied = queue.handleSyncReplay([ev(5, { messageId: "own-5" })]);
    expect(applied).toEqual([]);
  });

  it("steps over an acked slot that arrives ahead of the events before it", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 3;
    queue.lastEpoch = 1;

    const early = queue.handleAck(ack(5));
    expect(early.needsSync).toBe(true); // we are missing #4
    expect(queue.lastSeq).toBe(3);

    expect(queue.handleLiveEvent(ev(4)).shouldApply).toBe(true);
    queue.drainPendingLiveEvents();
    expect(queue.lastSeq).toBe(5);
    expect(queue.handleLiveEvent(ev(6)).shouldApply).toBe(true);
  });

  it("treats a duplicate ack as informational and never overwrites a buffered event", () => {
    const queue = new SessionResyncQueue();
    queue.lastSeq = 3;
    queue.lastEpoch = 1;
    queue.handleLiveEvent(ev(6)); // buffered real event

    // A duplicate ack reports the server's *current* position, not a slot of ours.
    const res = queue.handleAck({
      type: "msg_ack",
      messageId: "retry-1",
      status: "duplicate",
      sequenceId: 6,
      epoch: 1,
    });
    expect(res).toEqual({ needsSync: false, drained: [] });

    const drained = queue.settle(5, 1);
    expect(drained.map((e) => e.sequenceId)).toEqual([6]);
  });

  it("adopts the baseline when the very first thing we receive is our own ack", () => {
    const queue = new SessionResyncQueue();
    queue.handleAck(ack(12, { epoch: 700 }));
    expect(queue.lastSeq).toBe(12);
    expect(queue.lastEpoch).toBe(700);
  });
});

describe("attachJitteredBackoff: gap handling on a live socket", () => {
  function makeSocket() {
    const listeners: Record<string, Array<(...args: any[]) => void>> = {};
    const send = jest.fn();
    const socket: any = {
      _retryCount: 0,
      _getNextDelay: () => 0,
      send,
      addEventListener: (event: string, cb: (...args: any[]) => void) => {
        (listeners[event] ??= []).push(cb);
      },
    };
    attachJitteredBackoff(socket);

    const received: any[] = [];
    socket.addEventListener("message", (e: any) => received.push(JSON.parse(e.data)));
    listeners["open"]?.forEach((cb) => cb());
    expect(socket.__worksphereState).toBe(ConnectionState.CONNECTED);

    const deliver = (payload: unknown) =>
      listeners["message"]?.forEach((cb) => cb({ data: JSON.stringify(payload) }));
    return { socket, send, received, deliver };
  }

  it("applies events from a room that is already past sequence 1", () => {
    const { received, deliver } = makeSocket();

    deliver(ev(57, { epoch: 900 }));
    deliver(ev(58, { epoch: 900 }));

    expect(received.map((e) => e.sequenceId)).toEqual([57, 58]);
  });

  it("sends one sync_request for a gap and applies everything once the replay arrives", () => {
    const { socket, send, received, deliver } = makeSocket();

    deliver(ev(1));
    deliver(ev(4)); // #2 and #3 never arrived
    deliver(ev(5));

    const syncRequests = send.mock.calls
      .map(([data]) => JSON.parse(data))
      .filter((m) => m.type === "sync_request");
    expect(syncRequests).toEqual([{ type: "sync_request", lastSeq: 1, epoch: 1 }]);
    expect(received.map((e) => e.sequenceId)).toEqual([1]);

    deliver({
      type: "sync_replay",
      epoch: 1,
      fromSeq: 2,
      toSeq: 5,
      events: [ev(2), ev(3), ev(4), ev(5)],
    });

    expect(received.map((e) => e.sequenceId)).toEqual([1, 2, 3, 4, 5]);
    expect(socket.__worksphereResyncQueue.lastSeq).toBe(5);
  });

  it("consumes msg_ack internally and advances the sequence without notifying listeners", () => {
    const { socket, received, deliver } = makeSocket();

    deliver(ev(1));
    deliver({
      type: "msg_ack",
      messageId: "mine",
      status: "processed",
      sequenceId: 2,
      epoch: 1,
    });
    deliver(ev(3));

    expect(received.map((e) => e.type)).toEqual(["chat", "chat"]);
    expect(received.map((e) => e.sequenceId)).toEqual([1, 3]);
    expect(socket.__worksphereResyncQueue.lastSeq).toBe(3);
  });
});
