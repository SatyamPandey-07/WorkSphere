import WorkspaceServer from "../server";
import type * as Party from "partykit/server";

// Mock verifyToken
jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "test-user-id" }),
}));

// Mock y-partykit
jest.mock("y-partykit", () => ({
  onConnect: jest.fn(),
}));

describe("WorkspaceServer Heartbeat & Ghost Cursor Pruning", () => {
  let mockRoom: Party.Room;
  let mockConn: Party.Connection;
  let server: WorkspaceServer;

  beforeEach(() => {
    jest.useFakeTimers();

    mockConn = {
      id: "conn-1",
      state: {},
      setState: jest.fn((state) => {
        mockConn.state = { ...mockConn.state, ...state };
      }),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockRoom = {
      id: "test-room",
      getConnection: jest.fn((id) => (id === "conn-1" ? mockConn : undefined)),
      broadcast: jest.fn(),
    } as unknown as Party.Room;

    server = new WorkspaceServer(mockRoom);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should ping inactive connections after 10s and disconnect after 30s", async () => {
    const ctx = { request: { url: "http://localhost?token=fake" } } as any;

    await server.onConnect(mockConn, ctx);

    // Initial state: lastPong is set.
    // Advance time by 15s - should trigger a ping
    jest.advanceTimersByTime(15000);

    expect(mockConn.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "ping" }),
    );

    // Send a cursor event to register the name
    server.onMessage(
      JSON.stringify({ type: "cursor", name: "Alice" }),
      mockConn,
    );

    // No pong received. Advance time by another 30s. Total time > 30s.
    jest.advanceTimersByTime(30000);

    // It should broadcast peer-leave with name "Alice" and close connection.
    expect(mockRoom.broadcast).toHaveBeenCalledWith(
      JSON.stringify({ type: "peer-leave", name: "Alice" }),
    );
    expect(mockConn.close).toHaveBeenCalled();
  });

  it("should keep connection alive if pong is received", async () => {
    const ctx = { request: { url: "http://localhost" } } as any;
    await server.onConnect(mockConn, ctx);

    jest.advanceTimersByTime(15000);
    expect(mockConn.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "ping" }),
    );

    // Client responds with pong
    server.onMessage(JSON.stringify({ type: "pong" }), mockConn);

    jest.advanceTimersByTime(20000);
    // Since pong was received, it should not close
    expect(mockConn.close).not.toHaveBeenCalled();
    // It should send another ping because 20s passed since pong
    expect(mockConn.send).toHaveBeenCalledTimes(2);
  });
});
