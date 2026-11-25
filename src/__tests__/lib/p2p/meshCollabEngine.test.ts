import {
  MeshCollabEngine,
  type MeshPeerNode,
  type CRDTDocumentDelta,
  type LocalMeshTopology,
} from "@/lib/p2p/meshCollabEngine";
import { MeshBloomFilter } from "@/lib/p2p/meshBloomFilter";

describe("MeshCollabEngine Unit & Integration Tests", () => {
  describe("Bloom Filter Deduplication Integration", () => {
    it("creates a properly configured MeshBloomFilter via createMessageBloomFilter", () => {
      const filter = MeshCollabEngine.createMessageBloomFilter({
        capacity: 3000,
        targetFpr: 0.0005,
        autoRotate: false,
      });

      expect(filter).toBeInstanceOf(MeshBloomFilter);
      expect(filter.capacity).toBe(3000);
      expect(filter.targetFpr).toBe(0.0005);
    });

    it("checks duplicates correctly with isDuplicateMessage", () => {
      const filter = MeshCollabEngine.createMessageBloomFilter({
        autoRotate: false,
      });
      const payload = new Uint8Array([1, 2, 3, 4, 5]).buffer;

      // First check should not be duplicate
      expect(MeshCollabEngine.isDuplicateMessage(filter, payload)).toBe(false);

      // Second check of identical payload should be flagged as duplicate
      expect(MeshCollabEngine.isDuplicateMessage(filter, payload)).toBe(true);
    });

    it("calculates estimated bandwidth savings accurately in KB", () => {
      // 0 dropped messages = 0 KB
      expect(MeshCollabEngine.calculateBandwidthSavedKb(0)).toBe(0);
      expect(MeshCollabEngine.calculateBandwidthSavedKb(-5)).toBe(0);

      // 10 dropped messages of default 1024 bytes = 10 KB
      expect(MeshCollabEngine.calculateBandwidthSavedKb(10)).toBe(10);

      // 100 dropped messages of 2048 bytes = 200 KB
      expect(MeshCollabEngine.calculateBandwidthSavedKb(100, 2048)).toBe(200);
    });
  });

  describe("CRDT Document Delta Merging", () => {
    it("merges newer deltas and updates vector clocks correctly", () => {
      const baseText = "Initial shared document text";
      const currentClocks: Record<string, number> = {
        "user-alpha": 2,
        "user-beta": 1,
      };

      const newerDelta: CRDTDocumentDelta = {
        docId: "doc-1",
        vectorClock: { "user-alpha": 3 },
        authorId: "user-alpha",
        authorName: "Alice",
        deltaText: "Updated document text with new changes",
        cursorPosition: { line: 1, ch: 10 },
        timestamp: Date.now(),
      };

      const result = MeshCollabEngine.mergeDocumentDeltas(
        baseText,
        currentClocks,
        newerDelta,
      );

      expect(result.mergedText).toBe("Updated document text with new changes");
      expect(result.updatedClocks["user-alpha"]).toBe(3);
      expect(result.updatedClocks["user-beta"]).toBe(1);
    });

    it("retains base text when incoming delta has an older clock", () => {
      const baseText = "Current latest text";
      const currentClocks: Record<string, number> = { "user-alpha": 5 };

      const staleDelta: CRDTDocumentDelta = {
        docId: "doc-1",
        vectorClock: { "user-alpha": 3 },
        authorId: "user-alpha",
        authorName: "Alice",
        deltaText: "Stale text from offline client",
        cursorPosition: { line: 0, ch: 0 },
        timestamp: Date.now() - 10000,
      };

      const result = MeshCollabEngine.mergeDocumentDeltas(
        baseText,
        currentClocks,
        staleDelta,
      );

      expect(result.mergedText).toBe("Current latest text");
      expect(result.updatedClocks["user-alpha"]).toBe(5);
    });
  });

  describe("Mesh Resilience Calculation", () => {
    const createMockPeer = (
      id: string,
      status: MeshPeerNode["status"],
    ): MeshPeerNode => ({
      peerId: id,
      displayName: `Peer ${id}`,
      deskLocation: "Desk 1",
      ipSubnet: "192.168.1.0/24",
      hopCount: 0,
      signalStrengthRssi: -50,
      latencyMs: 15,
      lastSeenTimestamp: Date.now(),
      status,
      sharedFilesCount: 2,
    });

    it("rates mesh as optimal when >= 4 peers are connected and WAN is not blackout", () => {
      const peers: MeshPeerNode[] = [
        createMockPeer("p1", "connected"),
        createMockPeer("p2", "connected"),
        createMockPeer("p3", "mesh_relay"),
        createMockPeer("p4", "connected"),
      ];

      expect(
        MeshCollabEngine.calculateMeshResilience(peers, "healthy_online"),
      ).toBe("optimal");
      expect(
        MeshCollabEngine.calculateMeshResilience(
          peers,
          "degraded_high_packet_loss",
        ),
      ).toBe("optimal");
    });

    it("rates mesh as robust when >= 2 connected peers exist", () => {
      const peers: MeshPeerNode[] = [
        createMockPeer("p1", "connected"),
        createMockPeer("p2", "mesh_relay"),
        createMockPeer("p3", "disconnected"),
      ];

      expect(
        MeshCollabEngine.calculateMeshResilience(peers, "healthy_online"),
      ).toBe("robust");
    });

    it("rates mesh as limited when fewer than 2 peers are connected", () => {
      const peers: MeshPeerNode[] = [
        createMockPeer("p1", "connected"),
        createMockPeer("p2", "disconnected"),
      ];

      expect(
        MeshCollabEngine.calculateMeshResilience(peers, "healthy_online"),
      ).toBe("limited");
    });
  });

  describe("Signaling & RTT Ping Calculation", () => {
    it("generates valid base64 signaling token with offer payload", () => {
      const token = MeshCollabEngine.generateSignalingOffer(
        "peer-456",
        "192.168.1.50",
      );
      expect(typeof token).toBe("string");

      const decodedJson = Buffer.from(token, "base64").toString("utf-8");
      const parsed = JSON.parse(decodedJson);
      expect(parsed.peerId).toBe("peer-456");
      expect(parsed.subnet).toBe("192.168.1.50");
      expect(parsed.sdpOffer).toContain("webrtc-datachannel");
    });

    it("calculates RTT accurately and clamps negative latency or invalid inputs", () => {
      expect(MeshCollabEngine.calculateRttPing(1000, 1045)).toBe(45);
      expect(MeshCollabEngine.calculateRttPing(2000, 1950)).toBe(0);
      expect(MeshCollabEngine.calculateRttPing(NaN, 1000)).toBe(0);
      expect(
        MeshCollabEngine.calculateRttPing(undefined as unknown as number, 1000),
      ).toBe(0);
    });
  });

  describe("LocalMeshTopology Deduplication Telemetry Type Compatibility", () => {
    it("allows deduplicationStats on LocalMeshTopology", () => {
      const topology: LocalMeshTopology = {
        venueId: "venue-alpha",
        venueName: "Downtown Workspace",
        localSubnet: "192.168.1.0/24",
        wanStatus: "healthy_online",
        activeMeshPeers: [],
        totalBandwidthKbps: 54000,
        meshResilienceRating: "optimal",
        deduplicationStats: {
          droppedDuplicates: 45,
          bloomFilterMemoryBytes: 22466,
          falsePositiveRate: 0.00045,
        },
      };

      expect(topology.deduplicationStats?.droppedDuplicates).toBe(45);
      expect(topology.deduplicationStats?.bloomFilterMemoryBytes).toBe(22466);
    });
  });
});
