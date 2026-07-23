// @ts-expect-error - missing types for partykit
import { Party } from "partykit/server";

interface MockConnection extends Party.Connection {
  id: string;
  state: Record<string, unknown>;
  messages: string[];
  setState(state: Record<string, unknown>): void;
  send(data: string): void;
  addEventListener(
    event: string,
    handler: (event: { data: string }) => void,
  ): void;
  close(): void;
}

interface MockRoom extends Party.Room {
  connections: Map<string, MockConnection>;
  broadcast(data: string, exclude?: string[]): void;
  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext): void;
  onMessage(message: string, sender: Party.Connection): void;
  onClose(conn: Party.Connection): void;
}

function createMockConnection(id: string): MockConnection {
  return {
    id,
    state: {},
    messages: [],
    setState(state: Record<string, unknown>) {
      this.state = state;
    },
    send(data: string) {
      this.messages.push(data);
    },
    addEventListener() {},
    close() {},
  };
}

function createMockRoom(): MockRoom {
  const connections = new Map<string, MockConnection>();
  return {
    connections,
    broadcast(data: string, exclude: string[] = []) {
      for (const [id, conn] of connections) {
        if (!exclude.includes(id)) {
          conn.messages.push(data);
        }
      }
    },
    onConnect() {},
    onMessage() {},
    onClose() {},
  };
}

function createServer(room: MockRoom) {
  const DEFAULT_SEAT_CAPACITY = 8;
  const seatCheckins = new Map<
    string,
    { venueId: string; capacity: number; checkedInAt: number; version: number }
  >();
  let sequenceId = 0;

  function seatStatusFor(count: number, capacity: number) {
    if (capacity <= 0) return "red";
    const ratio = count / capacity;
    if (ratio >= 1) return "red";
    if (ratio >= 0.6) return "yellow";
    return "green";
  }

  function countForVenue(venueId: string): number {
    let count = 0;
    for (const checkin of seatCheckins.values()) {
      if (checkin.venueId === venueId) count++;
    }
    return count;
  }

  function capacityForVenue(venueId: string): number {
    for (const checkin of seatCheckins.values()) {
      if (checkin.venueId === venueId) return checkin.capacity;
    }
    return DEFAULT_SEAT_CAPACITY;
  }

  function broadcastSeatUpdate(venueId: string) {
    const count = countForVenue(venueId);
    const capacity = capacityForVenue(venueId);
    sequenceId++;
    room.broadcast(
      JSON.stringify({
        type: "seat_update",
        venueId,
        count,
        capacity,
        status: seatStatusFor(count, capacity),
        epoch: Date.now(),
        sequenceId,
      }),
    );
  }

  function handleSeatCheckin(
    conn: MockConnection,
    venueId: string,
    capacity?: unknown,
  ) {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const previous = seatCheckins.get(conn.id);
      const version = (previous?.version ?? 0) + 1;
      const resolvedCapacity =
        typeof capacity === "number" && capacity > 0
          ? capacity
          : (previous?.capacity ?? DEFAULT_SEAT_CAPACITY);

      const newCheckin = {
        venueId,
        capacity: resolvedCapacity,
        checkedInAt: Date.now(),
        version,
      };

      if (previous && seatCheckins.get(conn.id)?.version !== previous.version) {
        continue;
      }

      seatCheckins.set(conn.id, newCheckin);
      broadcastSeatUpdate(venueId);
      if (previous && previous.venueId !== venueId) {
        broadcastSeatUpdate(previous.venueId);
      }
      return;
    }
    console.error("[Seat] Max retries exceeded for checkin", conn.id);
  }

  function handleSeatCheckout(conn: MockConnection) {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const previous = seatCheckins.get(conn.id);
      if (!previous) return;

      if (seatCheckins.get(conn.id)?.version !== previous.version) {
        continue;
      }

      seatCheckins.delete(conn.id);
      broadcastSeatUpdate(previous.venueId);
      return;
    }
  }

  return {
    handleSeatCheckin,
    handleSeatCheckout,
    getSeatCheckins: () => seatCheckins,
    getBroadcastMessages: () => {
      const allMsgs: string[] = [];
      for (const conn of room.connections.values()) {
        allMsgs.push(...conn.messages);
      }
      return allMsgs;
    },
  };
}

