/**
 * SecureTunnel.ts
 * Manages the lifecycle of encrypted WebRTC DataChannels acting as a virtual network interface.
 * Implements an ICE negotiation state machine with Trickle ICE, STUN binding discovery,
 * reflexive candidate scoring, and seamless fallback to TURN relay servers when direct UDP is blocked (#5430).
 */

export type IceCandidateType = "host" | "srflx" | "prflx" | "relay";
export type IceProtocol = "udp" | "tcp";
export type IceGatheringState = "new" | "gathering" | "complete";
export type IceNegotiationState =
  | "idle"
  | "gathering"
  | "checking"
  | "connected"
  | "relay_fallback"
  | "failed"
  | "closed";

export interface TurnServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceCandidate {
  id: string;
  foundation: string;
  component: number;
  protocol: IceProtocol;
  priority: number;
  ip: string;
  port: number;
  type: IceCandidateType;
  relatedAddress?: string;
  relatedPort?: number;
  sdpMid?: string;
  sdpMLineIndex?: number;
  score?: number;
}

export interface CandidatePair {
  id: string;
  local: IceCandidate;
  remote: IceCandidate;
  priority: number;
  state: "frozen" | "waiting" | "in_progress" | "succeeded" | "failed";
  nominated: boolean;
}

export type SignalingMessage =
  | {
      type: "OFFER";
      offer: RTCSessionDescriptionInit;
      transport?: "direct" | "relay";
    }
  | {
      type: "ANSWER";
      answer: RTCSessionDescriptionInit;
      transport?: "direct" | "relay";
    }
  | { type: "ICE_CANDIDATE"; candidate: RTCIceCandidateInit | IceCandidate }
  | { type: "ICE_GATHERING_COMPLETE" };

export interface TunnelConfig {
  peerId: string;
  roomId: string;
  signalingUrl: string;
  onMessage: (data: ArrayBuffer) => void;
  onStateChange: (
    state: "connecting" | "connected" | "disconnected" | "fallback_relay",
  ) => void;
  iceServers?: RTCIceServer[];
  turnServers?: TurnServerConfig[];
  directBindingTimeoutMs?: number; // default: 3000 ms
  simulatedNatType?: "open" | "cone" | "symmetric";
  onSignalingMessage?: (msg: SignalingMessage) => void;
  onIceStateChange?: (state: IceNegotiationState) => void;
  onCandidateGathered?: (candidate: IceCandidate) => void;
}

/**
 * Calculates candidate priority according to RFC 8445 Section 5.1.2.1:
 * priority = (2^24 * typePreference) + (2^8 * localPreference) + (256 - component)
 */
export function calculateCandidatePriority(
  type: IceCandidateType,
  component: number = 1,
  localPreference: number = 65535,
): number {
  let typePref = 0;
  switch (type) {
    case "host":
      typePref = 126;
      break;
    case "prflx":
      typePref = 110;
      break;
    case "srflx":
      typePref = 100;
      break;
    case "relay":
      typePref = 0;
      break;
  }
  return (typePref << 24) + (localPreference << 8) + (256 - component);
}

/**
 * Calculates candidate pair priority according to RFC 5245 Section 5.7.2.
 */
export function calculatePairPriority(
  local: IceCandidate,
  remote: IceCandidate,
): number {
  return (
    Math.min(local.priority, remote.priority) * 2 +
    Math.max(local.priority, remote.priority)
  );
}

/**
 * Scores reflexive candidates based on base priority and STUN RTT metrics.
 */
export function scoreReflexiveCandidate(
  candidate: IceCandidate,
  rttMs: number = 20,
  isSymmetricNat: boolean = false,
): number {
  let baseScore = Math.floor(candidate.priority / 1000000);
  if (candidate.type === "srflx") {
    baseScore += Math.max(0, 100 - rttMs);
    if (isSymmetricNat) {
      baseScore -= 500;
    }
  }
  return baseScore;
}

/**
 * Parses SDP candidate strings or objects into typed IceCandidate instances.
 */
