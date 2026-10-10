import {
  findMeshRoutes,
  MeshPathBalancer,
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
});
