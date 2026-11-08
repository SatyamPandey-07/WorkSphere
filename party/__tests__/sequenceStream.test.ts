/**
 * End-to-end regression tests for the sequenced event stream.
 *
 * The servers numbered events with `sequenceId`, but burned numbers on messages
 * that were not delivered to every client (a per-connection `seat_snapshot`, the
 * sender being excluded from its own broadcast, unicast seat-hold replies,
 * un-recorded music updates). Clients apply events strictly in order, so every
 * burned number left a permanent gap: late joiners and message senders stopped
 * receiving live events altogether.
 *
 * Invariant under test: a sequence number is consumed only by an event that is
 * recorded for replay AND reaches every client, or is acknowledged to the sender.
 */
import WorkspaceServer from "../server";
import MultiRegionWorkspaceServer from "../multiRegionServer";
import { attachJitteredBackoff } from "../../src/lib/partySocketReconnect";
import type * as Party from "partykit/server";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn(async (token: string) => ({ sub: `user_${token}` })),
}));
jest.mock("y-partykit", () => ({ onConnect: jest.fn() }));
jest.mock("../../src/lib/edge/edgeMeshSync", () => ({
  EdgeMeshSync: jest.fn().mockImplementation(() => ({
    setGetLocalStateFn: jest.fn(),
    setOnRemoteStateReceived: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    serializeState: jest.fn(() => ({})),
  })),
}));

type FakeClient = {
  name: string;
  received: any[];
  socket: any;
};

type Harness = {
  join: (name: string) => Promise<{
    client: FakeClient;
    conn: Party.Connection;
    say: (obj: unknown) => void;
  }>;
  server: any;
  broadcasts: any[];
};

/** A server wired to in-memory clients that use the real resync wrapper. */
function makeWorld(
  ServerClass: new (room: Party.Room) => any,
  roomId: string,
): Harness {
  const conns = new Map<string, any>();
  const broadcasts: any[] = [];

  const room = {
    id: roomId,
    broadcast(msg: string, exclude: string[] = []) {
      broadcasts.push(JSON.parse(msg));
      for (const [id, c] of conns) {
        if (!exclude.includes(id)) c.client.socket.emit("message", msg);
      }
    },
    getConnection: (id: string) => conns.get(id),
  } as unknown as Party.Room;

  const server = new ServerClass(room);

  async function join(name: string) {
    const listeners: Record<string, Array<(...args: any[]) => void>> = {};
    const socket: any = {
      _retryCount: 0,
      _getNextDelay: () => 0,
      send: jest.fn(),
      addEventListener: (ev: string, cb: (...args: any[]) => void) => {
        (listeners[ev] ??= []).push(cb);
      },
      emit: (ev: string, data?: string) =>
        (listeners[ev] ?? []).forEach((cb) => cb({ data })),
    };
    attachJitteredBackoff(socket);

    const received: any[] = [];
    socket.addEventListener("message", (e: any) => received.push(JSON.parse(e.data)));
    socket.emit("open");

    const client: FakeClient = { name, received, socket };
    const conn: any = {
      id: name,
      state: null,
      client,
      setState(s: unknown) {
        this.state = s;
      },
      send: (m: string) => socket.emit("message", m),
      close: jest.fn(),
      addEventListener: jest.fn(),
    };
    conns.set(name, conn);

    await server.onConnect(conn, {
      request: {
        url: `http://x/party/${roomId}?token=${name}`,
        headers: { get: () => null },
      },
    } as never);

    return { client, conn, say: (obj: unknown) => server.onMessage(JSON.stringify(obj), conn) };
  }

  return { join, server, broadcasts };
}

const seqs = (c: FakeClient, type?: string) =>
  c.received.filter((e) => !type || e.type === type).map((e) => e.sequenceId);