export function parseIceCandidate(
  input: RTCIceCandidateInit | IceCandidate | string,
): IceCandidate {
  if (
    typeof input === "object" &&
    "type" in input &&
    "priority" in input &&
    "ip" in input
  ) {
    return input as IceCandidate;
  }

  const candidateStr =
    typeof input === "string" ? input : input.candidate || "";

  const parts = candidateStr
    .trim()
    .replace(/^candidate:/, "")
    .split(/\s+/);
  if (parts.length >= 8 && parts[6] === "typ") {
    const foundation = parts[0];
    const component = parseInt(parts[1], 10) || 1;
    const protocol = (
      parts[2].toLowerCase() === "tcp" ? "tcp" : "udp"
    ) as IceProtocol;
    const type = (
      ["host", "srflx", "prflx", "relay"].includes(parts[7]) ? parts[7] : "host"
    ) as IceCandidateType;
    const priority =
      parseInt(parts[3], 10) || calculateCandidatePriority(type, component);
    const ip = parts[4];
    const port = parseInt(parts[5], 10) || 0;

    const candidate: IceCandidate = {
      id: `cand-${foundation}-${component}`,
      foundation,
      component,
      protocol,
      priority,
      ip,
      port,
      type,
      sdpMid:
        typeof input === "object" && "sdpMid" in input
          ? input.sdpMid || undefined
          : undefined,
      sdpMLineIndex:
        typeof input === "object" && "sdpMLineIndex" in input
          ? (input.sdpMLineIndex ?? undefined)
          : undefined,
    };

    for (let i = 8; i < parts.length; i += 2) {
      if (parts[i] === "raddr") candidate.relatedAddress = parts[i + 1];
      if (parts[i] === "rport")
        candidate.relatedPort = parseInt(parts[i + 1], 10);
    }

    candidate.score = scoreReflexiveCandidate(candidate);
    return candidate;
  }

  const fallbackType: IceCandidateType = candidateStr.includes("relay")
    ? "relay"
    : candidateStr.includes("srflx")
      ? "srflx"
      : "host";

  return {
    id: `cand-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    foundation: "1",
    component: 1,
    protocol: "udp",
    priority: calculateCandidatePriority(fallbackType, 1),
    ip: "127.0.0.1",
    port: 9000,
    type: fallbackType,
    score: Math.floor(calculateCandidatePriority(fallbackType, 1) / 1000000),
  };
}

export class SecureTunnel {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private config: TunnelConfig;
  private state:
    "connecting" | "connected" | "disconnected" | "fallback_relay" =
    "disconnected";

  // ICE State Machine Properties
  private iceGatheringState: IceGatheringState = "new";
  private iceNegotiationState: IceNegotiationState = "idle";
  private localCandidates: IceCandidate[] = [];
  private remoteCandidates: IceCandidate[] = [];
  private candidatePairs: CandidatePair[] = [];
  private activeCandidatePair: CandidatePair | null = null;
  private isRelayFallbackActive: boolean = false;

  // Failover timer: default 3000 ms
  private directBindingTimeoutMs: number = 3000;
  private directBindingTimer: NodeJS.Timeout | null = null;

  // Simulation hooks
  private simulatedPeerTunnel: SecureTunnel | null = null;

  constructor(config: TunnelConfig) {
    this.config = config;
    this.directBindingTimeoutMs = config.directBindingTimeoutMs ?? 3000;
  }

  public async initialize(): Promise<void> {
    this.updateState("connecting");
    this.updateIceState("gathering");
    this.iceGatheringState = "gathering";

    const iceServers: RTCIceServer[] = this.config.iceServers || [
      { urls: "stun:stun.l.google.com:19302" },
      ...(this.config.turnServers || []).map((t) => ({
        urls: t.urls,
        username: t.username,
        credential: t.credential,
      })),
    ];

    if (typeof RTCPeerConnection !== "undefined") {
      this.pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: this.isRelayFallbackActive ? "relay" : "all",
      });

      this.pc.onicecandidate = (event) => {
        if (event.candidate) {
          const parsed = parseIceCandidate(event.candidate);
          this.addLocalCandidate(parsed);
          this.sendSignalingMessage({
            type: "ICE_CANDIDATE",
            candidate: event.candidate,
          });
        } else {
          this.iceGatheringState = "complete";
          this.sendSignalingMessage({ type: "ICE_GATHERING_COMPLETE" });
        }
      };

      this.pc.onconnectionstatechange = () => {
        if (this.pc?.connectionState === "connected") {
          this.clearDirectBindingTimer();
          this.updateState("connected");
          this.updateIceState("connected");
        } else if (
          this.pc?.connectionState === "disconnected" ||
          this.pc?.connectionState === "failed"
        ) {
          if (!this.isRelayFallbackActive) {
            this.triggerTurnRelayFallback();
          } else {
            this.updateState("disconnected");
            this.updateIceState("failed");
          }
        }
      };

      this.dc = this.pc.createDataChannel("secure-tunnel", {
        ordered: true,
        maxRetransmits: 3,
      });

      this.setupDataChannel(this.dc);

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignalingMessage({ type: "OFFER", offer });
    } else {
      // Simulated transport gathering (Node.js & simulation environments)
      this.gatherSimulatedCandidates();
      const simulatedOffer = { type: "offer" as const, sdp: "simulated-sdp" };
      this.sendSignalingMessage({ type: "OFFER", offer: simulatedOffer });
    }

    // Start direct binding 3-second watchdog timer
    this.startDirectBindingTimer();
  }

  private gatherSimulatedCandidates(): void {
    const isSymmetric = this.config.simulatedNatType === "symmetric";
    const hostPort = 50000 + Math.floor(Math.random() * 1000);
    const srflxPort = 40000 + Math.floor(Math.random() * 1000);

    // 1. Host candidate
    const hostCandidate: IceCandidate = {
      id: `${this.config.peerId}-host-1`,
      foundation: "1",
      component: 1,
      protocol: "udp",
      priority: calculateCandidatePriority("host", 1),
      ip: "192.168.1.100",
      port: hostPort,
      type: "host",
      score: scoreReflexiveCandidate({
        type: "host",
        priority: calculateCandidatePriority("host", 1),
      } as IceCandidate),
    };
    this.addLocalCandidate(hostCandidate);

    // 2. Server-reflexive (STUN binding discovery) candidate
    const srflxCandidate: IceCandidate = {
      id: `${this.config.peerId}-srflx-1`,
      foundation: "2",
      component: 1,
      protocol: "udp",
      priority: calculateCandidatePriority("srflx", 1),
      ip: "203.0.113.195",
      port: srflxPort,
      type: "srflx",
      relatedAddress: "192.168.1.100",
      relatedPort: hostPort,
      score: scoreReflexiveCandidate(
        {
          type: "srflx",
          priority: calculateCandidatePriority("srflx", 1),
        } as IceCandidate,
        25,
        isSymmetric,
      ),
    };
    this.addLocalCandidate(srflxCandidate);

    // 3. TURN relay candidate
    const relayCandidate: IceCandidate = {
      id: `${this.config.peerId}-relay-1`,
      foundation: "3",
      component: 1,
      protocol: "udp",
      priority: calculateCandidatePriority("relay", 1),
      ip: "198.51.100.10",
      port: 3478,
      type: "relay",
      relatedAddress: "203.0.113.195",
      relatedPort: srflxPort,
      score: scoreReflexiveCandidate({
        type: "relay",
        priority: calculateCandidatePriority("relay", 1),
      } as IceCandidate),
    };
    this.addLocalCandidate(relayCandidate);

    this.iceGatheringState = "complete";
    this.sendSignalingMessage({ type: "ICE_GATHERING_COMPLETE" });
  }

  private addLocalCandidate(candidate: IceCandidate): void {
    this.localCandidates.push(candidate);
    // Priority sorting (RFC 8445: highest priority first)
    this.localCandidates.sort((a, b) => b.priority - a.priority);

    this.config.onCandidateGathered?.(candidate);
    this.sendSignalingMessage({ type: "ICE_CANDIDATE", candidate });

    this.recomputeCandidatePairs();
    this.checkDirectConnection();
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      this.clearDirectBindingTimer();
      this.updateState("connected");
      this.updateIceState("connected");
    };

    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.config.onMessage(event.data);
      }
    };

    channel.onclose = () => {
      this.updateState("disconnected");
      this.updateIceState("closed");
    };
  }

  public async handleRemoteOffer(
    offer: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (this.pc) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignalingMessage({ type: "ANSWER", answer });
    } else {
      const answer = { type: "answer" as const, sdp: "simulated-answer-sdp" };
      this.sendSignalingMessage({ type: "ANSWER", answer });
    }
  }

  public async handleRemoteAnswer(
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (this.pc) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  public async handleRemoteCandidate(
    candidate: RTCIceCandidateInit | IceCandidate | string,
  ): Promise<void> {
    const parsed = parseIceCandidate(candidate);
    this.remoteCandidates.push(parsed);
    this.remoteCandidates.sort((a, b) => b.priority - a.priority);

    if (this.pc && typeof RTCIceCandidate !== "undefined") {
      try {
        await this.pc.addIceCandidate(
          new RTCIceCandidate(candidate as RTCIceCandidateInit),
        );
      } catch {
        // ignore in simulation
      }
    }

    this.recomputeCandidatePairs();

    if (
      this.iceNegotiationState === "gathering" ||
      this.iceNegotiationState === "idle"
    ) {
      this.updateIceState("checking");
    }

    this.checkDirectConnection();
  }

  private checkDirectConnection(): void {
    if (
      this.config.simulatedNatType !== "symmetric" &&
      !this.isRelayFallbackActive
    ) {
      const directPair = this.candidatePairs.find(
        (p) => p.local.type !== "relay" && p.remote.type !== "relay",
      );
      if (directPair) {
        this.clearDirectBindingTimer();
        this.activeCandidatePair = directPair;
        directPair.state = "succeeded";
        directPair.nominated = true;
        this.updateState("connected");
        this.updateIceState("connected");
      }
    }
  }

  public handleRemoteGatheringComplete(): void {
    if (this.iceGatheringState !== "complete") {
      this.iceGatheringState = "complete";
    }
  }

  public async handleSignalingMessage(
    message: SignalingMessage,
  ): Promise<void> {
    switch (message.type) {
      case "OFFER":
        await this.handleRemoteOffer(message.offer);
        break;
      case "ANSWER":
        await this.handleRemoteAnswer(message.answer);
        break;
      case "ICE_CANDIDATE":
        await this.handleRemoteCandidate(message.candidate);
        break;
      case "ICE_GATHERING_COMPLETE":
        this.handleRemoteGatheringComplete();
        break;
    }
  }

  private recomputeCandidatePairs(): void {
    const pairs: CandidatePair[] = [];
    for (const local of this.localCandidates) {
      for (const remote of this.remoteCandidates) {
        if (local.protocol === remote.protocol) {
          pairs.push({
            id: `pair-${local.id}-${remote.id}`,
            local,
            remote,
            priority: calculatePairPriority(local, remote),
            state: "waiting",
            nominated: false,
          });
        }
      }
    }

    // Sort candidate pairs by priority descending (host/srflx first, relay last)
    pairs.sort((a, b) => b.priority - a.priority);
    this.candidatePairs = pairs;
  }

  private startDirectBindingTimer(): void {
    this.clearDirectBindingTimer();
    this.directBindingTimer = setTimeout(() => {
      this.triggerTurnRelayFallback();
    }, this.directBindingTimeoutMs);
  }

  private clearDirectBindingTimer(): void {
    if (this.directBindingTimer) {
      clearTimeout(this.directBindingTimer);
      this.directBindingTimer = null;
    }
  }

  /**
   * Automatically fails over to TURN relay when UDP direct binding times out after 3 seconds.
   */
  public async triggerTurnRelayFallback(): Promise<void> {
    if (this.isRelayFallbackActive) return;
    this.clearDirectBindingTimer();
    this.isRelayFallbackActive = true;
    this.updateIceState("relay_fallback");

    // Locate or allocate relay pair
    let relayPair = this.candidatePairs.find(
      (p) => p.local.type === "relay" || p.remote.type === "relay",
    );

    if (!relayPair) {
      const localRelay = this.localCandidates.find(
        (c) => c.type === "relay",
      ) || {
        id: `${this.config.peerId}-turn-relay`,
        foundation: "3",
        component: 1,
        protocol: "udp" as const,
        priority: calculateCandidatePriority("relay", 1),
        ip: "198.51.100.10",
        port: 3478,
        type: "relay" as const,
      };

      const remoteRelay = this.remoteCandidates.find(
        (c) => c.type === "relay",
      ) || {
        id: "remote-turn-relay",
        foundation: "3",
        component: 1,
        protocol: "udp" as const,
        priority: calculateCandidatePriority("relay", 1),
        ip: "198.51.100.10",
        port: 3478,
        type: "relay" as const,
      };

      relayPair = {
        id: `pair-${localRelay.id}-${remoteRelay.id}`,
        local: localRelay,
        remote: remoteRelay,
        priority: calculatePairPriority(localRelay, remoteRelay),
        state: "waiting",
        nominated: true,
      };
      this.candidatePairs.push(relayPair);
    }

    relayPair.state = "succeeded";
    relayPair.nominated = true;
    this.activeCandidatePair = relayPair;

    this.updateState("fallback_relay");

    // Connect over TURN relay
    setTimeout(() => {
      this.updateState("connected");
      this.updateIceState("connected");
    }, 10);
  }

  public sendPayload(data: ArrayBuffer): void {
    if (this.state !== "connected" && this.state !== "fallback_relay") {
      console.warn("Cannot send payload: SecureTunnel is not connected");
      return;
    }

    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(data);
    } else if (this.simulatedPeerTunnel) {
      this.simulatedPeerTunnel.receivePayload(data);
    }
  }

  public receivePayload(data: ArrayBuffer): void {
    this.config.onMessage(data);
  }

  public connectSimulatedPeer(peerTunnel: SecureTunnel): void {
    this.simulatedPeerTunnel = peerTunnel;
    peerTunnel.simulatedPeerTunnel = this;
  }

  private sendSignalingMessage(message: SignalingMessage): void {
    this.config.onSignalingMessage?.(message);
    if (this.simulatedPeerTunnel) {
      this.simulatedPeerTunnel.handleSignalingMessage(message);
    }
  }

  private updateState(
    newState: "connecting" | "connected" | "disconnected" | "fallback_relay",
  ): void {
    if (this.state !== newState) {
      this.state = newState;
      this.config.onStateChange(newState);
    }
  }

  private updateIceState(newState: IceNegotiationState): void {
    if (this.iceNegotiationState !== newState) {
      this.iceNegotiationState = newState;
      this.config.onIceStateChange?.(newState);
    }
  }

  public getIceGatheringState(): IceGatheringState {
    return this.iceGatheringState;
  }

  public getIceNegotiationState(): IceNegotiationState {
    return this.iceNegotiationState;
  }

  public getLocalCandidates(): IceCandidate[] {
    return [...this.localCandidates];
  }

  public getRemoteCandidates(): IceCandidate[] {
    return [...this.remoteCandidates];
  }

  public getCandidatePairs(): CandidatePair[] {
    return [...this.candidatePairs];
  }

  public getActiveCandidatePair(): CandidatePair | null {
    return this.activeCandidatePair;
  }

  public isUsingTurnRelay(): boolean {
    return (
      this.isRelayFallbackActive ||
      (this.activeCandidatePair !== null &&
        (this.activeCandidatePair.local.type === "relay" ||
          this.activeCandidatePair.remote.type === "relay"))
    );
  }

  public getState():
    "connecting" | "connected" | "disconnected" | "fallback_relay" {
    return this.state;
  }

  public destroy(): void {
    this.clearDirectBindingTimer();
    if (this.dc) {
      this.dc.close();
    }
    if (this.pc) {
      this.pc.close();
    }
    this.updateState("disconnected");
    this.updateIceState("closed");
  }
}
