import FocusRoomParty, {
  MAX_ROOM_PARTICIPANTS,
  MAX_CURSOR_BROADCAST_RATE_HZ,
  MIN_BROADCAST_INTERVAL_MS,
  CursorMessage,
} from "@/party/focusRoomParty";

interface MockConnection {
  id: string;
  sentMessages: string[];
  closed: boolean;
  closeCode?: number;
  closeReason?: string;
  send: (msg: string | ArrayBuffer) => void;
  close: (code?: number, reason?: string) => void;
}

function createMockConnection(id: string): MockConnection {
  const conn: MockConnection = {
    id,
    sentMessages: [],
    closed: false,
    send(msg: string | ArrayBuffer) {
      if (typeof msg === "string") {
        conn.sentMessages.push(msg);
      } else {
        conn.sentMessages.push("[ArrayBuffer]");
      }
    },
    close(code?: number, reason?: string) {
      conn.closed = true;
      conn.closeCode = code;
      conn.closeReason = reason;
    },
  };
  return conn;
}

function createMockRoom() {
  const connections = new Map<string, MockConnection>();
  const broadcasts: { message: string; exclude?: string[] }[] = [];

  const room = {
    id: "focus-room-test",
    connections,
    broadcast(message: string, exclude?: string[]) {
      broadcasts.push({ message, exclude });
    },
    getConnection(id: string) {
      return connections.get(id) || null;
    },
    getConnections() {
      return connections.values();
    },
  };

  return { room, broadcasts, connections };
}