const types = (c: FakeClient) => c.received.map((e) => e.type);

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ role: "EDITOR", member: true }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("WorkspaceServer sequence stream", () => {
  it("delivers every seat update to clients that join after the first event", async () => {
    const w = makeWorld(WorkspaceServer, "seat-availability");

    const A = await w.join("A");
    A.say({ type: "seat_checkin", venueId: "v1", capacity: 8 });
    const B = await w.join("B"); // joins after event #1
    B.say({ type: "seat_checkin", venueId: "v1", capacity: 8 });
    const C = await w.join("C"); // joins after event #2
    C.say({ type: "seat_checkin", venueId: "v2", capacity: 4 });

    // The shared stream is gapless: 1, 2, 3 (snapshots did not consume numbers).
    expect(w.broadcasts.map((e) => e.sequenceId)).toEqual([1, 2, 3]);

    expect(seqs(A.client, "seat_update")).toEqual([1, 2, 3]);
    expect(seqs(B.client, "seat_update")).toEqual([2, 3]);
    expect(seqs(C.client, "seat_update")).toEqual([3]);

    // Late joiners still get their state snapshot first.
    expect(types(B.client)[0]).toBe("seat_snapshot");
    expect(types(C.client)[0]).toBe("seat_snapshot");

    for (const { client } of [A, B, C]) {
      expect(client.socket.__worksphereResyncQueue.lastSeq).toBe(3);
      expect(client.socket.__worksphereResyncQueue.pendingLiveEvents.size).toBe(0);
    }
  });

  it("does not consume a sequence number for the connect-time seat_snapshot", async () => {
    const w = makeWorld(WorkspaceServer, "seat-availability");

    const A = await w.join("A");
    A.say({ type: "seat_checkin", venueId: "v1", capacity: 8 }); // #1

    const B = await w.join("B");
    const snapshot = B.client.received.find((e) => e.type === "seat_snapshot");
    expect(snapshot.sequenceId).toBe(1); // stamped with the latest, not a new number

    B.say({ type: "seat_checkin", venueId: "v1", capacity: 8 });
    expect(w.broadcasts.map((e) => e.sequenceId)).toEqual([1, 2]);
  });

  it("lets two editors receive each other's edits (the sender is acknowledged, not left with a gap)", async () => {
    const w = makeWorld(WorkspaceServer, "folder-abc");
    const A = await w.join("A");
    const B = await w.join("B");

    A.say({ type: "map-update", messageId: "a1", payload: 1 });
    B.say({ type: "map-update", messageId: "b1", payload: 2 });
    A.say({ type: "map-update", messageId: "a2", payload: 3 });
    B.say({ type: "map-update", messageId: "b2", payload: 4 });

    expect(seqs(A.client, "map-update")).toEqual([2, 4]); // B's edits
    expect(seqs(B.client, "map-update")).toEqual([1, 3]); // A's edits

    // Own edits are acknowledged internally and never surface as app events.
    expect(types(A.client)).not.toContain("msg_ack");
    expect(A.client.socket.__worksphereResyncQueue.lastSeq).toBe(4);
    expect(B.client.socket.__worksphereResyncQueue.lastSeq).toBe(4);
  });

  it("acknowledges the sender with the slot its message took", async () => {
    const w = makeWorld(WorkspaceServer, "folder-abc");
    const A = await w.join("A");
    const sendSpy = jest.spyOn(A.conn, "send");

    A.say({ type: "map-update", messageId: "a1", payload: 1 });

    const ack = sendSpy.mock.calls
      .map(([m]) => JSON.parse(m as string))
      .find((m) => m.type === "msg_ack");
    expect(ack).toMatchObject({
      messageId: "a1",
      status: "processed",
      sequenceId: 1,
    });
    expect(typeof ack.epoch).toBe("number");
  });

  it("gives a late joiner its own seat_hold_acquired and every later lock/unlock", async () => {
    const w = makeWorld(WorkspaceServer, "seat-availability");

    const A = await w.join("A");
    A.say({ type: "seat_hold_request", venueId: "v1", seatId: "s1" });
    const C = await w.join("C");
    C.say({ type: "seat_hold_request", venueId: "v1", seatId: "s2" });
    A.say({ type: "seat_release_request", venueId: "v1", seatId: "s1" });

    // The requester's confirmation is a direct reply and must always arrive.
    expect(types(C.client)).toContain("seat_hold_acquired");
    expect(types(A.client)).toContain("seat_hold_acquired");

    // Lock/unlock events are part of the shared, replayable stream.
    expect(w.broadcasts.map((e) => [e.type, e.sequenceId])).toEqual([
      ["seat_locked", 1],
      ["seat_locked", 2],
      ["seat_unlocked", 3],
    ]);
    expect(seqs(C.client, "seat_unlocked")).toEqual([3]);
    expect(seqs(A.client, "seat_locked")).toEqual([1, 2]);
  });

  it("does not put a sequence number on the direct seat_hold_acquired reply", async () => {
    const w = makeWorld(WorkspaceServer, "seat-availability");
    const A = await w.join("A");
    A.say({ type: "seat_hold_request", venueId: "v1", seatId: "s1" });

    const acquired = A.client.received.find((e) => e.type === "seat_hold_acquired");
    expect(acquired.sequenceId).toBeUndefined();
  });

  it("records music genre updates so they are replayed after a reconnect", async () => {
    const w = makeWorld(WorkspaceServer, "seat-availability");
    const A = await w.join("A");
    A.say({ type: "seat_checkin", venueId: "v1", capacity: 8 }); // #1
    A.say({ type: "music_genre_update", venueId: "v1", genre: "Jazz" }); // #2

    expect(w.broadcasts.map((e) => [e.type, e.sequenceId])).toEqual([
      ["seat_update", 1],
      ["music_genre_broadcast", 2],
    ]);

    // A reconnecting client that last saw #1 asks the server to catch it up.
    const reconnecting = { id: "R", send: jest.fn(), state: {} } as unknown as Party.Connection;
    w.server.onMessage(
      JSON.stringify({ type: "sync_request", lastSeq: 1, epoch: w.broadcasts[0].epoch }),
      reconnecting,
    );

    const replay = JSON.parse((reconnecting.send as jest.Mock).mock.calls[0][0]);
    expect(replay.type).toBe("sync_replay");
    expect(replay.toSeq).toBe(2);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]).toMatchObject({
      type: "music_genre_broadcast",
      venueId: "v1",
      genre: "Jazz",
      sequenceId: 2,
    });
  });

  it("every consumed sequence number is recorded for replay", async () => {
    const w = makeWorld(WorkspaceServer, "seat-availability");
    const A = await w.join("A");
    A.say({ type: "seat_checkin", venueId: "v1", capacity: 8 });
    const B = await w.join("B");
    B.say({ type: "seat_hold_request", venueId: "v1", seatId: "s1" });
    A.say({ type: "music_genre_update", venueId: "v1", genre: "Pop" });
    B.say({ type: "seat_checkout" });

    const history: Array<{ sequenceId: number }> = w.server.eventHistory;
    const recorded = history.map((e) => e.sequenceId);
    expect(recorded).toEqual(
      Array.from({ length: w.server.sequenceId }, (_, i) => i + 1),
    );
  });
});

