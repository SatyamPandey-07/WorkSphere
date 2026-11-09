import WorkspaceServer, { type PresenceUser } from "../server";
import type * as Party from "partykit/server";

// Mock verifyToken
jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "test-user-id" }),
}));

// Mock y-partykit
jest.mock("y-partykit", () => ({
  onConnect: jest.fn(),
}));

describe("WorkspaceServer Active Typing Presence Protocol (#3438)", () => {
  let mockRoom: Party.Room;
  let mockConn1: Party.Connection;
  let mockConn2: Party.Connection;
  let server: WorkspaceServer;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.useFakeTimers();

    process.env = {
      ...originalEnv,
      PARTYKIT_AUTH_SECRET: "secret",
      NEXT_PUBLIC_APP_URL: "http://app",
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ role: "EDITOR", member: true }),
    }) as unknown as typeof fetch;

    mockConn1 = {
      id: "conn-1",
      state: { userId: "user-1", name: "Alice" },
      setState: jest.fn((state) => {
        mockConn1.state = { ...mockConn1.state, ...state };
      }),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockConn2 = {
      id: "conn-2",
      state: { userId: "user-2", name: "Bob" },
      setState: jest.fn((state) => {
        mockConn2.state = { ...mockConn2.state, ...state };
      }),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    const connections = new Map<string, Party.Connection>([
      ["conn-1", mockConn1],
      ["conn-2", mockConn2],
    ]);

    mockRoom = {
      id: "folder-notes-folder-123",
      getConnection: jest.fn((id) => connections.get(id)),
      broadcast: jest.fn(),
    } as unknown as Party.Room;

    server = new WorkspaceServer(mockRoom);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
  });

  it("handles presence_update message serialization and broadcasts to peers", () => {
    const presencePayload = {
      type: "presence_update",
      userId: "user-1",
      userName: "Alice",
      avatarUrl: "https://example.com/avatar.png",
      cursorPosition: 12,
      isTyping: true,
      lastActive: Date.now(),
    };

    server.onMessage(JSON.stringify(presencePayload), mockConn1);

    const activePresence = server.getRoomPresence();
    expect(activePresence).toHaveLength(1);
    expect(activePresence[0]).toMatchObject({
      userId: "user-1",
      userName: "Alice",
      avatarUrl: "https://example.com/avatar.png",
      cursorPosition: 12,
      isTyping: true,
    });

    // Should broadcast to other peers excluding sender
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      expect.stringContaining('"type":"presence_update"'),
      ["conn-1"],
    );

    const broadcastMessage = JSON.parse(
      (mockRoom.broadcast as jest.Mock).mock.calls[0][0],
    );
    expect(broadcastMessage).toMatchObject({
      type: "presence_update",
      userId: "user-1",
      userName: "Alice",
      isTyping: true,
      connId: "conn-1",
    });
  });

  it("handles presence_heartbeat and refreshes user active state", () => {
    // 1. Initial presence update
    server.onMessage(
      JSON.stringify({
        type: "presence_update",
        userId: "user-1",
        userName: "Alice",
        cursorPosition: 0,
        isTyping: false,
      }),
      mockConn1,
    );

    const initialActive = server.getRoomPresence()[0].lastActive;

    // Advance time by 5 seconds
    jest.advanceTimersByTime(5000);

    // 2. Client sends presence heartbeat every 5s while active
    server.onMessage(
      JSON.stringify({
        type: "presence_heartbeat",
        cursorPosition: 25,
        isTyping: true,
      }),
      mockConn1,
    );

    const updated = server.getRoomPresence()[0];
    expect(updated.cursorPosition).toBe(25);
    expect(updated.isTyping).toBe(true);
    expect(updated.lastActive).toBeGreaterThan(initialActive);
  });

  it("responds to request_presence with current room presence list", () => {
    // Register Alice
    server.onMessage(
      JSON.stringify({
        type: "presence_update",
        userId: "user-1",
        userName: "Alice",
        cursorPosition: 5,
        isTyping: false,
      }),
      mockConn1,
    );

    // Bob requests presence state
    server.onMessage(
      JSON.stringify({
        type: "request_presence",
      }),
      mockConn2,
    );

    expect(mockConn2.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"presence_state"'),
    );

    const sentState = JSON.parse(
      (mockConn2.send as jest.Mock).mock.calls[0][0],
    );
    expect(sentState.type).toBe("presence_state");
    expect(sentState.users).toHaveLength(1);
    expect(sentState.users[0].userId).toBe("user-1");
  });

  it("sends existing presence state to new clients onConnect", async () => {
    // Register Alice first
    server.onMessage(
      JSON.stringify({
        type: "presence_update",
        userId: "user-1",
        userName: "Alice",
        cursorPosition: null,
        isTyping: false,
      }),
      mockConn1,
    );

    const ctx = {
      request: { url: "http://localhost?token=fake" },
    } as any;

    await server.onConnect(mockConn2, ctx);

    // mockConn2 should have received presence_state
    expect(mockConn2.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"presence_state"'),
    );
  });

  it("broadcasts presence_remove when connection closes", () => {
    // Register Alice
    server.onMessage(
      JSON.stringify({
        type: "presence_update",
        userId: "user-1",
        userName: "Alice",
        cursorPosition: 10,
        isTyping: true,
      }),
      mockConn1,
    );

    expect(server.getRoomPresence()).toHaveLength(1);

    // Alice drops connection
    server.onClose(mockConn1);

    // Presence list should be pruned
    expect(server.getRoomPresence()).toHaveLength(0);

    // Should broadcast presence_remove to room
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      JSON.stringify({
        type: "presence_remove",
        userId: "user-1",
        userName: "Alice",
        connId: "conn-1",
      }),
    );
  });

  it("prunes presence and broadcasts presence_remove when inactive > 15s", () => {
    const startTime = Date.now();
    // Register Alice
    server.onMessage(
      JSON.stringify({
        type: "presence_update",
        userId: "user-1",
        userName: "Alice",
        cursorPosition: null,
        isTyping: false,
        lastActive: startTime,
      }),
      mockConn1,
    );

    expect(server.getRoomPresence()).toHaveLength(1);

    // Advance by 10s: should NOT be pruned (inactivity <= 15s)
    jest.advanceTimersByTime(10000);
    expect(server.getRoomPresence()).toHaveLength(1);

    // Advance past 15s threshold to next 5s sweep (20s total elapsed)
    jest.advanceTimersByTime(10000);

    expect(server.getRoomPresence()).toHaveLength(0);
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      JSON.stringify({
        type: "presence_remove",
        userId: "user-1",
        userName: "Alice",
        connId: "conn-1",
      }),
    );
  });
});
