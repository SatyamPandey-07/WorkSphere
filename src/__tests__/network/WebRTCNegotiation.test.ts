/**
 * WebRTCNegotiation.test.ts
 *
 * Stress/behavioural coverage for the W3C "Perfect Negotiation" glare handling
 * added to WebRTCMesh (#7391). A mock RTCPeerConnection models the signaling
 * state machine so two peers can be driven into a simultaneous-offer collision
 * deterministically.
 */

import {
  WebRTCMesh,
  isPolitePeer,
  type MeshSignaling,
} from "@/core/network/WebRTCMesh";

class MockDataChannel {
  public readyState = "connecting";
  public binaryType = "blob";
  public bufferedAmount = 0;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((error: unknown) => void) | null = null;

  public send(): void {}

  public close(): void {
    this.readyState = "closed";
  }
}

class MockRTCPeerConnection {
  public static instances: MockRTCPeerConnection[] = [];
  public static offerGate: Promise<void> | null = null;

  public signalingState: RTCSignalingState = "stable";
  public connectionState: RTCPeerConnectionState = "new";
  public localDescription: RTCSessionDescriptionInit | null = null;
  public remoteDescription: RTCSessionDescriptionInit | null = null;

  public onicecandidate: ((event: { candidate: null }) => void) | null = null;
  public onconnectionstatechange: (() => void) | null = null;
  public ondatachannel: ((event: { channel: MockDataChannel }) => void) | null =
    null;
  public onnegotiationneeded: (() => void) | null = null;
  public onsignalingstatechange: (() => void) | null = null;

  public offersCreated = 0;
  public answersCreated = 0;
  public rollbacks = 0;
  public addedCandidates: RTCIceCandidateInit[] = [];

  constructor() {
    MockRTCPeerConnection.instances.push(this);
  }

  public createDataChannel(): MockDataChannel {
    return new MockDataChannel();
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.offersCreated++;
    if (MockRTCPeerConnection.offerGate) {
      await MockRTCPeerConnection.offerGate;
    }
    return { type: "offer", sdp: `offer-${this.offersCreated}` };
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.answersCreated++;
    return { type: "answer", sdp: `answer-${this.answersCreated}` };
  }

  public async setLocalDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (description.type === "rollback") {
      this.rollbacks++;
      this.localDescription = null;
      this.signalingState = "stable";
    } else {
      this.localDescription = description;
      this.signalingState =
        description.type === "offer" ? "have-local-offer" : "stable";
    }
    this.onsignalingstatechange?.();
  }

  public async setRemoteDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.remoteDescription = description;
    if (description.type === "offer") {
      this.signalingState = "have-remote-offer";
    } else if (description.type === "answer") {
      this.signalingState = "stable";
    }
    this.onsignalingstatechange?.();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteDescription) {
      throw new Error("InvalidStateError: no remote description");
    }
    this.addedCandidates.push(candidate);
  }
}

interface DeferredBus {
  queue: Array<() => Promise<void>>;
  drain: () => Promise<void>;
}

function createBus(): DeferredBus {
  const queue: Array<() => Promise<void>> = [];
  return {
    queue,
    async drain() {
      while (queue.length > 0) {
        const task = queue.shift()!;
        await task();
      }
    },
  };
}

function wire(mesh: WebRTCMesh, bus: DeferredBus, remoteId: string): MeshSignaling {
  return {
    sendDescription: (_peerId, description) =>
      bus.queue.push(() => mesh.handleRemoteDescription(remoteId, description)),
    sendCandidate: (_peerId, candidate) =>
      bus.queue.push(() => mesh.handleRemoteIceCandidate(remoteId, candidate)),
  };
}

