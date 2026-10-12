import VpnMeshRoom from "@/party/vpnMesh.room";
import type * as Party from "partykit/server";

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
    id: "test-vpn-mesh-room",
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

function createMockPeerConnection(
  initialIceState: RTCIceConnectionState = "connected",
  initialConnState: RTCPeerConnectionState = "connected",
): RTCPeerConnection {
  const pc = {
    connectionState: initialConnState,
    iceConnectionState: initialIceState,
    close: jest.fn(() => {
      pc.connectionState = "closed";
      pc.iceConnectionState = "closed";
    }),
    onicecandidate: jest.fn(),
    oniceconnectionstatechange: null as any,
    onconnectionstatechange: null as any,
    ondatachannel: null as any,
    ontrack: null as any,
    onnegotiationneeded: null as any,
  } as unknown as RTCPeerConnection;

  return pc;
}

function createMockDataChannel(): RTCDataChannel {
  const dc = {
    readyState: "open" as RTCDataChannelState,
    close: jest.fn(() => {
      dc.readyState = "closed";
    }),
    onmessage: jest.fn(),
    onopen: jest.fn(),
    onclose: null as any,
    onerror: null as any,
  } as unknown as RTCDataChannel;

  return dc;
}

describe("VpnMeshRoom Peer Connection Cleanup", () => {
  it("verifies that disconnect events decrease active peer connection count to zero", async () => {
    const { room, connections } = createMockRoom();
    const server = new VpnMeshRoom(room as unknown as Party.Room);

    const conn1 = createMockConnection("conn-nomad-1");
    connections.set("conn-nomad-1", conn1);

    await server.onConnect(
      conn1 as unknown as Party.Connection,
      {
        request: {
          url: "https://worksphere.party/party/vpn?userId=user-nomad-1",
        },
      } as unknown as Party.ConnectionContext,
    );

    const mockPc = createMockPeerConnection();
    const mockDc = createMockDataChannel();

    server.registerPeerConnection("conn-nomad-1", mockPc, mockDc);

    // Initial state: 1 active peer connection and 1 connected peer
    expect(server.getActivePeerConnectionCount()).toBe(1);
    expect(server.getConnectedPeersCount()).toBe(1);
    expect(mockPc.close).not.toHaveBeenCalled();
    expect(mockDc.close).not.toHaveBeenCalled();

    // Abrupt disconnect (e.g. laptop lid closes)
    await server.onDisconnect(conn1 as unknown as Party.Connection);

    // Explicit cleanup assertions
    expect(mockPc.close).toHaveBeenCalledTimes(1);
    expect(mockDc.close).toHaveBeenCalledTimes(1);

    // Event listeners and message handlers are completely cleared
    expect(mockPc.onicecandidate).toBeNull();
    expect(mockPc.oniceconnectionstatechange).toBeNull();
    expect(mockPc.onconnectionstatechange).toBeNull();
    expect(mockPc.ondatachannel).toBeNull();
    expect(mockDc.onmessage).toBeNull();
    expect(mockDc.onopen).toBeNull();
    expect(mockDc.onclose).toBeNull();
    expect(mockDc.onerror).toBeNull();

    // Active peer connection count decreases to zero
    expect(server.getActivePeerConnectionCount()).toBe(0);
    expect(server.getConnectedPeersCount()).toBe(0);
  });

  it("verifies iceConnectionState 'failed' or 'closed' invokes peerConnection.close() and cleans up sockets", async () => {
    const { room, connections } = createMockRoom();
    const server = new VpnMeshRoom(room as unknown as Party.Room);

    const conn = createMockConnection("conn-nomad-2");
    connections.set("conn-nomad-2", conn);

    await server.onConnect(
      conn as unknown as Party.Connection,
      {
        request: {
          url: "https://worksphere.party/party/vpn?userId=user-nomad-2",
        },
      } as unknown as Party.ConnectionContext,
    );

    const mockPc = createMockPeerConnection("connected");
    const mockDc = createMockDataChannel();

    server.registerPeerConnection("conn-nomad-2", mockPc, mockDc);
    expect(server.getActivePeerConnectionCount()).toBe(1);

    // Simulate ICE connection failure
    (mockPc as any).iceConnectionState = "failed";
    if (typeof mockPc.oniceconnectionstatechange === "function") {
      mockPc.oniceconnectionstatechange(new Event("iceconnectionstatechange"));
    }

    expect(mockPc.close).toHaveBeenCalledTimes(1);
    expect(mockDc.close).toHaveBeenCalledTimes(1);
    expect(server.getActivePeerConnectionCount()).toBe(0);
  });

  it("cleans up open RTCDataChannel references and message handlers via handleIceConnectionStateChange", async () => {
    const { room, connections } = createMockRoom();
    const server = new VpnMeshRoom(room as unknown as Party.Room);

    const conn = createMockConnection("conn-nomad-3");
    connections.set("conn-nomad-3", conn);

    await server.onConnect(
      conn as unknown as Party.Connection,
      {
        request: {
          url: "https://worksphere.party/party/vpn?userId=user-nomad-3",
        },
      } as unknown as Party.ConnectionContext,
    );

    const mockPc = createMockPeerConnection();
    const mockDc = createMockDataChannel();

    server.registerPeerConnection("conn-nomad-3", mockPc, mockDc);
    expect(server.getActivePeerConnectionCount()).toBe(1);

    server.handleIceConnectionStateChange("conn-nomad-3", "closed");

    expect(mockPc.close).toHaveBeenCalledTimes(1);
    expect(mockDc.close).toHaveBeenCalledTimes(1);
    expect(mockDc.onmessage).toBeNull();
    expect(server.getActivePeerConnectionCount()).toBe(0);
  });

  it("cleans up peer connections upon receiving DISCONNECT signaling message", async () => {
    const { room, connections } = createMockRoom();
    const server = new VpnMeshRoom(room as unknown as Party.Room);

    const conn = createMockConnection("conn-nomad-4");
    connections.set("conn-nomad-4", conn);

    await server.onConnect(
      conn as unknown as Party.Connection,
      {
        request: {
          url: "https://worksphere.party/party/vpn?userId=user-nomad-4",
        },
      } as unknown as Party.ConnectionContext,
    );

    const mockPc = createMockPeerConnection();
    server.registerPeerConnection("conn-nomad-4", mockPc);
    expect(server.getActivePeerConnectionCount()).toBe(1);

    await server.onMessage(
      JSON.stringify({ type: "DISCONNECT", peerId: "conn-nomad-4" }),
      conn as unknown as Party.Connection,
    );

    expect(mockPc.close).toHaveBeenCalledTimes(1);
    expect(server.getActivePeerConnectionCount()).toBe(0);
  });

  it("executes explicit cleanup loop over multiple disconnected peers", async () => {
    const { room, connections } = createMockRoom();
    const server = new VpnMeshRoom(room as unknown as Party.Room);

    const pcList: RTCPeerConnection[] = [];
    const dcList: RTCDataChannel[] = [];

    for (let i = 1; i <= 3; i++) {
      const connId = `conn-peer-${i}`;
      const conn = createMockConnection(connId);
      connections.set(connId, conn);

      await server.onConnect(
        conn as unknown as Party.Connection,
        {
          request: {
            url: `https://worksphere.party/party/vpn?userId=user-${i}`,
          },
        } as unknown as Party.ConnectionContext,
      );

      const pc = createMockPeerConnection("connected");
      const dc = createMockDataChannel();
      pcList.push(pc);
      dcList.push(dc);
      server.registerPeerConnection(connId, pc, dc);
    }

    expect(server.getActivePeerConnectionCount()).toBe(3);

    // Set 2 peers to failed/closed iceConnectionState
    (pcList[0] as any).iceConnectionState = "failed";
    (pcList[1] as any).connectionState = "failed";

    server.cleanupDisconnectedPeers();

    // 2 peers were cleaned up, 1 remains
    expect(server.getActivePeerConnectionCount()).toBe(1);
    expect(pcList[0].close).toHaveBeenCalledTimes(1);
    expect(pcList[1].close).toHaveBeenCalledTimes(1);
    expect(pcList[2].close).not.toHaveBeenCalled();

    // Clean up the last peer
    (pcList[2] as any).iceConnectionState = "closed";
    server.cleanupDisconnectedPeers();
    expect(server.getActivePeerConnectionCount()).toBe(0);
  });
});
