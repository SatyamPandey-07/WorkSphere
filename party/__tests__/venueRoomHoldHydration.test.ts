import VenueRoom, { type SeatHoldLock } from "../venueRoom";
import { SEAT_HOLDS_STORAGE_KEY } from "../holdHydration";
import type * as Party from "partykit/server";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const makeConn = (id: string) =>
  ({ id, send: jest.fn(), close: jest.fn() }) as unknown as Party.Connection;

const frames = (conn: Party.Connection) =>
  (conn.send as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]));

const holdMsg = (userId: string) =>
  JSON.stringify({ type: "seat_hold", seatId: "seat-4", userId });

describe("VenueRoom seat-hold hydration on wake (#7954)", () => {
  let alice: Party.Connection;
  let bob: Party.Connection;
  let load: ReturnType<typeof deferred<SeatHoldLock[] | undefined>>;
  let put: jest.Mock;
  let venue: VenueRoom;

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-21T10:00:00Z"));
    alice = makeConn("conn-alice");
    bob = makeConn("conn-bob");
    load = deferred<SeatHoldLock[] | undefined>();
    put = jest.fn().mockResolvedValue(undefined);
    const room = {
      id: "venue-1",
      broadcast: jest.fn(),
      getConnection: jest.fn(),
      storage: { get: jest.fn(() => load.promise), put },
    } as unknown as Party.Room;
    venue = new VenueRoom(room);
  });

  afterEach(() => {
    venue.dispose();
    jest.useRealTimers();
  });

  it("grants exactly one of two simultaneous seat_hold requests on the first tick", async () => {
    const first = venue.onMessage(holdMsg("user-alice"), alice);
    const second = venue.onMessage(holdMsg("user-bob"), bob);

    expect(venue.getActiveSeatHolds()).toHaveLength(0);

    load.resolve(undefined);
    await Promise.all([first, second]);

    expect(venue.getActiveSeatHolds()).toEqual([
      expect.objectContaining({ userId: "user-alice" }),
    ]);
    expect(frames(alice)).toEqual([]);
    expect(frames(bob)).toEqual([
      expect.objectContaining({ type: "seat_conflict", reason: "ALREADY_HELD" }),
    ]);
  });

  it("respects a persisted lease for a seat on the first tick", async () => {
    const pending = [
      venue.onMessage(holdMsg("user-alice"), alice),
      venue.onMessage(holdMsg("user-bob"), bob),
    ];

    load.resolve([
      {
        seatId: "seat-4",
        userId: "user-carol",
        connId: "conn-carol-old",
        holdExpiresAt: Date.now() + 120_000,
      },
    ]);
    await Promise.all(pending);

    for (const conn of [alice, bob]) {
      expect(frames(conn)).toEqual([
        expect.objectContaining({ type: "seat_conflict", reason: "ALREADY_HELD" }),
      ]);
    }
    expect(venue.getSeats()[0]).toMatchObject({
      seatId: "seat-4",
      status: "HELD",
      userId: "user-carol",
    });
  });

  it("drops expired persisted leases", async () => {
    load.resolve([
      {
        seatId: "seat-4",
        userId: "user-carol",
        connId: "conn-old",
        holdExpiresAt: Date.now() - 1000,
      },
    ]);
    await venue.onStart();

    expect(venue.getActiveSeatHolds()).toHaveLength(0);
    expect(venue.getSeats()).toHaveLength(0);
  });

  it("holds connections until hydration finishes", async () => {
    const conn = makeConn("conn-late");
    let connected = false;
    const joining = venue
      .onConnect(conn, {
        request: new Request("https://example.test/party/venue-1"),
      } as unknown as Party.ConnectionContext)
      .then(() => {
        connected = true;
      });
    await flush();
    expect(connected).toBe(false);

    load.resolve(undefined);
    await joining;

    expect(frames(conn)[0]).toMatchObject({ type: "seat_snapshot" });
  });

  it("does not overwrite persisted leases while hydrating", async () => {
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(put).not.toHaveBeenCalled();
  });

  it("persists grants and releases once hydrated", async () => {
    load.resolve(undefined);
    await venue.onStart();

    await venue.onMessage(holdMsg("user-alice"), alice);
    await flush();
    expect(put).toHaveBeenLastCalledWith(SEAT_HOLDS_STORAGE_KEY, [
      expect.objectContaining({ seatId: "seat-4", userId: "user-alice" }),
    ]);

    await venue.onMessage(
      JSON.stringify({ type: "seat_release", seatId: "seat-4", userId: "user-alice" }),
      alice,
    );
    await flush();
    expect(put).toHaveBeenLastCalledWith(SEAT_HOLDS_STORAGE_KEY, []);
  });

  it("starts empty when storage fails and still serves requests", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const pending = venue.onMessage(holdMsg("user-alice"), alice);

    load.reject(new Error("storage unavailable"));
    await pending;

    expect(venue.getActiveSeatHolds()).toHaveLength(1);
    errorSpy.mockRestore();
  });
});
