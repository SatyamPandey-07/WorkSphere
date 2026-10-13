import SpatialVoiceRoom from "@/party/spatialVoice.room";

interface MockConnection {
  id: string;
  sentMessages: string[];
  closed: boolean;
  send: (msg: string | ArrayBuffer) => void;
  close: () => void;
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
    close() {
      conn.closed = true;
    },
  };
  return conn;
}

function createMockRoom() {
  const connections = new Map<string, MockConnection>();
  const broadcasts: { message: string; exclude?: string[] }[] = [];

  const room = {
    id: "test-voice-room",
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

describe("SpatialVoiceRoom Split-Brain Reconnection (#5612)", () => {
  it("evicts stale connection when duplicate userId reconnects via URL query param", async () => {
    const { room, connections, broadcasts } = createMockRoom();
    const server = new SpatialVoiceRoom(room as any);

    const conn1 = createMockConnection("conn-session-1");
    connections.set("conn-session-1", conn1);

    // Initial connection from user-alice
    await server.onConnect(conn1 as any, {
      request: { url: "https://worksphere.party/party/voice?userId=user-alice" },
    } as any);

    expect(server.getPeerCount()).toBe(1);
    expect(server.getActiveConnectionForUser("user-alice")).toBe("conn-session-1");
    expect(server.getUserForConnection("conn-session-1")).toBe("user-alice");
    expect(conn1.closed).toBe(false);

    // Network blip happens: user-alice reconnects with new connection ID conn-session-2
    // while conn-session-1 has not timed out yet
    const conn2 = createMockConnection("conn-session-2");
    connections.set("conn-session-2", conn2);

    await server.onConnect(conn2 as any, {
      request: { url: "https://worksphere.party/party/voice?userId=user-alice" },
    } as any);

    // Stale connection conn1 must be closed immediately
    expect(conn1.closed).toBe(true);
    const sessionReplacedMsg = conn1.sentMessages.find((m) =>
      m.includes("SESSION_REPLACED")
    );
    expect(sessionReplacedMsg).toBeDefined();

    // Stale connection must be unregistered, only 1 peer entry for user-alice should exist
    expect(server.getPeerCount()).toBe(1);
    expect(server.getActiveConnectionForUser("user-alice")).toBe("conn-session-2");
    expect(server.getUserForConnection("conn-session-2")).toBe("user-alice");
    expect(server.getUserForConnection("conn-session-1")).toBeUndefined();

    // Verify broadcast notified peers of stale peer leaving
    const peerLeftBroadcast = broadcasts.find((b) =>
      b.message.includes("PEER_LEFT") && b.message.includes("conn-session-1")
    );
    expect(peerLeftBroadcast).toBeDefined();
  });

  it("evicts stale connection when duplicate userId sends AUTH message", async () => {
    const { room, connections } = createMockRoom();
    const server = new SpatialVoiceRoom(room as any);

    const conn1 = createMockConnection("conn-bob-1");
    connections.set("conn-bob-1", conn1);

    await server.onConnect(conn1 as any, {} as any);
    await server.onMessage(
      JSON.stringify({ type: "AUTH", userId: "user-bob" }),
      conn1 as any
    );

    expect(server.getActiveConnectionForUser("user-bob")).toBe("conn-bob-1");

    // Reconnecting connection sends AUTH for user-bob
    const conn2 = createMockConnection("conn-bob-2");
    connections.set("conn-bob-2", conn2);

    await server.onConnect(conn2 as any, {} as any);
    await server.onMessage(
      JSON.stringify({ type: "AUTH", userId: "user-bob" }),
      conn2 as any
    );

    // conn1 must be evicted and closed
    expect(conn1.closed).toBe(true);
    expect(server.getPeerCount()).toBe(1);
    expect(server.getActiveConnectionForUser("user-bob")).toBe("conn-bob-2");
  });

  it("cleans up user mapping upon intentional disconnect", async () => {
    const { room, connections } = createMockRoom();
    const server = new SpatialVoiceRoom(room as any);

    const conn = createMockConnection("conn-charlie");
    connections.set("conn-charlie", conn);

    await server.onConnect(conn as any, {
      request: { url: "https://worksphere.party/party/voice?userId=user-charlie" },
    } as any);

    expect(server.getActiveConnectionForUser("user-charlie")).toBe("conn-charlie");

    await server.onDisconnect(conn as any);

    expect(server.getActiveConnectionForUser("user-charlie")).toBeUndefined();
    expect(server.getUserForConnection("conn-charlie")).toBeUndefined();
    expect(server.getPeerCount()).toBe(0);
  });
});
