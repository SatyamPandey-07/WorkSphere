import WorkspaceServer, {
  DEFAULT_SEAT_HOLD_TTL_MS,
  type SeatHold,
} from "../server";
import { SEAT_HOLDS_STORAGE_KEY } from "../holdHydration";
import type * as Party from "partykit/server";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "user-alice" }),
}));

jest.mock("y-partykit", () => ({
  onConnect: jest.fn(),
}));

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeConn(id: string, userId: string): Party.Connection {
  return {
    id,
    state: { userId, name: userId },
    setState: jest.fn(),
    send: jest.fn(),
    addEventListener: jest.fn(),
    close: jest.fn(),
  } as unknown as Party.Connection;
}

const frames = (conn: Party.Connection) =>
  (conn.send as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]));

const holdMsg = (userId: string) =>
  JSON.stringify({
    type: "seat_hold_request",
    seatId: "seat-4",
    venueId: "venue-1",
    userId,
  });

describe("WorkspaceServer seat-hold hydration on wake (#7954)", () => {
  let alice: Party.Connection;
  let bob: Party.Connection;
  let room: Party.Room;
  let load: ReturnType<typeof deferred<SeatHold[] | undefined>>;
  let put: jest.Mock;
  let server: WorkspaceServer;

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-21T10:00:00Z"));
    alice = makeConn("conn-alice", "user-alice");
    bob = makeConn("conn-bob", "user-bob");
    load = deferred<SeatHold[] | undefined>();
    put = jest.fn().mockResolvedValue(undefined);
    const conns = new Map([
      ["conn-alice", alice],
      ["conn-bob", bob],
    ]);
    room = {
      id: "floorplan-venue-1",
      connections: conns,
      env: {},
      broadcast: jest.fn(),
      getConnection: jest.fn((id: string) => conns.get(id)),
      storage: { get: jest.fn(() => load.promise), put },
    } as unknown as Party.Room;
    server = new WorkspaceServer(room);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("grants exactly one of two simultaneous requests on the first tick", async () => {
    server.onMessage(holdMsg("user-alice"), alice);
    server.onMessage(holdMsg("user-bob"), bob);

    // Nothing is decided while storage is still loading.
    expect(alice.send).not.toHaveBeenCalled();
    expect(bob.send).not.toHaveBeenCalled();

    load.resolve(undefined);
    await server.onStart();

    expect(frames(alice).map((f) => f.type)).toEqual(["seat_hold_acquired"]);
    expect(frames(bob)).toEqual([
      expect.objectContaining({
        type: "seat_hold_rejected",
        reason: "ALREADY_HELD",
        heldBy: "user-alice",
      }),
    ]);
    expect(server.getActiveSeatHolds("venue-1")).toHaveLength(1);
  });

  it("replays queued requests in arrival order", async () => {
    server.onMessage(holdMsg("user-bob"), bob);
    server.onMessage(holdMsg("user-alice"), alice);

    load.resolve(undefined);
    await server.onStart();

    expect(frames(bob).map((f) => f.type)).toEqual(["seat_hold_acquired"]);
    expect(frames(alice)[0]).toMatchObject({
      type: "seat_hold_rejected",
      heldBy: "user-bob",
    });
  });

  it("rejects both requests when a persisted lease already covers the seat", async () => {
    server.onMessage(holdMsg("user-alice"), alice);
    server.onMessage(holdMsg("user-bob"), bob);

    load.resolve([
      {
        seatId: "seat-4",
        venueId: "venue-1",
        userId: "user-carol",
        userName: "Carol",
        connId: "conn-carol-old",
        heldAt: Date.now() - 60_000,
        expiresAt: Date.now() + 120_000,
        version: 3,
      },
    ]);
    await server.onStart();

    for (const conn of [alice, bob]) {
      expect(frames(conn)).toEqual([
        expect.objectContaining({
          type: "seat_hold_rejected",
          reason: "ALREADY_HELD",
          heldBy: "user-carol",
        }),
      ]);
    }
    expect(server.getActiveSeatHolds("venue-1")).toHaveLength(1);
  });

  it("lets the persisted owner renew from a new connection", async () => {
    load.resolve([
      {
        seatId: "seat-4",
        venueId: "venue-1",
        userId: "user-alice",
        connId: "conn-alice-before-sleep",
        heldAt: Date.now() - 60_000,
        expiresAt: Date.now() + 120_000,
        version: 1,
      },
    ]);
    await server.onStart();

    server.onMessage(holdMsg("user-alice"), alice);

    expect(frames(alice)[0]).toMatchObject({
      type: "seat_hold_acquired",
      version: 2,
    });
  });

  it("discards expired and malformed persisted leases", async () => {
    load.resolve([
      {
        seatId: "seat-4",
        venueId: "venue-1",
        userId: "user-carol",
        connId: "conn-old",
        heldAt: Date.now() - DEFAULT_SEAT_HOLD_TTL_MS - 10_000,
        expiresAt: Date.now() - 10_000,
        version: 1,
      },
      { seatId: 42 } as unknown as SeatHold,
      null as unknown as SeatHold,
    ]);
    await server.onStart();

    expect(server.getActiveSeatHolds("venue-1")).toHaveLength(0);
    server.onMessage(holdMsg("user-bob"), bob);
    expect(frames(bob)[0].type).toBe("seat_hold_acquired");
  });

  it("does not overwrite persisted leases while hydration is running", async () => {
    // Sweeps fire while storage is still loading and see an empty table.
    jest.advanceTimersByTime(5000);
    await flush();
    expect(put).not.toHaveBeenCalled();

    load.resolve(undefined);
    await server.onStart();
    await flush();
    expect(put).not.toHaveBeenCalled();
  });

  it("persists the lease table after a hold is granted, with one write per tick", async () => {
    load.resolve(undefined);
    await server.onStart();

    server.onMessage(holdMsg("user-alice"), alice);
    await flush();

    expect(put).toHaveBeenCalledTimes(1);
    const [key, snapshot] = put.mock.calls[0];
    expect(key).toBe(SEAT_HOLDS_STORAGE_KEY);
    expect(snapshot).toEqual([
      expect.objectContaining({ seatId: "seat-4", userId: "user-alice" }),
    ]);
  });

  it("persists releases and expiries", async () => {
    load.resolve(undefined);
    await server.onStart();
    server.onMessage(holdMsg("user-alice"), alice);
    await flush();
    put.mockClear();

    server.onMessage(
      JSON.stringify({
        type: "seat_release_request",
        seatId: "seat-4",
        venueId: "venue-1",
      }),
      alice,
    );
    await flush();
    expect(put).toHaveBeenLastCalledWith(SEAT_HOLDS_STORAGE_KEY, []);

    server.onMessage(holdMsg("user-alice"), alice);
    await flush();
    put.mockClear();
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);
    server.pruneExpiredSeatHolds();
    await flush();
    expect(put).toHaveBeenLastCalledWith(SEAT_HOLDS_STORAGE_KEY, []);
  });

  it("starts empty and releases queued requests when storage fails", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    server.onMessage(holdMsg("user-alice"), alice);

    load.reject(new Error("storage unavailable"));
    await server.onStart();

    expect(frames(alice)[0].type).toBe("seat_hold_acquired");
    errorSpy.mockRestore();
  });

  it("onStart resolves only after hydration completes", async () => {
    let started = false;
    const starting = server.onStart().then(() => {
      started = true;
    });
    await flush();
    expect(started).toBe(false);

    load.resolve(undefined);
    await starting;
    expect(started).toBe(true);
  });

  it("behaves as before when the room has no storage", () => {
    const bareRoom = {
      id: "floorplan-venue-1",
      connections: new Map(),
      env: {},
      broadcast: jest.fn(),
      getConnection: jest.fn(),
    } as unknown as Party.Room;
    const bare = new WorkspaceServer(bareRoom);

    bare.onMessage(holdMsg("user-alice"), alice);

    expect(frames(alice)[0].type).toBe("seat_hold_acquired");
  });
});