describe("FocusRoomParty Distributed Cursor Presence & Participant Cap (#7570)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("enforces maximum 25 participants and rejects 26th connection with room_full", async () => {
    const { room, broadcasts } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    // Connect 25 participants
    const connections: MockConnection[] = [];
    for (let i = 1; i <= 25; i++) {
      const conn = createMockConnection(`user-${i}`);
      connections.push(conn);
      await server.onConnect(conn as any, {} as any);
      expect(conn.closed).toBe(false);
    }

    expect(server.getParticipantCount()).toBe(25);

    // Attempt 26th participant
    const conn26 = createMockConnection("user-26");
    await server.onConnect(conn26 as any, {} as any);

    expect(conn26.closed).toBe(true);
    expect(conn26.closeCode).toBe(4003);
    const roomFullMsg = conn26.sentMessages.find((m) => {
      const parsed = JSON.parse(m);
      return parsed.type === "room_full";
    });
    expect(roomFullMsg).toBeDefined();
    expect(server.getParticipantCount()).toBe(25);

    // If one leaves, a new participant can join
    await server.onClose(connections[0] as any);
    expect(server.getParticipantCount()).toBe(24);

    const conn27 = createMockConnection("user-27");
    await server.onConnect(conn27 as any, {} as any);
    expect(conn27.closed).toBe(false);
    expect(server.getParticipantCount()).toBe(25);
  });

  it("broadcasts valid initial full cursor position with identity and metadata", async () => {
    const { room, broadcasts } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    const conn = createMockConnection("alice");
    await server.onConnect(conn as any, {} as any);

    // Send cursor position
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: 150,
        y: 250,
        metadata: { name: "Alice", color: "#3B82F6" },
      }),
      conn as any
    );

    expect(broadcasts.length).toBe(1);
    const msg = JSON.parse(broadcasts[0].message);
    expect(msg.type).toBe("cursor_pos");
    expect(msg.id).toBe("alice");
    expect(msg.x).toBe(150);
    expect(msg.y).toBe(250);
    expect(msg.metadata).toEqual({ name: "Alice", color: "#3B82F6" });
    expect(broadcasts[0].exclude).toEqual(["alice"]);
  });

  it("compresses subsequent movement into delta broadcasts", async () => {
    const { room, broadcasts } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    const conn = createMockConnection("bob");
    await server.onConnect(conn as any, {} as any);

    // Initial position
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: 100,
        y: 100,
      }),
      conn as any
    );

    // Advance time past 30Hz window
    jest.advanceTimersByTime(40);

    // Move to (120, 110)
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: 120,
        y: 110,
      }),
      conn as any
    );

    expect(broadcasts.length).toBe(2);
    const deltaMsg = JSON.parse(broadcasts[1].message);
    expect(deltaMsg.type).toBe("cursor_delta");
    expect(deltaMsg.id).toBe("bob");
    expect(deltaMsg.dx).toBe(20);
    expect(deltaMsg.dy).toBe(10);
    expect(deltaMsg.seq).toBe(2);
  });

  it("handles incoming cursor_delta from client properly", async () => {
    const { room, broadcasts } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    const conn = createMockConnection("carol");
    await server.onConnect(conn as any, {} as any);

    // Set initial position
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: 200,
        y: 200,
      }),
      conn as any
    );

    jest.advanceTimersByTime(40);

    // Send delta
    await server.onMessage(
      JSON.stringify({
        type: "cursor_delta",
        dx: -15,
        dy: 25,
      }),
      conn as any
    );

    expect(broadcasts.length).toBe(2);
    const deltaMsg = JSON.parse(broadcasts[1].message);
    expect(deltaMsg.type).toBe("cursor_delta");
    expect(deltaMsg.dx).toBe(-15);
    expect(deltaMsg.dy).toBe(25);
    expect(server.getParticipant("carol")?.cursor).toEqual({ x: 185, y: 225 });
  });

  it("throttles rapid cursor broadcasts to max 30Hz", async () => {
    const { room, broadcasts } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    const conn = createMockConnection("dan");
    await server.onConnect(conn as any, {} as any);

    // Send 10 rapid cursor updates within 5ms (simulate 120Hz/240Hz mouse events)
    for (let i = 1; i <= 10; i++) {
      await server.onMessage(
        JSON.stringify({
          type: "cursor_pos",
          x: 100 + i * 5,
          y: 200 + i * 5,
        }),
        conn as any
      );
    }

    // Only 1 broadcast should have happened immediately
    expect(broadcasts.length).toBe(1);

    // Advance 35ms (one 30Hz interval)
    jest.advanceTimersByTime(35);

    // Throttled pending update should have fired with latest position
    expect(broadcasts.length).toBe(2);
    const lastBroadcast = JSON.parse(broadcasts[1].message);
    expect(lastBroadcast.type).toBe("cursor_delta");
    // total displacement from (105, 205) to (150, 250) is dx: 45, dy: 45
    expect(lastBroadcast.dx).toBe(45);
    expect(lastBroadcast.dy).toBe(45);
  });

  it("rejects non-finite, NaN, and invalid coordinates safely", async () => {
    const { room, broadcasts } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    const conn = createMockConnection("eve");
    await server.onConnect(conn as any, {} as any);

    // NaN coordinates
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: NaN,
        y: 100,
      }),
      conn as any
    );

    // Infinity coordinates
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: 100,
        y: Infinity,
      }),
      conn as any
    );

    // Non-number
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: "100",
        y: "200",
      }),
      conn as any
    );

    // No broadcasts should occur
    expect(broadcasts.length).toBe(0);
  });

  it("notifies remaining participants immediately on disconnect and cleans up state", async () => {
    const { room, broadcasts } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    const conn1 = createMockConnection("user-1");
    const conn2 = createMockConnection("user-2");
    await server.onConnect(conn1 as any, {} as any);
    await server.onConnect(conn2 as any, {} as any);

    expect(server.getParticipantCount()).toBe(2);

    // Disconnect user-1
    await server.onClose(conn1 as any);

    expect(server.getParticipantCount()).toBe(1);
    expect(server.getParticipant("user-1")).toBeUndefined();

    const leftMsg = broadcasts.find((b) => {
      const parsed = JSON.parse(b.message);
      return parsed.type === "participant_left" && parsed.id === "user-1";
    });
    expect(leftMsg).toBeDefined();
    expect(leftMsg?.exclude).toEqual(["user-1"]);
  });

  it("syncs existing participants when a new participant joins or requests sync", async () => {
    const { room } = createMockRoom();
    const server = new FocusRoomParty(room as any);

    const conn1 = createMockConnection("user-1");
    await server.onConnect(conn1 as any, {} as any);
    await server.onMessage(
      JSON.stringify({
        type: "cursor_pos",
        x: 300,
        y: 400,
        metadata: { name: "Player 1" },
      }),
      conn1 as any
    );

    const conn2 = createMockConnection("user-2");
    await server.onConnect(conn2 as any, {} as any);

    // conn2 should receive sync_participants containing user-1
    const syncMsg = conn2.sentMessages.find((m) => {
      const parsed = JSON.parse(m);
      return parsed.type === "sync_participants";
    });
    expect(syncMsg).toBeDefined();
    const parsed = JSON.parse(syncMsg!);
    expect(parsed.participants.length).toBe(1);
    expect(parsed.participants[0].id).toBe("user-1");
    expect(parsed.participants[0].cursor).toEqual({ x: 300, y: 400 });
  });
});
