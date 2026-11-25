import WorkspaceServer, {
  DEFAULT_SEAT_HOLD_TTL_MS,
  LOCK_EXPIRED_GRACE_MS,
} from "../server";
import type * as Party from "partykit/server";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "user-alice" }),
}));

jest.mock("y-partykit", () => ({
  onConnect: jest.fn(),
}));

function makeConn(id: string, userId: string): Party.Connection {
  const conn = {
    id,
    state: { userId, name: userId },
    setState: jest.fn(),
    send: jest.fn(),
    addEventListener: jest.fn(),
    close: jest.fn(),
  };
  return conn as unknown as Party.Connection;
}

describe("PartyKit server lock_expired notification (#7943)", () => {
  let alice: Party.Connection;
  let bob: Party.Connection;
  let room: Party.Room;
  let server: WorkspaceServer;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-21T10:00:00Z"));
    alice = makeConn("conn-alice", "user-alice");
    bob = makeConn("conn-bob", "user-bob");
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
    } as unknown as Party.Room;
    server = new WorkspaceServer(room);

    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-1",
        userId: "user-alice",
      }),
      alice,
    );
    (alice.send as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("notifies only the owner when its hold expires", () => {
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);

    expect(server.pruneExpiredSeatHolds()).toBe(1);

    const frames = (alice.send as jest.Mock).mock.calls.map((c) =>
      JSON.parse(c[0]),
    );
    expect(frames).toEqual([
      expect.objectContaining({
        type: "lock_expired",
        seatId: "seat-1",
        venueId: "venue-1",
        graceMs: LOCK_EXPIRED_GRACE_MS,
      }),
    ]);
    expect(bob.send).not.toHaveBeenCalled();
  });

  it("keeps broadcasting seat_unlocked EXPIRED to the whole room", () => {
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);
    server.pruneExpiredSeatHolds();

    expect(room.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"EXPIRED"'),
    );
  });

  it("does not notify while the hold is still valid", () => {
    expect(server.pruneExpiredSeatHolds()).toBe(0);
    expect(alice.send).not.toHaveBeenCalled();
  });

  it("re-acquires through seat_hold_request after expiry, or rejects if taken", () => {
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);
    server.pruneExpiredSeatHolds();
    (alice.send as jest.Mock).mockClear();

    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-1",
        userId: "user-bob",
      }),
      bob,
    );
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-1",
        userId: "user-alice",
      }),
      alice,
    );

    const aliceFrame = JSON.parse((alice.send as jest.Mock).mock.calls[0][0]);
    expect(aliceFrame).toMatchObject({
      type: "seat_hold_rejected",
      reason: "ALREADY_HELD",
      heldBy: "user-bob",
    });
  });

  it("does not throw when the owner connection is already gone", () => {
    (room.getConnection as jest.Mock).mockReturnValue(undefined);
    jest.setSystemTime(Date.now() + DEFAULT_SEAT_HOLD_TTL_MS + 1);

    expect(() => server.pruneExpiredSeatHolds()).not.toThrow();
  });
});
