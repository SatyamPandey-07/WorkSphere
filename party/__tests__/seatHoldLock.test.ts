import WorkspaceServer, { DEFAULT_SEAT_HOLD_TTL_MS } from "../server";
import type * as Party from "partykit/server";

// Mock clerk/backend and y-partykit
jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "user-alice" }),
}));

jest.mock("y-partykit", () => ({
  onConnect: jest.fn(),
}));

describe("PartyKit Distributed Seat-Hold Lock Protocol (#3522)", () => {
  let mockRoom: Party.Room;
  let mockConnAlice: Party.Connection;
  let mockConnBob: Party.Connection;
  let mockConnCharlie: Party.Connection;
  let server: WorkspaceServer;

  beforeEach(() => {
    jest.useFakeTimers();

    mockConnAlice = {
      id: "conn-alice",
      state: { userId: "user-alice", name: "Alice" },
      setState: jest.fn((st) => {
        mockConnAlice.state = { ...mockConnAlice.state, ...st };
      }),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockConnBob = {
      id: "conn-bob",
      state: { userId: "user-bob", name: "Bob" },
      setState: jest.fn((st) => {
        mockConnBob.state = { ...mockConnBob.state, ...st };
      }),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockConnCharlie = {
      id: "conn-charlie",
      state: { userId: "user-charlie", name: "Charlie" },
      setState: jest.fn((st) => {
        mockConnCharlie.state = { ...mockConnCharlie.state, ...st };
      }),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    const connections = new Map<string, Party.Connection>([
      ["conn-alice", mockConnAlice],
      ["conn-bob", mockConnBob],
      ["conn-charlie", mockConnCharlie],
    ]);

    mockRoom = {
      id: "floorplan-venue-101",
      connections,
      env: {},
      broadcast: jest.fn(),
      getConnection: jest.fn((id: string) => connections.get(id)),
    } as unknown as Party.Room;

    server = new WorkspaceServer(mockRoom);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("successfully acquires an exclusive 5-minute hold on an available seat", () => {
    const requestMsg = JSON.stringify({
      type: "seat_hold_request",
      seatId: "seat-1",
      venueId: "venue-101",
      userId: "user-alice",
      userName: "Alice",
      ttlMs: DEFAULT_SEAT_HOLD_TTL_MS,
    });

    server.onMessage(requestMsg, mockConnAlice);

    // Requester receives confirmation
    expect(mockConnAlice.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"seat_hold_acquired"'),
    );
    const confirmation = JSON.parse(
      (mockConnAlice.send as jest.Mock).mock.calls[0][0],
    );
    expect(confirmation.seatId).toBe("seat-1");
    expect(confirmation.venueId).toBe("venue-101");
    expect(confirmation.ttlMs).toBe(300_000);

    // All active room viewers receive real-time seat_locked broadcast
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('"type":"seat_locked"'),
    );
    const broadcast = JSON.parse(
      (mockRoom.broadcast as jest.Mock).mock.calls[0][0],
    );
    expect(broadcast.seatId).toBe("seat-1");
    expect(broadcast.heldBy).toBe("user-alice");
    expect(broadcast.heldByName).toBe("Alice");

    // Internal state verifies hold active
    const activeHolds = server.getActiveSeatHolds("venue-101");
    expect(activeHolds).toHaveLength(1);
    expect(activeHolds[0].seatId).toBe("seat-1");
    expect(activeHolds[0].userId).toBe("user-alice");
  });

  it("rejects concurrent hold request on the same seat by another user (race condition guard)", () => {
    // 1. Alice acquires hold on seat-1
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-alice",
        userName: "Alice",
      }),
      mockConnAlice,
    );

    // 2. Bob immediately attempts to hold seat-1
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-bob",
        userName: "Bob",
      }),
      mockConnBob,
    );

    // Bob receives rejection
    expect(mockConnBob.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"seat_hold_rejected"'),
    );
    const rejection = JSON.parse(
      (mockConnBob.send as jest.Mock).mock.calls[0][0],
    );
    expect(rejection.reason).toBe("ALREADY_HELD");
    expect(rejection.heldBy).toBe("user-alice");
    expect(rejection.heldByName).toBe("Alice");
    expect(rejection.remainingMs).toBeGreaterThan(0);

    // Seat remains exclusively held by Alice
    const activeHolds = server.getActiveSeatHolds("venue-101");
    expect(activeHolds).toHaveLength(1);
    expect(activeHolds[0].userId).toBe("user-alice");
  });

  it("allows the same user to renew their own hold lease", () => {
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-alice",
        userName: "Alice",
      }),
      mockConnAlice,
    );

    // Advance time by 2 minutes
    jest.advanceTimersByTime(120_000);

    // Alice renews hold
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-alice",
        userName: "Alice",
      }),
      mockConnAlice,
    );

    const calls = (mockConnAlice.send as jest.Mock).mock.calls;
    const lastCall = JSON.parse(calls[calls.length - 1][0]);
    expect(lastCall.type).toBe("seat_hold_acquired");
    expect(lastCall.version).toBe(2);
  });

  it("automatically releases hold upon 5-minute TTL expiration without manual intervention", () => {
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-alice",
      }),
      mockConnAlice,
    );

    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(1);

    // Advance 4 minutes: still active
    jest.advanceTimersByTime(240_000);
    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(1);

    // Advance past 5 minutes (302 seconds total)
    jest.advanceTimersByTime(62_000);

    // Lock has been pruned and broadcast sent
    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(0);
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('"type":"seat_unlocked"'),
    );
    const lastBroadcast = JSON.parse(
      (mockRoom.broadcast as jest.Mock).mock.calls.slice(-1)[0][0],
    );
    expect(lastBroadcast.seatId).toBe("seat-1");
    expect(lastBroadcast.reason).toBe("EXPIRED");

    // Bob can now acquire seat-1
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-bob",
        userName: "Bob",
      }),
      mockConnBob,
    );

    expect(mockConnBob.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"seat_hold_acquired"'),
    );
  });

  it("releases hold when client sends seat_release_request", () => {
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-alice",
      }),
      mockConnAlice,
    );

    // Another user cannot release Alice's hold
    server.onMessage(
      JSON.stringify({
        type: "seat_release_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-bob",
      }),
      mockConnBob,
    );
    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(1);

    // Alice releases her hold
    server.onMessage(
      JSON.stringify({
        type: "seat_release_request",
        seatId: "seat-1",
        venueId: "venue-101",
        userId: "user-alice",
      }),
      mockConnAlice,
    );

    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(0);
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"RELEASED"'),
    );
  });

  it("releases hold when checkout completes via seat_checkout_complete", () => {
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-2",
        venueId: "venue-101",
        userId: "user-alice",
      }),
      mockConnAlice,
    );

    server.onMessage(
      JSON.stringify({
        type: "seat_checkout_complete",
        seatId: "seat-2",
        venueId: "venue-101",
      }),
      mockConnAlice,
    );

    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(0);
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"CHECKOUT_COMPLETE"'),
    );
  });

  it("releases hold when connection disconnects (onClose)", () => {
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-3",
        venueId: "venue-101",
        userId: "user-alice",
      }),
      mockConnAlice,
    );

    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(1);

    // Alice disconnects abruptly
    server.onClose(mockConnAlice);

    expect(server.getActiveSeatHolds("venue-101")).toHaveLength(0);
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"DISCONNECTED"'),
    );
  });

  it("sends snapshot of all active holds upon request_seat_holds", () => {
    server.onMessage(
      JSON.stringify({
        type: "seat_hold_request",
        seatId: "seat-4",
        venueId: "venue-101",
        userId: "user-alice",
        userName: "Alice",
      }),
      mockConnAlice,
    );

    // Charlie connects and requests seat holds
    server.onMessage(
      JSON.stringify({
        type: "request_seat_holds",
        venueId: "venue-101",
      }),
      mockConnCharlie,
    );

    expect(mockConnCharlie.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"seat_holds_snapshot"'),
    );
    const snapshot = JSON.parse(
      (mockConnCharlie.send as jest.Mock).mock.calls[0][0],
    );
    expect(snapshot.holds).toHaveLength(1);
    expect(snapshot.holds[0].seatId).toBe("seat-4");
    expect(snapshot.holds[0].heldBy).toBe("user-alice");
  });
});
