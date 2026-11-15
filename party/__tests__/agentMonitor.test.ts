import AgentMonitorRoom, { AgentHeartbeatPayload } from "../agentMonitor.room";

describe("AgentMonitorRoom PartyKit Server", () => {
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

    roomInstance = new AgentMonitorRoom(mockRoom);
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
  });
});
