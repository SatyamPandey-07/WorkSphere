import VenueRoom, {
  DEFAULT_SEAT_HOLD_TTL_MS,
  LOCK_EXPIRED_GRACE_MS,
} from "../venueRoom";
import type * as Party from "partykit/server";

function makeConn(id: string): Party.Connection {
  return { id, send: jest.fn(), close: jest.fn() } as unknown as Party.Connection;
}

function sentFrames(conn: Party.Connection): Array<Record<string, unknown>> {
  return (conn.send as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]));
}

describe("VenueRoom lock_expired notification and lock_extend (#7943)", () => {
  let alice: Party.Connection;
  let bob: Party.Connection;
  let room: Party.Room;
  let venue: VenueRoom;

  const hold = (conn: Party.Connection, userId: string, ttlMs?: number) =>
    venue.onMessage(
      JSON.stringify({ type: "seat_hold", seatId: "desk-1", userId, ttlMs }),
      conn,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-21T10:00:00Z"));
    alice = makeConn("conn-alice");
    bob = makeConn("conn-bob");
    const conns = new Map([
      ["conn-alice", alice],
      ["conn-bob", bob],
    ]);
    room = {
      id: "venue-1",
      broadcast: jest.fn(),
      getConnection: jest.fn((id: string) => conns.get(id)),
    } as unknown as Party.Room;
    venue = new VenueRoom(room);
  });

  afterEach(() => {
    venue.dispose();
    jest.useRealTimers();
  });

  it("sends lock_expired only to the connection that owned the hold", async () => {
    await hold(alice, "user-alice");
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);

    expect(venue.pruneExpiredHolds()).toBe(1);

    const frames = sentFrames(alice);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: "lock_expired",
      seatId: "desk-1",
      userId: "user-alice",
      graceMs: LOCK_EXPIRED_GRACE_MS,
    });
    expect(sentFrames(bob)).toHaveLength(0);
    expect(venue.getSeats()[0].status).toBe("AVAILABLE");
  });

  it("does not notify before the TTL elapses", async () => {
    await hold(alice, "user-alice");
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS - 1000);

    expect(venue.pruneExpiredHolds()).toBe(0);
    expect(alice.send).not.toHaveBeenCalled();
  });

  it("still releases the seat when the owner connection is gone", async () => {
    await hold(alice, "user-alice");
    (room.getConnection as jest.Mock).mockReturnValue(undefined);
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);

    expect(() => venue.pruneExpiredHolds()).not.toThrow();
    expect(venue.getSeats()[0].status).toBe("AVAILABLE");
  });

  it("survives a send failure on the owner connection", async () => {
    await hold(alice, "user-alice");
    (alice.send as jest.Mock).mockImplementation(() => {
      throw new Error("socket closed");
    });
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);

    expect(() => venue.pruneExpiredHolds()).not.toThrow();
    expect(venue.getSeats()[0].status).toBe("AVAILABLE");
  });

  it("lock_extend re-acquires an expired, still-unreserved seat and acks", async () => {
    await hold(alice, "user-alice");
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);
    venue.pruneExpiredHolds();
    (alice.send as jest.Mock).mockClear();

    await venue.onMessage(
      JSON.stringify({ type: "lock_extend", seatId: "desk-1", userId: "user-alice" }),
      alice,
    );

    const ack = sentFrames(alice).find((f) => f.type === "lock_extended");
    expect(ack).toMatchObject({ seatId: "desk-1" });
    expect(ack?.holdExpiresAt).toBe(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS);
    expect(venue.getSeats()[0]).toMatchObject({
      status: "HELD",
      userId: "user-alice",
    });
    expect(venue.getActiveSeatHolds()).toHaveLength(1);
  });

  it("lock_extend is rejected when another user grabbed the seat first", async () => {
    await hold(alice, "user-alice");
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);
    venue.pruneExpiredHolds();
    await hold(bob, "user-bob");
    (alice.send as jest.Mock).mockClear();

    await venue.onMessage(
      JSON.stringify({ type: "lock_extend", seatId: "desk-1", userId: "user-alice" }),
      alice,
    );

    expect(sentFrames(alice)).toEqual([
      expect.objectContaining({ type: "seat_conflict", reason: "ALREADY_HELD" }),
    ]);
    expect(venue.getSeats()[0].userId).toBe("user-bob");
  });

  it("lock_extend is rejected when the seat was checked in by someone else", async () => {
    await hold(alice, "user-alice");
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);
    venue.pruneExpiredHolds();
    await venue.onMessage(
      JSON.stringify({ type: "seat_checkin", seatId: "desk-1", userId: "user-bob" }),
      bob,
    );
    (alice.send as jest.Mock).mockClear();

    await venue.onMessage(
      JSON.stringify({ type: "lock_extend", seatId: "desk-1", userId: "user-alice" }),
      alice,
    );

    expect(sentFrames(alice)).toEqual([
      expect.objectContaining({ type: "seat_conflict", reason: "ALREADY_OCCUPIED" }),
    ]);
    expect(venue.getSeats()[0].status).toBe("OCCUPIED");
  });

  it("lock_extend on a live hold pushes the expiry forward", async () => {
    await hold(alice, "user-alice", 60_000);
    jest.setSystemTime(Date.now() + 45_000);

    await venue.onMessage(
      JSON.stringify({
        type: "lock_extend",
        seatId: "desk-1",
        userId: "user-alice",
        ttlMs: 60_000,
      }),
      alice,
    );

    const [activeHold] = venue.getActiveSeatHolds();
    expect(activeHold.holdExpiresAt).toBe(Date.now() + 60_000);
  });
});
