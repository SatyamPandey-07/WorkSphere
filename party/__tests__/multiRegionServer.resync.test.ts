import MultiRegionWorkspaceServer from "../multiRegionServer";
import type * as Party from "partykit/server";

// Mock verifyToken
jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn().mockResolvedValue({ sub: "test-user-id" }),
}));

// Mock y-partykit
jest.mock("y-partykit", () => ({
  onConnect: jest.fn(),
}));

// Mock EdgeMeshSync
jest.mock("../../src/lib/edge/edgeMeshSync", () => {
  return {
    EdgeMeshSync: jest.fn().mockImplementation(() => ({
      setGetLocalStateFn: jest.fn(),
      setOnRemoteStateReceived: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    })),
  };
});

describe("MultiRegionWorkspaceServer Resynchronization & Replay (#3363)", () => {
  let mockRoom: Party.Room;
  let mockConn: Party.Connection;
  let server: MultiRegionWorkspaceServer;
  let broadcastedMessages: string[];

  beforeEach(() => {
    broadcastedMessages = [];

    mockConn = {
      id: "conn-1",
      state: { userId: "test-user-id", role: "EDITOR" },
      setState: jest.fn((state) => {
        mockConn.state = { ...mockConn.state, ...state };
      }),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockRoom = {
      id: "room-multi-1",
      getConnection: jest.fn((id) => (id === "conn-1" ? mockConn : undefined)),
      broadcast: jest.fn((msg) => {
        broadcastedMessages.push(msg);
      }),
    } as unknown as Party.Room;

    server = new MultiRegionWorkspaceServer(mockRoom);
  });

  it("assigns increasing sequence numbers and attaches epoch and messageId to session events", () => {
    const msg1 = JSON.stringify({
      type: "new-message",
      message: { id: "msg-1", text: "Hello" },
    });
    server.onMessage(msg1, mockConn);

    expect(broadcastedMessages).toHaveLength(1);
    const parsed1 = JSON.parse(broadcastedMessages[0]);
    expect(parsed1.sequenceId).toBe(1);
    expect(parsed1.epoch).toBeDefined();
    expect(parsed1.messageId).toBe("msg-1");

    const msg2 = JSON.stringify({
      type: "new-message",
      message: { id: "msg-2", text: "World" },
    });
    server.onMessage(msg2, mockConn);

    expect(broadcastedMessages).toHaveLength(2);
    const parsed2 = JSON.parse(broadcastedMessages[1]);
    expect(parsed2.sequenceId).toBe(2);
    expect(parsed2.epoch).toBe(parsed1.epoch);
  });

  it("deduplicates messages with the same messageId across connection flaps", () => {
    const msg = JSON.stringify({
      type: "new-message",
      messageId: "dedup-msg-123",
      content: "Important message",
    });

    // First transmission
    server.onMessage(msg, mockConn);
    expect(broadcastedMessages).toHaveLength(1);

    // Flap retry with same messageId
    server.onMessage(msg, mockConn);
    expect(broadcastedMessages).toHaveLength(1); // Not broadcast again!

    // Verify sender received msg_ack with duplicate status
    expect(mockConn.send).toHaveBeenCalledWith(
      expect.stringContaining('"status":"duplicate"'),
    );
  });

  it("handles sync_request: sends only missed events in exact order", () => {
    // Generate events 1, 2, 3, 4
    for (let i = 1; i <= 4; i++) {
      server.onMessage(
        JSON.stringify({
          type: "new-message",
          messageId: `seq-msg-${i}`,
          content: `Content ${i}`,
        }),
        mockConn,
      );
    }
    expect(broadcastedMessages).toHaveLength(4);

    const clientConn = {
      id: "conn-reconnecting",
      state: {},
      send: jest.fn(),
    } as unknown as Party.Connection;

    // Client requests catch-up after lastSeq = 2
    server.onMessage(
      JSON.stringify({
        type: "sync_request",
        lastSeq: 2,
      }),
      clientConn,
    );

    expect(clientConn.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"sync_replay"/),
    );

    const replayRaw = (clientConn.send as jest.Mock).mock.calls[0][0];
    const replay = JSON.parse(replayRaw);

    expect(replay.fromSeq).toBe(3);
    expect(replay.toSeq).toBe(4);
    expect(replay.events).toHaveLength(2);
    expect(replay.events[0].sequenceId).toBe(3);
    expect(replay.events[1].sequenceId).toBe(4);
  });

  it("handles sync_request: sends sync_ack without replay when client is already synchronized", () => {
    server.onMessage(
      JSON.stringify({
        type: "new-message",
        messageId: "synced-msg-1",
        content: "Hi",
      }),
      mockConn,
    );

    const clientConn = {
      id: "conn-synced",
      state: {},
      send: jest.fn(),
    } as unknown as Party.Connection;

    server.onMessage(
      JSON.stringify({
        type: "sync_request",
        lastSeq: 1,
      }),
      clientConn,
    );

    expect(clientConn.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"sync_ack"/),
    );
    const ack = JSON.parse((clientConn.send as jest.Mock).mock.calls[0][0]);
    expect(ack.status).toBe("synchronized");
    expect(ack.latestSeq).toBe(1);
  });

  it("handles sync_request: falls back to full snapshot when history is unavailable", () => {
    // Generate 5 events
    for (let i = 1; i <= 5; i++) {
      server.onMessage(
        JSON.stringify({
          type: "new-message",
          messageId: `ev-${i}`,
          content: `Item ${i}`,
        }),
        mockConn,
      );
    }

    // Force prune history buffer to simulate very old client
    (server as any).eventHistory = (server as any).eventHistory.slice(-2); // only has seq 4, 5

    const clientConn = {
      id: "conn-ancient",
      state: {},
      send: jest.fn(),
    } as unknown as Party.Connection;

    // Client requests lastSeq = 1 (events 2 and 3 are missing from history)
    server.onMessage(
      JSON.stringify({
        type: "sync_request",
        lastSeq: 1,
      }),
      clientConn,
    );

    expect(clientConn.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"sync_fallback"/),
    );
    const fallback = JSON.parse((clientConn.send as jest.Mock).mock.calls[0][0]);
    expect(fallback.reason).toBe("history_unavailable");
    expect(fallback.latestSeq).toBe(5);
  });

  it("handles sync_request: falls back to full snapshot on epoch mismatch", () => {
    const clientConn = {
      id: "conn-old-epoch",
      state: {},
      send: jest.fn(),
    } as unknown as Party.Connection;

    server.onMessage(
      JSON.stringify({
        type: "sync_request",
        lastSeq: 10,
        epoch: 999999999, // different epoch
      }),
      clientConn,
    );

    expect(clientConn.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"sync_fallback"/),
    );
    const fallback = JSON.parse((clientConn.send as jest.Mock).mock.calls[0][0]);
    expect(fallback.reason).toBe("epoch_mismatch");
  });

  it("replays missed events on connect if lastSeq is passed in URL query", async () => {
    // Generate 2 events
    server.onMessage(
      JSON.stringify({ type: "new-message", messageId: "e-1", text: "1" }),
      mockConn,
    );
    server.onMessage(
      JSON.stringify({ type: "new-message", messageId: "e-2", text: "2" }),
      mockConn,
    );

    const reconnectingConn = {
      id: "conn-url-reconnect",
      state: {},
      setState: jest.fn(),
      send: jest.fn(),
      addEventListener: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    const ctx = {
      request: {
        url: "https://us-east.worksphere.partykit.dev?lastSeq=1",
        headers: new Headers(),
      },
    } as unknown as Party.ConnectionContext;

    await server.onConnect(reconnectingConn, ctx);

    // Verify sync_replay was sent for event 2
    expect(reconnectingConn.send).toHaveBeenCalledWith(
      expect.stringMatching(/"type":"sync_replay"/),
    );
    const replayCall = (reconnectingConn.send as jest.Mock).mock.calls.find(
      (c) => c[0].includes("sync_replay"),
    );
    expect(replayCall).toBeDefined();
    const replay = JSON.parse(replayCall[0]);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0].sequenceId).toBe(2);
  });
});
