/**
 * Regression tests: seat-hold lock ownership (#3522).
 *
 * The lock kept two indexes (hold -> owner and connection -> holds) and let them
 * drift apart whenever ownership moved, then released whatever a closing
 * connection still pointed at without checking it still owned it. A user
 * reconnecting, or using a second tab, therefore lost their live hold when the
 * old socket closed, the seat became available again and two people could
 * "hold" the same seat.
 */
import WorkspaceServer, { DEFAULT_SEAT_HOLD_TTL_MS } from "../server";
import type * as Party from "partykit/server";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "user-alice" }),
}));
jest.mock("y-partykit", () => ({ onConnect: jest.fn() }));

const VENUE = "venue-101";

function makeConn(
  id: string,
  userId?: string,
  name?: string,
): Party.Connection {
  const conn: any = {
    id,
    state: userId ? { userId, name } : {},
    setState: jest.fn((st) => {
      conn.state = { ...conn.state, ...st };
    }),
    send: jest.fn(),
    addEventListener: jest.fn(),
    close: jest.fn(),
  };
  return conn as Party.Connection;
}

describe("Seat-hold lock ownership integrity (#3522)", () => {
  let broadcast: jest.Mock;
  let server: WorkspaceServer;

  const hold = (conn: Party.Connection, seatId: string, extra: object = {}) =>
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        venueId: VENUE,
        seatId,
        ...extra,
      }),
      conn,
    );
  const release = (
    conn: Party.Connection,
    seatId: string,
    extra: object = {},
  ) =>
    server.onMessage(
      JSON.stringify({
        type: "seat_release_request",
        venueId: VENUE,
        seatId,
        ...extra,
      }),
      conn,
    );
  const reasons = () =>
    broadcast.mock.calls
      .map(([m]) => JSON.parse(m as string))
      .filter((e) => e.type === "seat_unlocked")
      .map((e) => e.reason);
  const rejected = (conn: Party.Connection) =>
    (conn.send as jest.Mock).mock.calls
      .map(([m]) => JSON.parse(m as string))
      .filter((e) => e.type === "seat_hold_rejected");
  const indexes = () => ({
    seatHolds: (server as any).seatHolds as Map<string, any>,
    connHolds: (server as any).connHolds as Map<string, Set<string>>,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    broadcast = jest.fn();
    const room = {
      id: "floorplan-venue-101",
      connections: new Map(),
      env: {},
      broadcast,
      getConnection: jest.fn(),
    } as unknown as Party.Room;
    server = new WorkspaceServer(room);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("a hold that moved to another connection", () => {
    it("survives the previous connection closing (user reconnects and re-holds)", () => {
      const alice1 = makeConn("alice-1", "user-alice");
      const alice2 = makeConn("alice-2", "user-alice");
      const bob = makeConn("bob", "user-bob");

      hold(alice1, "s1");
      hold(alice2, "s1"); // reconnect: same user renews on the new socket
      server.onClose(alice1); // the dead socket is finally noticed

      expect(server.getActiveSeatHolds(VENUE)).toHaveLength(1);
      expect(server.getActiveSeatHolds(VENUE)[0]).toMatchObject({
        userId: "user-alice",
        connId: "alice-2",
      });
      expect(reasons()).not.toContain("DISCONNECTED");

      // The seat is therefore still protected from double-booking.
      hold(bob, "s1");
      expect(rejected(bob)).toHaveLength(1);
      expect(rejected(bob)[0].reason).toBe("ALREADY_HELD");
    });

    it("is still released when the connection that owns it closes", () => {
      const alice1 = makeConn("alice-1", "user-alice");
      const alice2 = makeConn("alice-2", "user-alice");

      hold(alice1, "s1");
      hold(alice2, "s1");
      server.onClose(alice2);

      expect(server.getActiveSeatHolds(VENUE)).toHaveLength(0);
      expect(reasons()).toEqual(["DISCONNECTED"]);
    });

    it("does not release another user's hold when the old owner's socket closes (release from a second tab)", () => {
      const tab1 = makeConn("alice-tab-1", "user-alice");
      const tab2 = makeConn("alice-tab-2", "user-alice");
      const bob = makeConn("bob", "user-bob");

      hold(tab1, "s1");
      release(tab2, "s1"); // allowed: same user, different connection
      hold(bob, "s1"); // seat is free again, Bob takes it
      server.onClose(tab1); // Alice closes the first tab

      expect(server.getActiveSeatHolds(VENUE)).toEqual([
        expect.objectContaining({ userId: "user-bob", connId: "bob" }),
      ]);
      expect(reasons()).toEqual(["RELEASED"]);
    });

    it("does not release a new owner's hold when a previous owner's socket closes after expiry", () => {
      const alice = makeConn("alice", "user-alice");
      const bob = makeConn("bob", "user-bob");

      hold(alice, "s1");
      jest.advanceTimersByTime(DEFAULT_SEAT_HOLD_TTL_MS + 5_000);
      hold(bob, "s1");
      server.onClose(alice);

      expect(server.getActiveSeatHolds(VENUE)).toEqual([
        expect.objectContaining({ userId: "user-bob" }),
      ]);
    });

    it("does not trust payload userId when an unauthenticated connection acquires a hold", () => {
      const attacker = makeConn("attacker-connection");
      const alice = makeConn("alice-connection", "user-alice");

      hold(attacker, "s1", { userId: "user-alice" });

      expect(server.getActiveSeatHolds(VENUE)).toEqual([
        expect.objectContaining({
          userId: "attacker-connection",
          connId: "attacker-connection",
        }),
      ]);

      // Alice cannot be impersonated by the unauthenticated connection.
      hold(alice, "s1");

      expect(rejected(alice)).toHaveLength(1);
    });

    it("rejects a spoofed renewal of another user's hold", () => {
      const alice = makeConn("alice-connection", "user-alice");
      const attacker = makeConn("attacker-connection");

      hold(alice, "s1");
      const originalHold = server.getActiveSeatHolds(VENUE)[0];

      hold(attacker, "s1", { userId: "user-alice" });

      expect(rejected(attacker)).toHaveLength(1);
      expect(server.getActiveSeatHolds(VENUE)).toEqual([
        expect.objectContaining({
          userId: "user-alice",
          connId: "alice-connection",
          expiresAt: originalHold.expiresAt,
        }),
      ]);
    });

    it("does not allow a spoofed payload userId to release another user's hold", () => {
      const alice = makeConn("alice-connection", "user-alice");
      const attacker = makeConn("attacker-connection");

      hold(alice, "s1");

      release(attacker, "s1", { userId: "user-alice" });

      expect(server.getActiveSeatHolds(VENUE)).toEqual([
        expect.objectContaining({
          userId: "user-alice",
          connId: "alice-connection",
        }),
      ]);
      expect(reasons()).toEqual([]);
    });

    it("keeps the connection index consistent with the hold index", () => {
      const alice1 = makeConn("alice-1", "user-alice");
      const alice2 = makeConn("alice-2", "user-alice");

      hold(alice1, "s1");
      hold(alice2, "s1");

      const { connHolds } = indexes();
      expect(connHolds.has("alice-1")).toBe(false); // no stale entry left behind
      expect([...(connHolds.get("alice-2") ?? [])]).toEqual([`${VENUE}:s1`]);

      release(alice1, "s1"); // released through a non-owning connection
      expect(indexes().seatHolds.size).toBe(0);
      expect(indexes().connHolds.size).toBe(0);
    });
  });
  describe("checkout completion ownership (#9128)", () => {
    it("allows the connection that owns the hold to complete checkout", () => {
      const alice = makeConn("alice", "user-alice");

      hold(alice, "s1");
      broadcast.mockClear();

      server.onMessage(
        JSON.stringify({
          type: "seat_checkout_complete",
          venueId: VENUE,
          seatId: "s1",
        }),
        alice,
      );

      expect(server.getActiveSeatHolds(VENUE)).toHaveLength(0);
      expect(reasons()).toEqual(["CHECKOUT_COMPLETE"]);
    });

    it("does not release another user's hold through unauthorized checkout", () => {
      const alice = makeConn("alice", "user-alice");
      const bob = makeConn("bob", "user-bob");

      hold(alice, "s1");
      broadcast.mockClear();

      // Bob attempts to impersonate Alice through the message payload.
      server.onMessage(
        JSON.stringify({
          type: "seat_checkout_complete",
          venueId: VENUE,
          seatId: "s1",
          userId: "user-alice",
        }),
        bob,
      );

      expect(server.getActiveSeatHolds(VENUE)).toHaveLength(1);
      expect(reasons()).toEqual([]);
    });

    it("allows another authenticated connection belonging to the same user to complete checkout", () => {
      const alice1 = makeConn("alice-1", "user-alice");
      const alice2 = makeConn("alice-2", "user-alice");

      hold(alice1, "s1");
      broadcast.mockClear();

      server.onMessage(
        JSON.stringify({
          type: "seat_checkout_complete",
          venueId: VENUE,
          seatId: "s1",
        }),
        alice2,
      );

      expect(server.getActiveSeatHolds(VENUE)).toHaveLength(0);
      expect(reasons()).toEqual(["CHECKOUT_COMPLETE"]);
    });

    it("does not broadcast checkout completion when no hold exists", () => {
      const alice = makeConn("alice", "user-alice");

      broadcast.mockClear();

      server.onMessage(
        JSON.stringify({
          type: "seat_checkout_complete",
          venueId: VENUE,
          seatId: "s1",
        }),
        alice,
      );

      expect(server.getActiveSeatHolds(VENUE)).toHaveLength(0);
      expect(reasons()).toEqual([]);
    });
  });
});
