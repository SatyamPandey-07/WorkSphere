import VenueRoom, {
  DEFAULT_SEAT_HOLD_TTL_MS,
  type SeatCheckin,
} from "../venueRoom";
import type * as Party from "partykit/server";

describe("VenueRoom Seat Hold Locks, Conflict Resolution & TTL Expiration (#7924)", () => {
  let mockRoom: Party.Room;
  let mockConn1: Party.Connection;
  let mockConn2: Party.Connection;
  let server: VenueRoom;
  let broadcastedMessages: string[];

  beforeEach(() => {
    broadcastedMessages = [];

    mockConn1 = {
      id: "conn-alice",
      send: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockConn2 = {
      id: "conn-bob",
      send: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockRoom = {
      id: "venue-202",
      broadcast: jest.fn((msg: string) => {
        broadcastedMessages.push(msg);
      }),
    } as unknown as Party.Room;

    server = new VenueRoom(mockRoom);
  });

  afterEach(() => {
    server.dispose();
  });

  describe("Seat Hold Lifecycle", () => {
    it("successfully holds an available seat and broadcasts seat_hold event", async () => {
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-1",
          userId: "user-alice",
          userName: "Alice",
        }),
        mockConn1
      );

      expect(server.getSequenceId()).toBe(1);
      const seats = server.getSeats();
      expect(seats).toHaveLength(1);
      expect(seats[0].status).toBe("HELD");
      expect(seats[0].userId).toBe("user-alice");

      const holds = server.getActiveSeatHolds();
      expect(holds).toHaveLength(1);
      expect(holds[0].seatId).toBe("seat-desk-1");
      expect(holds[0].userId).toBe("user-alice");
      expect(holds[0].connId).toBe("conn-alice");

      expect(broadcastedMessages).toHaveLength(1);
      const broadcast = JSON.parse(broadcastedMessages[0]);
      expect(broadcast.type).toBe("seat_update");
      expect(broadcast.event.type).toBe("seat_hold");
      expect(broadcast.event.seat.status).toBe("HELD");
    });

    it("prevents double-booking by rejecting concurrent hold with seat_conflict", async () => {
      // Alice holds the seat
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-1",
          userId: "user-alice",
        }),
        mockConn1
      );

      // Bob tries to hold the same seat
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-1",
          userId: "user-bob",
        }),
        mockConn2
      );

      expect(mockConn2.send).toHaveBeenCalledTimes(1);
      const conflictMsg = JSON.parse((mockConn2.send as jest.Mock).mock.calls[0][0]);
      expect(conflictMsg.type).toBe("seat_conflict");
      expect(conflictMsg.reason).toBe("ALREADY_HELD");
      expect(conflictMsg.seatId).toBe("seat-desk-1");
    });

    it("rejects seat_checkin on a held seat from a different user", async () => {
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-1",
          userId: "user-alice",
        }),
        mockConn1
      );

      // Bob attempts to check into Alice's held seat
      await server.onMessage(
        JSON.stringify({
          type: "seat_checkin",
          seatId: "seat-desk-1",
          userId: "user-bob",
        }),
        mockConn2
      );

      expect(mockConn2.send).toHaveBeenCalledTimes(1);
      const conflictMsg = JSON.parse((mockConn2.send as jest.Mock).mock.calls[0][0]);
      expect(conflictMsg.type).toBe("seat_conflict");
      expect(conflictMsg.reason).toBe("ALREADY_HELD");
    });

    it("allows the holding user to confirm check-in and consumes the hold", async () => {
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-1",
          userId: "user-alice",
          userName: "Alice",
        }),
        mockConn1
      );

      // Alice confirms check-in
      await server.onMessage(
        JSON.stringify({
          type: "seat_checkin",
          seatId: "seat-desk-1",
          userId: "user-alice",
          userName: "Alice",
        }),
        mockConn1
      );

      expect(server.getSequenceId()).toBe(2);
      expect(server.getActiveSeatHolds()).toHaveLength(0);
      expect(server.getSeats()[0].status).toBe("OCCUPIED");
    });

    it("releases a held seat and broadcasts seat_release event", async () => {
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-1",
          userId: "user-alice",
        }),
        mockConn1
      );

      await server.onMessage(
        JSON.stringify({
          type: "seat_release",
          seatId: "seat-desk-1",
          userId: "user-alice",
        }),
        mockConn1
      );

      expect(server.getActiveSeatHolds()).toHaveLength(0);
      expect(server.getSeats()[0].status).toBe("AVAILABLE");

      const lastBroadcast = JSON.parse(broadcastedMessages[broadcastedMessages.length - 1]);
      expect(lastBroadcast.event.type).toBe("seat_release");
      expect(lastBroadcast.event.seat.status).toBe("AVAILABLE");
    });
  });

  describe("TTL Expiration & Disconnect Cleanup", () => {
    it("automatically releases expired holds past TTL during prune sweep", async () => {
      const now = Date.now();
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-timeout",
          userId: "user-alice",
          ttlMs: 3000,
        }),
        mockConn1
      );

      expect(server.getActiveSeatHolds()).toHaveLength(1);

      // Prune after expiry
      const prunedCount = server.pruneExpiredHolds(now + 4000);
      expect(prunedCount).toBe(1);
      expect(server.getActiveSeatHolds()).toHaveLength(0);
      expect(server.getSeats()[0].status).toBe("AVAILABLE");
    });

    it("releases unconfirmed holds when client connection closes", async () => {
      await server.onMessage(
        JSON.stringify({
          type: "seat_hold",
          seatId: "seat-desk-closing",
          userId: "user-alice",
        }),
        mockConn1
      );

      expect(server.getActiveSeatHolds()).toHaveLength(1);

      // Alice's socket disconnects
      await server.onClose(mockConn1);

      expect(server.getActiveSeatHolds()).toHaveLength(0);
      expect(server.getSeats()[0].status).toBe("AVAILABLE");
      const lastBroadcast = JSON.parse(broadcastedMessages[broadcastedMessages.length - 1]);
      expect(lastBroadcast.event.type).toBe("seat_release");
    });
  });
});