describe("WebRTCMesh Perfect Negotiation glare handling (#7391)", () => {
  beforeAll(() => {
    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      MockRTCPeerConnection;
  });

  beforeEach(() => {
    MockRTCPeerConnection.instances = [];
    MockRTCPeerConnection.offerGate = null;
  });

  it("assigns deterministic, complementary polite/impolite roles", () => {
    expect(isPolitePeer("peer-a", "peer-b")).toBe(true);
    expect(isPolitePeer("peer-b", "peer-a")).toBe(false);
    expect(isPolitePeer("peer-a", "peer-a")).toBe(false);
  });

  it("resolves simultaneous offers: the polite peer rolls back, the impolite peer insists", async () => {
    const bus = createBus();
    const meshA = new WebRTCMesh("peer-a");
    const meshB = new WebRTCMesh("peer-b");
    meshA.setSignaling(wire(meshB, bus, "peer-a"));
    meshB.setSignaling(wire(meshA, bus, "peer-b"));

    await meshA.createPeerConnection("peer-b", false);
    await meshB.createPeerConnection("peer-a", false);

    const [pcA, pcB] = MockRTCPeerConnection.instances;

    // Both peers fire createOffer within the same window → glare.
    await Promise.all([
      meshA.negotiate("peer-b"),
      meshB.negotiate("peer-a"),
    ]);
    expect(bus.queue).toHaveLength(2);

    await bus.drain();

    // The polite peer (A) rolled back exactly once and answered.
    expect(pcA.rollbacks).toBe(1);
    expect(pcA.offersCreated).toBe(1);
    expect(pcA.answersCreated).toBe(1);

    // The impolite peer (B) kept its own offer and never answered A's.
    expect(pcB.offersCreated).toBe(1);
    expect(pcB.answersCreated).toBe(0);

    // Both peers settle back into a stable, mutually-described state.
    expect(pcA.signalingState).toBe("stable");
    expect(pcB.signalingState).toBe("stable");
    expect(pcA.remoteDescription).not.toBeNull();
    expect(pcB.remoteDescription).not.toBeNull();
  });

  it("discards a local offer superseded by a remote offer mid-flight", async () => {
    let releaseOffer: () => void = () => {};
    MockRTCPeerConnection.offerGate = new Promise<void>((resolve) => {
      releaseOffer = resolve;
    });

    const sent: RTCSessionDescriptionInit[] = [];
    const mesh = new WebRTCMesh("peer-a", {
      sendDescription: (_peerId, description) => sent.push(description),
      sendCandidate: () => {},
    });

    await mesh.createPeerConnection("peer-b", false);
    const pc = MockRTCPeerConnection.instances[0];

    // A starts creating an offer but is held mid-flight.
    const pendingNegotiation = mesh.negotiate("peer-b");

    // B's offer arrives while A is still "makingOffer".
    await mesh.handleRemoteDescription("peer-b", {
      type: "offer",
      sdp: "remote-offer",
    });

    releaseOffer();
    await pendingNegotiation;

    // A answered the remote offer and never emitted its stale local offer.
    expect(pc.answersCreated).toBe(1);
    expect(pc.localDescription?.type).toBe("answer");
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("answer");
    expect(pc.signalingState).toBe("stable");
  });

  it("queues ICE candidates until a remote description exists, then flushes them", async () => {
    const mesh = new WebRTCMesh("peer-a", {
      sendDescription: () => {},
      sendCandidate: () => {},
    });
    await mesh.createPeerConnection("peer-b", false);
    const pc = MockRTCPeerConnection.instances[0];

    // Candidate arrives before any remote description → queued, not applied.
    await mesh.handleRemoteIceCandidate("peer-b", { candidate: "cand-1" });
    expect(pc.addedCandidates).toHaveLength(0);

    // Applying the remote offer flushes the queued candidate.
    await mesh.handleRemoteDescription("peer-b", {
      type: "offer",
      sdp: "remote-offer",
    });
    expect(pc.addedCandidates.map((c) => c.candidate)).toEqual(["cand-1"]);

    // Subsequent candidates apply immediately.
    await mesh.handleRemoteIceCandidate("peer-b", { candidate: "cand-2" });
    expect(pc.addedCandidates.map((c) => c.candidate)).toEqual([
      "cand-1",
      "cand-2",
    ]);
  });

  it("handles a normal (non-colliding) offer/answer exchange", async () => {
    const bus = createBus();
    const meshA = new WebRTCMesh("peer-a");
    const meshB = new WebRTCMesh("peer-b");
    meshA.setSignaling(wire(meshB, bus, "peer-a"));
    meshB.setSignaling(wire(meshA, bus, "peer-b"));

    await meshA.createPeerConnection("peer-b", false);
    await meshB.createPeerConnection("peer-a", false);
    const [pcA, pcB] = MockRTCPeerConnection.instances;

    await meshA.negotiate("peer-b");
    await bus.drain();

    expect(pcA.offersCreated).toBe(1);
    expect(pcA.rollbacks).toBe(0);
    expect(pcB.answersCreated).toBe(1);
    expect(pcA.signalingState).toBe("stable");
    expect(pcB.signalingState).toBe("stable");
  });
});
