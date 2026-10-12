import {
  findMeshRoutes,
  MeshPathBalancer,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  DEFAULT_CHUNK_SIZE,
  type MeshRoute,
} from "@/lib/realtime/webrtc/meshPathBalancer";
import { WebRTCPeerManager } from "@/lib/realtime/webrtc/peerManager";
import type { PeerConnection } from "@/lib/realtime/webrtc/types";

jest.mock("@/lib/p2p/encryption", () => ({
  generateKeyPair: jest.fn(),
  exportPublicKey: jest.fn(),
  importPublicKey: jest.fn(),
  deriveSharedKey: jest.fn(),
  encryptChunk: jest.fn().mockResolvedValue({
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array([1]),
  }),
  decryptChunk: jest.fn(),
  encryptFile: jest.fn(),
}));

class TestablePeerManager extends WebRTCPeerManager {
  constructor() {
    super("localhost", "mesh-test");
    this.localPeerId = "source";
  }

  addPeer(peerId: string, send: jest.Mock): void {
    this.peers.set(peerId, {
      peerId,
      connection: {} as RTCPeerConnection,
      dataChannel: { readyState: "open", send } as unknown as RTCDataChannel,
      sharedKey: null,
      status: "connected",
    } satisfies PeerConnection);
  }

  setLinks(links: Array<[string, string[]]>): void {
    this.adjacency = new Map(
      links.map(([peerId, neighbors]) => [peerId, new Set(neighbors)]),
    );
  }

  report(peerId: string, packetLoss: number, sampledAt: number): void {
    this.pathBalancer.updateTelemetry(peerId, {
      packetLoss,
      jitterMs: 0,
      rttMs: 20,
      sampledAt,
    });
  }

  protected async getSharedKeyForPeer(): Promise<CryptoKey | null> {
    return {} as CryptoKey;
  }

  route(
    peerId: string,
    payload: Record<string, unknown>,
    sequence: number,
  ): Promise<void> {
    return this.sendRoutedPayload(peerId, payload, "transfer", sequence);
  }
}

const routes: MeshRoute[] = [
  { destination: "target", path: ["source", "target"] },
  { destination: "target", path: ["source", "relay-a", "target"] },
  { destination: "target", path: ["source", "relay-b", "target"] },
];