describe("PartyKit Seat Check-in Race Condition", () => {
  let room: MockRoom;
  let server: ReturnType<typeof createServer>;
  let conn: MockConnection;

  beforeEach(() => {
    room = createMockRoom();
    server = createServer(room);
    conn = createMockConnection("conn-1");
    room.connections.set(conn.id, conn);
  });

  test("should handle rapid check-in/check-out without race condition", () => {
    // Rapid sequence: checkin A -> checkout -> checkin B
    server.handleSeatCheckin(conn, "venue-a", 10);
    server.handleSeatCheckout(conn);
    server.handleSeatCheckin(conn, "venue-b", 10);

    const checkins = server.getSeatCheckins();
    expect(checkins.size).toBe(1);
    expect(checkins.get(conn.id)?.venueId).toBe("venue-b");

    const messages = server.getBroadcastMessages();
    const updates = messages.filter(
      (m) => JSON.parse(m).type === "seat_update",
    );

    // Should have updates for venue-a (checkin, checkout) and venue-b (checkin)
    const venueAUpdates = updates.filter(
      (m) => JSON.parse(m).venueId === "venue-a",
    );
    const venueBUpdates = updates.filter(
      (m) => JSON.parse(m).venueId === "venue-b",
    );

    expect(venueAUpdates.length).toBeGreaterThanOrEqual(2);
    expect(venueBUpdates.length).toBeGreaterThanOrEqual(1);
  });

  test("should not double-count when rapid check-ins to different venues", () => {
    // Simulate rapid venue switching
    server.handleSeatCheckin(conn, "venue-a", 10);
    server.handleSeatCheckin(conn, "venue-b", 10);
    server.handleSeatCheckin(conn, "venue-c", 10);

    const checkins = server.getSeatCheckins();
    expect(checkins.size).toBe(1);
    expect(checkins.get(conn.id)?.venueId).toBe("venue-c");

    // Only venue-c should have count > 0
    const messages = server.getBroadcastMessages();
    const venueAUpdates = messages.filter(
      (m) =>
        JSON.parse(m).venueId === "venue-a" &&
        JSON.parse(m).type === "seat_update",
    );
    const venueBUpdates = messages.filter(
      (m) =>
        JSON.parse(m).venueId === "venue-b" &&
        JSON.parse(m).type === "seat_update",
    );
    const venueCUpdates = messages.filter(
      (m) =>
        JSON.parse(m).venueId === "venue-c" &&
        JSON.parse(m).type === "seat_update",
    );

    const finalVenueACount =
      venueAUpdates.length > 0
        ? JSON.parse(venueAUpdates[venueAUpdates.length - 1]).count
        : 0;
    const finalVenueBCount =
      venueBUpdates.length > 0
        ? JSON.parse(venueBUpdates[venueBUpdates.length - 1]).count
        : 0;
    const finalVenueCCount =
      venueCUpdates.length > 0
        ? JSON.parse(venueCUpdates[venueCUpdates.length - 1]).count
        : 0;

    expect(finalVenueACount).toBe(0);
    expect(finalVenueBCount).toBe(0);
    expect(finalVenueCCount).toBe(1);
  });

  test("should handle concurrent checkin and checkout for same connection", () => {
    // Interleaved: checkin -> checkin (different venue) -> checkout -> checkin
    server.handleSeatCheckin(conn, "venue-a", 10);
    server.handleSeatCheckin(conn, "venue-b", 10);
    server.handleSeatCheckout(conn);
    server.handleSeatCheckin(conn, "venue-c", 10);

    const checkins = server.getSeatCheckins();
    expect(checkins.size).toBe(1);
    expect(checkins.get(conn.id)?.venueId).toBe("venue-c");

    const messages = server.getBroadcastMessages();
    const venueCUpdates = messages.filter(
      (m) =>
        JSON.parse(m).venueId === "venue-c" &&
        JSON.parse(m).type === "seat_update",
    );
    expect(venueCUpdates.length).toBeGreaterThanOrEqual(1);
  });

  test("version increments on each modification", () => {
    server.handleSeatCheckin(conn, "venue-a", 10);
    let checkin = server.getSeatCheckins().get(conn.id);
    const version1 = checkin?.version;

    server.handleSeatCheckin(conn, "venue-b", 10);
    checkin = server.getSeatCheckins().get(conn.id);
    const version2 = checkin?.version;

    server.handleSeatCheckin(conn, "venue-c", 10);
    checkin = server.getSeatCheckins().get(conn.id);
    const version3 = checkin?.version;

    expect(version1).toBe(1);
    expect(version2).toBe(2);
    expect(version3).toBe(3);
  });

  test("should ignore checkout when no check-in exists", () => {
    server.handleSeatCheckout(conn);
    const checkins = server.getSeatCheckins();
    expect(checkins.size).toBe(0);
  });
});
