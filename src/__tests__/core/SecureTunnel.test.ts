/**
 * SecureTunnel.test.ts
 * Tests for ICE negotiation state machine, Trickle ICE candidate gathering, priority sorting,
 * automatic TURN relay failover after 3-second timeout, and symmetric NAT network simulation (#5430).
 */

import {
  SecureTunnel,
  calculateCandidatePriority,
  calculatePairPriority,
  scoreReflexiveCandidate,
  parseIceCandidate,
  IceCandidate,
} from "@/core/network/SecureTunnel";

describe("SecureTunnel ICE State Machine & TURN Relay Failover (#5430)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("ICE Candidate Priority & Reflexive Scoring (RFC 8445)", () => {
    it("calculates candidate priorities adhering to RFC 8445 type preferences (host > prflx > srflx > relay)", () => {
      const hostPriority = calculateCandidatePriority("host", 1);
      const prflxPriority = calculateCandidatePriority("prflx", 1);
      const srflxPriority = calculateCandidatePriority("srflx", 1);
      const relayPriority = calculateCandidatePriority("relay", 1);

      // Verify strict ranking order
      expect(hostPriority).toBeGreaterThan(prflxPriority);
      expect(prflxPriority).toBeGreaterThan(srflxPriority);
      expect(srflxPriority).toBeGreaterThan(relayPriority);

      // Verify order-of-magnitude values
      expect(hostPriority).toBeGreaterThan(2_000_000_000); // 126 << 24
      expect(srflxPriority).toBeGreaterThan(1_600_000_000); // 100 << 24
      expect(relayPriority).toBeLessThan(100_000_000); // 0 << 24
    });

    it("calculates candidate pair priority favoring direct pairs over relay pairs", () => {
      const hostCand: IceCandidate = {
        id: "c1",
        foundation: "1",
        component: 1,
        protocol: "udp",
        priority: calculateCandidatePriority("host", 1),
        ip: "192.168.1.10",
        port: 5000,
        type: "host",
      };

      const srflxCand: IceCandidate = {
        id: "c2",
        foundation: "2",
        component: 1,
        protocol: "udp",
        priority: calculateCandidatePriority("srflx", 1),
        ip: "203.0.113.1",
        port: 6000,
        type: "srflx",
      };

      const relayCand: IceCandidate = {
        id: "c3",
        foundation: "3",
        component: 1,
        protocol: "udp",
        priority: calculateCandidatePriority("relay", 1),
        ip: "198.51.100.1",
        port: 3478,
        type: "relay",
      };

      const directPairPriority = calculatePairPriority(hostCand, srflxCand);
      const relayPairPriority = calculatePairPriority(hostCand, relayCand);

      expect(directPairPriority).toBeGreaterThan(relayPairPriority);
    });

    it("scores reflexive candidates penalizing symmetric NAT environments", () => {
      const srflxCand: IceCandidate = {
        id: "c-srflx",
        foundation: "2",
        component: 1,
        protocol: "udp",
        priority: calculateCandidatePriority("srflx", 1),
        ip: "203.0.113.1",
        port: 6000,
        type: "srflx",
      };

      const normalScore = scoreReflexiveCandidate(srflxCand, 20, false);
      const symmetricScore = scoreReflexiveCandidate(srflxCand, 20, true);

      expect(normalScore).toBeGreaterThan(symmetricScore);
      expect(normalScore - symmetricScore).toBe(500);
    });

    it("parses standard SDP candidate lines correctly", () => {
      const sdpLine =
        "candidate:4234997325 1 udp 2113937151 192.168.0.15 52345 typ host generation 0";
      const parsed = parseIceCandidate(sdpLine);

      expect(parsed.foundation).toBe("4234997325");
      expect(parsed.component).toBe(1);
      expect(parsed.protocol).toBe("udp");
      expect(parsed.priority).toBe(2113937151);
      expect(parsed.ip).toBe("192.168.0.15");
      expect(parsed.port).toBe(52345);
      expect(parsed.type).toBe("host");
    });
  });

  describe("ICE Candidate Gathering State Machine & Priority Sorting", () => {
    it("gathers candidates and sorts them strictly descending by priority", async () => {
      const gatheredCandidates: IceCandidate[] = [];

      const tunnel = new SecureTunnel({
        peerId: "peer-alice",
        roomId: "cafe-central",
        signalingUrl: "ws://mesh.signal",
        onMessage: jest.fn(),
        onStateChange: jest.fn(),
        onCandidateGathered: (cand) => gatheredCandidates.push(cand),
        simulatedNatType: "open",
      });

      expect(tunnel.getIceGatheringState()).toBe("new");
      expect(tunnel.getIceNegotiationState()).toBe("idle");

      await tunnel.initialize();

      expect(tunnel.getIceGatheringState()).toBe("complete");
      expect(gatheredCandidates.length).toBeGreaterThanOrEqual(3);

      const localCandidates = tunnel.getLocalCandidates();
      expect(localCandidates).toHaveLength(3);

      // Verify priority sorting: host (highest) -> srflx -> relay (lowest)
      expect(localCandidates[0].type).toBe("host");
      expect(localCandidates[1].type).toBe("srflx");
      expect(localCandidates[2].type).toBe("relay");
      expect(localCandidates[0].priority).toBeGreaterThan(
        localCandidates[1].priority,
      );
      expect(localCandidates[1].priority).toBeGreaterThan(
        localCandidates[2].priority,
      );

      tunnel.destroy();
    });

    it("streams gathered candidates via Trickle ICE signaling events", async () => {
      const signalingMessages: any[] = [];

      const tunnel = new SecureTunnel({
        peerId: "peer-bob",
        roomId: "cafe-central",
        signalingUrl: "ws://mesh.signal",
        onMessage: jest.fn(),
        onStateChange: jest.fn(),
        onSignalingMessage: (msg) => signalingMessages.push(msg),
        simulatedNatType: "open",
      });

      await tunnel.initialize();

      const candidateMessages = signalingMessages.filter(
        (m) => m.type === "ICE_CANDIDATE",
      );
      const completeMessages = signalingMessages.filter(
        (m) => m.type === "ICE_GATHERING_COMPLETE",
      );

      expect(candidateMessages.length).toBe(3);
      expect(completeMessages.length).toBe(1);

      tunnel.destroy();
    });
  });

  describe("Automatic TURN Relay Failover on 3-Second Direct Binding Timeout", () => {
    it("triggers automatic TURN relay failover when UDP direct binding times out after 3 seconds", async () => {
      const stateChanges: string[] = [];
      const iceStateChanges: string[] = [];

      const tunnel = new SecureTunnel({
        peerId: "peer-restricted",
        roomId: "cafe-strict-nat",
        signalingUrl: "ws://mesh.signal",
        onMessage: jest.fn(),
        onStateChange: (state) => stateChanges.push(state),
        onIceStateChange: (state) => iceStateChanges.push(state),
        directBindingTimeoutMs: 3000,
        simulatedNatType: "symmetric", // Symmetric NAT blocks direct UDP
      });

      await tunnel.initialize();

      // Initially connecting and checking
      expect(tunnel.isUsingTurnRelay()).toBe(false);
      expect(tunnel.getState()).toBe("connecting");

      // Advance timer by 2.9 seconds: should still be in direct checking mode
      jest.advanceTimersByTime(2900);
      expect(tunnel.isUsingTurnRelay()).toBe(false);
      expect(stateChanges).not.toContain("fallback_relay");

      // Advance past 3.0 seconds (3000 ms timeout expires)
      jest.advanceTimersByTime(200);

      // Verify TURN relay fallback state triggered
      expect(stateChanges).toContain("fallback_relay");
      expect(iceStateChanges).toContain("relay_fallback");
      expect(tunnel.isUsingTurnRelay()).toBe(true);

      // Run any pending connection microtasks
      jest.advanceTimersByTime(50);
      expect(tunnel.getState()).toBe("connected");

      tunnel.destroy();
    });

    it("cancels the 3-second timer when direct UDP binding succeeds within 3 seconds", async () => {
      const stateChanges: string[] = [];

      const tunnel = new SecureTunnel({
        peerId: "peer-open",
        roomId: "cafe-open-nat",
        signalingUrl: "ws://mesh.signal",
        onMessage: jest.fn(),
        onStateChange: (state) => stateChanges.push(state),
        directBindingTimeoutMs: 3000,
        simulatedNatType: "open", // Open NAT allows direct binding
      });

      await tunnel.initialize();

      // Feed remote candidate to form direct pair and succeed direct binding
      await tunnel.handleRemoteCandidate({
        candidate: "candidate:1 1 udp 2113937151 192.168.1.150 50000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      });

      // Under open NAT, direct connection resolves immediately
      expect(tunnel.getState()).toBe("connected");
      expect(tunnel.isUsingTurnRelay()).toBe(false);

      // Advance timer well past 3 seconds (e.g. 5 seconds)
      jest.advanceTimersByTime(5000);

      // Relay failover should NOT have been triggered
      expect(stateChanges).not.toContain("fallback_relay");
      expect(tunnel.isUsingTurnRelay()).toBe(false);

      tunnel.destroy();
    });
  });

  describe("Network Simulation Test Across Symmetric NAT Topologies", () => {
    it("establishes end-to-end encrypted data exchange across symmetric NATs via automatic TURN relay failover", async () => {
      const receivedAtA: ArrayBuffer[] = [];
      const receivedAtB: ArrayBuffer[] = [];
      const statesA: string[] = [];
      const statesB: string[] = [];

      // Create two nomad peers both behind restrictive cafe symmetric NATs
      const tunnelA = new SecureTunnel({
        peerId: "nomad-peer-A",
        roomId: "cafe-mesh-room",
        signalingUrl: "ws://mesh.signal",
        onMessage: (data) => receivedAtA.push(data),
        onStateChange: (s) => statesA.push(s),
        directBindingTimeoutMs: 3000,
        simulatedNatType: "symmetric",
      });

      const tunnelB = new SecureTunnel({
        peerId: "nomad-peer-B",
        roomId: "cafe-mesh-room",
        signalingUrl: "ws://mesh.signal",
        onMessage: (data) => receivedAtB.push(data),
        onStateChange: (s) => statesB.push(s),
        directBindingTimeoutMs: 3000,
        simulatedNatType: "symmetric",
      });

      // Connect signaling transport between Peer A and Peer B
      tunnelA.connectSimulatedPeer(tunnelB);

      // Initialize both tunnels
      await tunnelA.initialize();
      await tunnelB.initialize();

      // Before 3 seconds: both peers are waiting for direct UDP which is blocked by symmetric NATs
      expect(tunnelA.isUsingTurnRelay()).toBe(false);
      expect(tunnelB.isUsingTurnRelay()).toBe(false);

      // Advance past 3-second direct binding timeout
      jest.advanceTimersByTime(3100);

      // Verify both peers automatically failover to TURN relay
      expect(statesA).toContain("fallback_relay");
      expect(statesB).toContain("fallback_relay");
      expect(tunnelA.isUsingTurnRelay()).toBe(true);
      expect(tunnelB.isUsingTurnRelay()).toBe(true);
      expect(tunnelA.getState()).toBe("connected");
      expect(tunnelB.getState()).toBe("connected");

      // Verify bidirectional payload exchange over the TURN relay tunnel
      const payloadAtoB = new Uint8Array([1, 2, 3, 4, 5]).buffer;
      const payloadBtoA = new Uint8Array([9, 8, 7, 6]).buffer;

      tunnelA.sendPayload(payloadAtoB);
      tunnelB.sendPayload(payloadBtoA);

      expect(receivedAtB).toHaveLength(1);
      expect(new Uint8Array(receivedAtB[0])).toEqual(
        new Uint8Array([1, 2, 3, 4, 5]),
      );

      expect(receivedAtA).toHaveLength(1);
      expect(new Uint8Array(receivedAtA[0])).toEqual(
        new Uint8Array([9, 8, 7, 6]),
      );

      tunnelA.destroy();
      tunnelB.destroy();
    });

    it("establishes direct UDP tunnel without TURN relay when NAT is non-symmetric", async () => {
      const receivedAtA: ArrayBuffer[] = [];
      const receivedAtB: ArrayBuffer[] = [];

      const tunnelA = new SecureTunnel({
        peerId: "peer-direct-A",
        roomId: "direct-room",
        signalingUrl: "ws://mesh.signal",
        onMessage: (data) => receivedAtA.push(data),
        onStateChange: jest.fn(),
        directBindingTimeoutMs: 3000,
        simulatedNatType: "open",
      });

      const tunnelB = new SecureTunnel({
        peerId: "peer-direct-B",
        roomId: "direct-room",
        signalingUrl: "ws://mesh.signal",
        onMessage: (data) => receivedAtB.push(data),
        onStateChange: jest.fn(),
        directBindingTimeoutMs: 3000,
        simulatedNatType: "open",
      });

      tunnelA.connectSimulatedPeer(tunnelB);

      await tunnelA.initialize();
      await tunnelB.initialize();

      // Direct binding succeeds immediately
      expect(tunnelA.getState()).toBe("connected");
      expect(tunnelB.getState()).toBe("connected");
      expect(tunnelA.isUsingTurnRelay()).toBe(false);
      expect(tunnelB.isUsingTurnRelay()).toBe(false);

      // Verify payload transmission directly
      const payload = new Uint8Array([10, 20, 30]).buffer;
      tunnelA.sendPayload(payload);

      expect(receivedAtB).toHaveLength(1);
      expect(new Uint8Array(receivedAtB[0])).toEqual(
        new Uint8Array([10, 20, 30]),
      );

      tunnelA.destroy();
      tunnelB.destroy();
    });
  });
});