describe("MultiRegionWorkspaceServer sequence stream", () => {
  it("does not consume a sequence number for the connect-time seat_snapshot", async () => {
    const w = makeWorld(MultiRegionWorkspaceServer, "seat-availability");

    const A = await w.join("A");
    A.say({ type: "seat_checkin", venueId: "v1", capacity: 8 }); // #1
    const B = await w.join("B");

    const snapshot = B.client.received.find((e) => e.type === "seat_snapshot");
    expect(snapshot.sequenceId).toBe(1);

    B.say({ type: "seat_checkin", venueId: "v1", capacity: 8 });
    expect(w.broadcasts.filter((e) => e.type === "seat_update").map((e) => e.sequenceId)).toEqual([1, 2]);
    expect(seqs(B.client, "seat_update")).toEqual([2]);
    expect(seqs(A.client, "seat_update")).toEqual([1, 2]);
  });

  it("acknowledges the sender and keeps both editors in sync", async () => {
    const w = makeWorld(MultiRegionWorkspaceServer, "folder-abc");
    const A = await w.join("A");
    const B = await w.join("B");

    A.say({ type: "new-message", message: { id: "a1", text: "hi" } });
    B.say({ type: "new-message", message: { id: "b1", text: "yo" } });
    A.say({ type: "new-message", message: { id: "a2", text: "again" } });

    expect(seqs(A.client, "new-message")).toEqual([2]);
    expect(seqs(B.client, "new-message")).toEqual([1, 3]);
    expect(A.client.socket.__worksphereResyncQueue.lastSeq).toBe(3);
    expect(B.client.socket.__worksphereResyncQueue.lastSeq).toBe(3);
    expect(types(A.client)).not.toContain("msg_ack");
  });
});
