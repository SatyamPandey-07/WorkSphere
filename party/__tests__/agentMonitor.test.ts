import AgentMonitorRoom, {
  AgentHeartbeatPayload,
  DEFAULT_AGENT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_AGENT_PURGE_TTL_MS,
} from "../agentMonitor.room";

describe("AgentMonitorRoom PartyKit Server (#7926)", () => {
  let mockRoom: any;
  let mockConnection: any;
  let roomInstance: AgentMonitorRoom;

  beforeEach(() => {
    mockConnection = {
      id: "conn-123",
      send: jest.fn(),
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
});
