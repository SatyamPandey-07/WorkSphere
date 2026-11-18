import AgentMonitorRoom, {
  AgentHeartbeatPayload,
  DEFAULT_AGENT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_AGENT_PURGE_TTL_MS,
} from "../agentMonitor.room";
import { verifyToken } from "@clerk/backend";

// Mock verifyToken for Clerk JWT authentication
jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "test-user-id" }),
}));

describe("AgentMonitorRoom PartyKit Server (#7926, #7951)", () => {
  let mockRoom: any;
  let mockConnection: any;
  let roomInstance: AgentMonitorRoom;

  beforeEach(() => {
    jest.clearAllMocks();
    (verifyToken as jest.Mock).mockResolvedValue({ sub: "test-user-id" });

    mockConnection = {
      id: "conn-123",
      readyState: 1, // WebSocket.OPEN
      send: jest.fn(),
      setState: jest.fn(),
      close: jest.fn(),
    };

    mockRoom = {
      getConnections: jest.fn().mockReturnValue([mockConnection]),
      broadcast: jest.fn(),
    };

    roomInstance = new AgentMonitorRoom(mockRoom, {
      heartbeatTimeoutMs: 10_000,
      purgeTimeoutMs: 50_000,
    });
  });

  it("sends initial agent states and presence snapshot on client connect", async () => {
    await roomInstance.onConnect(mockConnection, {} as any);

    expect(mockConnection.send).toHaveBeenCalledTimes(1);
    const sentData = JSON.parse(mockConnection.send.mock.calls[0][0]);
    expect(sentData.type).toBe("INITIAL_STATE");
    expect(sentData.payload.connectedClients).toBe(1);
  });

  it("broadcasts agent state transitions across connected clients on heartbeat", async () => {
    const heartbeat: AgentHeartbeatPayload = {
      agentId: "agent-007",
      agentName: "Code Reviewer",
      state: "EXECUTING",
      timestamp: Date.now(),
    };

    const message = JSON.stringify({
      type: "HEARTBEAT",
      payload: heartbeat,
    });

    await roomInstance.onMessage(message, mockConnection);

    expect(mockRoom.broadcast).toHaveBeenCalledTimes(1);
    const broadcastedData = JSON.parse(mockRoom.broadcast.mock.calls[0][0]);
    expect(broadcastedData.type).toBe("AGENT_HEARTBEAT_UPDATE");
    expect(broadcastedData.payload.state).toBe("EXECUTING");
    expect(roomInstance.getAgentStates()).toHaveLength(1);
  });

  it("transitions active agent to TERMINATED on UNSUBSCRIBE message", async () => {
    const heartbeat: AgentHeartbeatPayload = {
      agentId: "agent-008",
      state: "PLANNING",
      timestamp: Date.now(),
    };

    await roomInstance.onMessage(
      JSON.stringify({ type: "HEARTBEAT", payload: heartbeat }),
      mockConnection
    );

    mockRoom.broadcast.mockClear();

    await roomInstance.onMessage(
      JSON.stringify({ type: "UNSUBSCRIBE", agentId: "agent-008" }),
      mockConnection
    );

    expect(mockRoom.broadcast).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockRoom.broadcast.mock.calls[0][0]);
    expect(payload.type).toBe("AGENT_HEARTBEAT_UPDATE");
    expect(payload.payload.state).toBe("TERMINATED");
  });

  it("marks agent OFFLINE when connection disconnects on onClose", async () => {
    const heartbeat: AgentHeartbeatPayload = {
      agentId: "agent-009",
      state: "EXECUTING",
      timestamp: Date.now(),
    };

    await roomInstance.onMessage(
      JSON.stringify({ type: "HEARTBEAT", payload: heartbeat }),
      mockConnection
    );

    mockRoom.broadcast.mockClear();

    await roomInstance.onClose(mockConnection);

    expect(mockRoom.broadcast).toHaveBeenCalled();
    const calls = mockRoom.broadcast.mock.calls.map((c: any) => JSON.parse(c[0]));
    const stateUpdate = calls.find((c: any) => c.type === "AGENT_HEARTBEAT_UPDATE");
    expect(stateUpdate).toBeDefined();
    expect(stateUpdate.payload.state).toBe("OFFLINE");
  });

  it("prunes timed-out active agents to OFFLINE during sweep", () => {
    const now = 100_000;
    const heartbeat: AgentHeartbeatPayload = {
      agentId: "agent-stale",
      state: "PLANNING",
      timestamp: now - 15_000, // 15s ago (> 10s timeout)
    };

    (roomInstance as any).agentStates.set("agent-stale", heartbeat);

    const { expired, purged } = roomInstance.pruneStaleAgents(now);
    expect(expired).toContain("agent-stale");
    expect(purged).toHaveLength(0);

    const updated = roomInstance.getAgentStates().find((a) => a.agentId === "agent-stale");
    expect(updated?.state).toBe("OFFLINE");
  });

  it("purges dead agents exceeding purgeTimeoutMs during sweep", () => {
    const now = 100_000;
    const heartbeat: AgentHeartbeatPayload = {
      agentId: "agent-dead",
      state: "TERMINATED",
      timestamp: now - 60_000, // 60s ago (> 50s purge timeout)
    };

    (roomInstance as any).agentStates.set("agent-dead", heartbeat);

    const { expired, purged } = roomInstance.pruneStaleAgents(now);
    expect(purged).toContain("agent-dead");
    expect(roomInstance.getAgentStates()).toHaveLength(0);
  });

  it("handles PRUNE_STALE message and replies with prune summary", async () => {
    await roomInstance.onMessage(
      JSON.stringify({ type: "PRUNE_STALE" }),
      mockConnection
    );

    expect(mockConnection.send).toHaveBeenCalledTimes(1);
    const reply = JSON.parse(mockConnection.send.mock.calls[0][0]);
    expect(reply.type).toBe("PRUNE_RESULT");
    expect(reply.payload).toHaveProperty("expired");
    expect(reply.payload).toHaveProperty("purged");
  });

  it("sends structured ERROR message on invalid JSON payload", async () => {
    await roomInstance.onMessage("invalid-not-json", mockConnection);

    expect(mockConnection.send).toHaveBeenCalledTimes(1);
    const reply = JSON.parse(mockConnection.send.mock.calls[0][0]);
    expect(reply.type).toBe("ERROR");
    expect(reply.message).toBe("Invalid message payload format");
  });

  describe("Authentication Handshake and Connection Close Handling (#7951)", () => {
    it("successfully authenticates and initializes connection state when socket remains open", async () => {
      const mockCtx: any = {
        request: {
          url: "https://example.partykit.dev/parties/agent-monitor/room-1?token=valid-jwt-token&agentId=agent-007",
        },
      };

      await roomInstance.onConnect(mockConnection, mockCtx);

      expect(verifyToken).toHaveBeenCalledWith("valid-jwt-token", {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      expect(mockConnection.setState).toHaveBeenCalledWith({
        authenticated: true,
        userId: "test-user-id",
        agentId: "agent-007",
      });
      expect(mockConnection.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockConnection.send.mock.calls[0][0]);
      expect(sentData.type).toBe("INITIAL_STATE");
    });

    it("aborts handshake without setting state or sending snapshot if socket closes before JWT verification resolves", async () => {
      let resolveAuth: (value: any) => void;
      const authPromise = new Promise((resolve) => {
        resolveAuth = resolve;
      });
      (verifyToken as jest.Mock).mockReturnValue(authPromise);

      const mockCtx: any = {
        request: {
          url: "https://example.partykit.dev/parties/agent-monitor/room-1?token=jwt-in-flight&agentId=agent-early-close",
        },
      };

      const connectPromise = roomInstance.onConnect(mockConnection, mockCtx);

      // Socket disconnects abruptly while verification is in-flight (readyState changes to 3 / CLOSED)
      mockConnection.readyState = 3;

      // Resolve verification after socket closed
      resolveAuth!({ sub: "user-delayed" });
      await connectPromise;

      // Ensure state was not set and no snapshot was sent to closed connection
      expect(mockConnection.setState).not.toHaveBeenCalled();
      expect(mockConnection.send).not.toHaveBeenCalled();
      expect(roomInstance.getAgentStates()).toHaveLength(0);
    });

    it("does not dispatch presence update or heartbeat update if closed socket was unauthenticated", async () => {
      let resolveAuth: (value: any) => void;
      const authPromise = new Promise((resolve) => {
        resolveAuth = resolve;
      });
      (verifyToken as jest.Mock).mockReturnValue(authPromise);

      const mockCtx: any = {
        request: {
          url: "https://example.partykit.dev/parties/agent-monitor/room-1?token=jwt-race",
        },
      };

      const connectPromise = roomInstance.onConnect(mockConnection, mockCtx);

      // Simulate connection close during async auth
      mockConnection.readyState = 3;
      resolveAuth!({ sub: "user-race" });
      await connectPromise;

      // Now close event arrives
      mockRoom.broadcast.mockClear();
      await roomInstance.onClose(mockConnection);

      // Since the agentId was never mapped to this connection, no AGENT_HEARTBEAT_UPDATE should fire
      const calls = mockRoom.broadcast.mock.calls.map((c: any) => JSON.parse(c[0]));
      const agentUpdates = calls.filter((c: any) => c.type === "AGENT_HEARTBEAT_UPDATE");
      expect(agentUpdates).toHaveLength(0);
    });

    it("closes socket with 4001 when token verification rejects", async () => {
      (verifyToken as jest.Mock).mockRejectedValue(new Error("Invalid or expired token"));

      const mockCtx: any = {
        request: {
          url: "https://example.partykit.dev/parties/agent-monitor/room-1?token=bad-token",
        },
      };

      await roomInstance.onConnect(mockConnection, mockCtx);

      expect(mockConnection.close).toHaveBeenCalledWith(
        4001,
        "Unauthorized: Token verification failed"
      );
      expect(mockConnection.setState).not.toHaveBeenCalled();
      expect(mockConnection.send).not.toHaveBeenCalled();
    });

    it("does not access undefined connection context or throw if socket closes during verification", async () => {
      let resolveAuth: (value: any) => void;
      (verifyToken as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAuth = resolve;
          })
      );

      const mockCtx: any = {
        request: {
          url: "https://example.partykit.dev/parties/agent-monitor/room-1?token=slow-token",
        },
      };

      const connectPromise = roomInstance.onConnect(mockConnection, mockCtx);

      mockConnection.readyState = 2; // CLOSING
      resolveAuth!({ sub: "slow-user" });

      await expect(connectPromise).resolves.not.toThrow();
      expect(mockConnection.setState).not.toHaveBeenCalled();
    });
  });
});