describe("MeshPathBalancer", () => {
  it("switches off a congested primary link immediately", () => {
    const balancer = new MeshPathBalancer();
    const switchStartedAt = Date.now();
    balancer.updateTelemetry("target", {
      packetLoss: 0.08,
      jitterMs: 12,
      rttMs: 40,
      sampledAt: switchStartedAt,
    });

    const selected = balancer.choosePath(routes, switchStartedAt);

    expect(selected?.path).not.toEqual(routes[0].path);
    expect(balancer.isCongested("target", switchStartedAt)).toBe(true);
    expect(Date.now() - switchStartedAt).toBeLessThan(1000);
  });

  it("returns all packets to primary after sustained recovery", () => {
    const balancer = new MeshPathBalancer({ recoverySamples: 3 });
    const congestionAt = Date.now();
    balancer.updateTelemetry("target", {
      packetLoss: 0.08,
      jitterMs: 70,
      rttMs: 340,
      sampledAt: congestionAt,
    });

    for (let sample = 0; sample < 3; sample++) {
      const sampledAt = congestionAt + (sample + 1) * 250;
      balancer.updateTelemetry("target", {
        packetLoss: 0,
        jitterMs: 8,
        rttMs: 40,
        sampledAt,
      });
    }

    expect(
      balancer.isCongested("target", congestionAt + 750),
    ).toBe(false);
    const selected = Array.from({ length: 8 }, () =>
      balancer.choosePath(routes, 2000),
    );
    expect(selected.every((route) => route?.path === routes[0].path)).toBe(true);
  });

  it("finds multiple acyclic mesh routes while respecting hop bounds", () => {
    const topology = new Map<string, ReadonlySet<string>>([
      ["source", new Set(["target", "relay-a", "relay-b"])],
      ["relay-a", new Set(["source", "target"])],
      ["relay-b", new Set(["source", "relay-c"])],
      ["relay-c", new Set(["relay-b", "target"])],
      ["target", new Set(["source", "relay-a", "relay-c"])],
    ]);

    expect(findMeshRoutes("source", "target", topology, 4, 3)).toEqual([
      { destination: "target", path: ["source", "target"] },
      { destination: "target", path: ["source", "relay-a", "target"] },
      { destination: "target", path: ["source", "relay-b", "relay-c", "target"] },
    ]);
    expect(findMeshRoutes("source", "target", topology, 4, 2)).toHaveLength(2);
  });

  it("reroutes chunks over a relay while congested, then restores direct delivery", async () => {
    const manager = new TestablePeerManager();
    const directSend = jest.fn();
    const relaySend = jest.fn();
    manager.addPeer("target", directSend);
    manager.addPeer("relay", relaySend);
    manager.setLinks([
      ["source", ["target", "relay"]],
      ["relay", ["source", "target"]],
      ["target", ["source", "relay"]],
    ]);

    const congestedAt = Date.now();
    manager.report("target", 0.1, congestedAt);
    const switchStartedAt = Date.now();
    await manager.route("target", { type: "file-chunk", transferId: "transfer" }, 1);
    expect(Date.now() - switchStartedAt).toBeLessThan(1000);
    expect(directSend).not.toHaveBeenCalled();
    expect(JSON.parse(relaySend.mock.calls[0][0]).type).toBe("mesh-relay");

    for (let sample = 1; sample <= 3; sample++) {
      manager.report("target", 0, congestedAt + sample * 250);
    }
    await manager.route("target", { type: "file-chunk", transferId: "transfer" }, 2);
    expect(JSON.parse(directSend.mock.calls[0][0]).type).toBe("file-chunk");
  });

  describe("Dynamic Packet Size Optimization based on MTU probes", () => {
    it("discovers optimal chunk size via binary search MTU probe sequence", async () => {
      const balancer = new MeshPathBalancer();
      const channelMtuLimit = 32768; // 32KB
      const probedSizes: number[] = [];

      const optimal = await balancer.probeChannelMtu("peer-a", (size) => {
        probedSizes.push(size);
        return size <= channelMtuLimit;
      });

      expect(optimal).toBe(32768);
      expect(balancer.getOptimalChunkSize("peer-a")).toBe(32768);
      expect(probedSizes.length).toBeGreaterThan(1);
    });

    it("scales up to MAX_CHUNK_SIZE (64KB) on unconstrained channels", async () => {
      const balancer = new MeshPathBalancer();
      const optimal = await balancer.probeChannelMtu("peer-fast", () => true);

      expect(optimal).toBe(MAX_CHUNK_SIZE);
      expect(balancer.getOptimalChunkSize("peer-fast")).toBe(MAX_CHUNK_SIZE);
    });

    it("falls back to MIN_CHUNK_SIZE (16KB) if baseline probe fails", async () => {
      const balancer = new MeshPathBalancer();
      const optimal = await balancer.probeChannelMtu("peer-lossy", () => false);

      expect(optimal).toBe(MIN_CHUNK_SIZE);
      expect(balancer.getOptimalChunkSize("peer-lossy")).toBe(MIN_CHUNK_SIZE);
    });

    it("stores per-peer optimal chunk payload sizes in active connection state", async () => {
      const balancer = new MeshPathBalancer();
      balancer.setOptimalChunkSize("peer-1", 49152);
      balancer.setOptimalChunkSize("peer-2", 32768);

      expect(balancer.getOptimalChunkSize("peer-1")).toBe(49152);
      expect(balancer.getOptimalChunkSize("peer-2")).toBe(32768);
      expect(balancer.getOptimalChunkSize("peer-unknown")).toBe(MIN_CHUNK_SIZE);

      balancer.removePeer("peer-1");
      expect(balancer.getOptimalChunkSize("peer-1")).toBe(MIN_CHUNK_SIZE);
    });

    it("creates properly structured MTU probe packet with padding", () => {
      const balancer = new MeshPathBalancer();
      const probe = balancer.createProbePacket(32768);

      expect(probe.type).toBe("mesh-mtu-probe");
      expect(probe.size).toBe(32768);
      expect(typeof probe.probeId).toBe("string");
      expect(probe.payload?.length).toBeGreaterThan(0);
    });

    it("adapts file transfer chunk payload size based on optimal connection capacity", async () => {
      const manager = new TestablePeerManager();
      const directSend = jest.fn();
      manager.addPeer("target", directSend);
      manager.setLinks([["source", ["target"]]]);

      const peer = manager.getPeer("target");
      expect(peer).toBeDefined();
      if (peer) {
        peer.optimalChunkSize = 49152;
      }

      const { encryptFile } = jest.requireMock("@/lib/p2p/encryption");
      encryptFile.mockResolvedValueOnce({
        chunks: [],
        checksum: "sha256-mock",
        totalChunks: 0,
      });

      const mockFile = {
        name: "test.dat",
        size: 100000,
        type: "application/octet-stream",
      } as unknown as File;

      await manager.sendFile(mockFile, "target");

      expect(encryptFile).toHaveBeenCalledWith(
        mockFile,
        expect.anything(),
        49152,
      );
    });
  });

  describe("Asymmetric Link Latency Calculation & Buffer Weighting (#5739)", () => {
    it("weights asymmetric send/receive queue delays independently", () => {
      const balancer = new MeshPathBalancer({
        sendQueueWeight: 1.5,
        receiveQueueWeight: 1.0,
      });

      const asymmetricMetrics = {
        packetLoss: 0.01,
        jitterMs: 5,
        rttMs: 60,
        sampledAt: Date.now(),
        oneWaySendMs: 50,
        oneWayReceiveMs: 10,
        sendQueueDelayMs: 20,
        receiveQueueDelayMs: 5,
        bufferedAmountBytes: 0,
      };

      const sendCost = balancer.calculateDirectionalLinkCost(asymmetricMetrics, "send");
      expect(sendCost).toBe(80);

      const receiveCost = balancer.calculateDirectionalLinkCost(asymmetricMetrics, "receive");
      expect(receiveCost).toBe(15);
    });

    it("triggers congestion when dataChannel.bufferedAmount exceeds buffer threshold", () => {
      const balancer = new MeshPathBalancer({
        bufferedAmountThresholdBytes: 256 * 1024,
      });

      const now = Date.now();
      balancer.updateTelemetry("target", {
        packetLoss: 0.01,
        jitterMs: 10,
        rttMs: 40,
        sampledAt: now,
        bufferedAmountBytes: 300 * 1024,
      });

      expect(balancer.isCongested("target", now)).toBe(true);

      const selected = balancer.choosePath(routes, now);
      expect(selected?.path).not.toEqual(routes[0].path);
    });

    it("selects alternative multi-hop route when direct link uplink is degraded on asymmetric link", () => {
      const balancer = new MeshPathBalancer();
      const now = Date.now();

      balancer.updateTelemetry("target", {
        packetLoss: 0.01,
        jitterMs: 5,
        rttMs: 80,
        sampledAt: now,
        oneWaySendMs: 70,
        oneWayReceiveMs: 10,
        sendQueueDelayMs: 30,
        bufferedAmountBytes: 64 * 1024,
      });

      balancer.updateTelemetry("relay-a", {
        files: [],
        packetLoss: 0.005,
        jitterMs: 2,
        rttMs: 30,
        sampledAt: now,
        oneWaySendMs: 15,
        oneWayReceiveMs: 15,
        sendQueueDelayMs: 0,
        bufferedAmountBytes: 0,
      } as any);

      const selected = balancer.choosePath(routes, now, "send");
      expect(selected?.path).toEqual(["source", "relay-a", "target"]);
    });
  });
});