/**
 * WebRTC Peer and Data Channel Connection Manager.
 *
 * Manages WebRTC RTCPeerConnection instances, RTCDataChannel connections,
 * signaling message handling, encryption keys, and standardized connection lifecycle states
 * (CONNECTING, CONNECTED, DEGRADED, RECONNECTING, DISCONNECTED).
 */

import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptChunk,
  decryptChunk,
  encryptFile,
  type KeyPair,
} from "@/lib/p2p/encryption";
import {
  ConnectionLifecycleState,
  mapPeerConnectionToLifecycleState,
} from "../connectionState";
import {
  findMeshRoutes,
  MeshPathBalancer,
  type MeshLinkTelemetry,
  type MeshRoute,
} from "./meshPathBalancer";
import {
  PeerConnection,
  PeerStatus,
  FileTransfer,
  SignalMessage,
} from "./types";

export type { PeerConnection, PeerStatus, FileTransfer };

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const DC_LABEL = "files";
const DC_CONFIG: RTCDataChannelInit = { ordered: true };
const TELEMETRY_INTERVAL_MS = 250;
const TOPOLOGY_INTERVAL_MS = 1000;
const MAX_RELAY_HOPS = 5;
const MAX_TOPOLOGY_PEERS = 64;

interface MeshRelayEnvelope {
  type: "mesh-relay";
  id: string;
  source: string;
  destination: string;
  visited: string[];
  hops: number;
  payload: Record<string, unknown>;
}

interface EncryptedMeshPayload {
  type: "mesh-encrypted-payload";
  transferId: string;
  sequence: number;
  iv: number[];
  ciphertext: number[];
}

export type MessageHandler = (peerId: string, data: unknown) => void;
export type LifecycleChangeHandler = (
  peerId: string,
  state: ConnectionLifecycleState,
) => void;

/**
 * Consolidated WebRTC Peer Manager.
 */
export class WebRTCPeerManager {
  protected peers: Map<string, PeerConnection> = new Map();
  protected keyPair: KeyPair | null = null;
  protected roomSocket: WebSocket | null = null;
  protected messageHandlers: Set<MessageHandler> = new Set();
  protected lifecycleHandlers: Set<LifecycleChangeHandler> = new Set();
  protected adjacency = new Map<string, Set<string>>();
  protected pathBalancer = new MeshPathBalancer();
  protected telemetryTimer: ReturnType<typeof setInterval> | null = null;
  protected topologyTimer: ReturnType<typeof setInterval> | null = null;
  protected pendingTelemetryPings = new Map<string, number>();
  protected pingTimeouts = new Set<string>();
  protected previousRtt = new Map<string, number>();
  protected jitterEstimates = new Map<string, number>();
  protected previousPacketCounters = new Map<
    string,
    { lost: number; received: number }
  >();
  protected seenRelayPackets = new Map<string, number>();
  protected transferDeliveryState = new Map<
    string,
    { nextSequence: number; pending: Map<number, Record<string, unknown>> }
  >();
  protected remotePublicKeys = new Map<string, string>();
  protected derivedSharedKeys = new Map<string, CryptoKey>();
  protected localPublicKey: string | null = null;
  public localPeerId: string = "";

  constructor(
    protected partyKitHost: string,
    protected roomName: string,
  ) {
    this.localPeerId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2, 15);
  }

  async initialize(): Promise<string> {
    this.keyPair = await generateKeyPair();
    this.localPublicKey = await exportPublicKey(this.keyPair.publicKey);
    return this.localPeerId;
  }

  connectToSignaling(): void {
    const isHttps =
      typeof window !== "undefined" && window.location.protocol === "https:";
    const protocol = isHttps ? "wss:" : "ws:";
    const url = `${protocol}//${this.partyKitHost}/room/${this.roomName}`;

    this.roomSocket = new WebSocket(url);

    this.roomSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleSignalingMessage(message);
      } catch {
        // Not a JSON signaling message
      }
    };

    this.roomSocket.onopen = () => {
      for (const peerId of this.peers.keys()) {
        this.cleanupPeer(peerId);
      }
      this.sendMessage({
        type: "peer-join",
        peerId: this.localPeerId,
      });
      this.startMeshMonitoring();
    };
  }

  protected startMeshMonitoring(): void {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    if (this.topologyTimer) clearInterval(this.topologyTimer);
    this.telemetryTimer = setInterval(() => {
      void this.samplePeerTelemetry();
      this.sendTelemetryPings();
    }, TELEMETRY_INTERVAL_MS);
    this.topologyTimer = setInterval(() => {
      this.broadcastTopology();
    }, TOPOLOGY_INTERVAL_MS);
    this.broadcastTopology();
  }

  protected sendTelemetryPings(): void {
    const now = Date.now();
    for (const peer of this.peers.values()) {
      const channel = peer.dataChannel;
      if (!channel || channel.readyState !== "open") continue;
      const pendingAt = this.pendingTelemetryPings.get(peer.peerId);
      if (pendingAt !== undefined) {
        if (now - pendingAt < 750) continue;
        this.pendingTelemetryPings.delete(peer.peerId);
        this.pingTimeouts.add(peer.peerId);
        const current = this.pathBalancer.getTelemetry(peer.peerId);
        this.pathBalancer.updateTelemetry(peer.peerId, {
          packetLoss: Math.max(current?.packetLoss ?? 0, 0.1),
          jitterMs: Math.max(current?.jitterMs ?? 0, 100),
          rttMs: Math.max(current?.rttMs ?? 0, now - pendingAt),
          sampledAt: now,
        });
      }
      try {
        channel.send(JSON.stringify({ type: "mesh-telemetry-ping", sentAt: now }));
        this.pendingTelemetryPings.set(peer.peerId, now);
      } catch (error) {
        console.warn(
          `[WebRTCPeerManager] Failed sending telemetry ping to ${peer.peerId}:`,
          error,
        );
      }
    }
  }

  protected async samplePeerTelemetry(): Promise<void> {
    await Promise.all(
      Array.from(this.peers.values()).map(async (peer) => {
        if (
          peer.connection.connectionState !== "connected" ||
          peer.dataChannel?.readyState !== "open"
        ) {
          return;
        }

        try {
          const report = await peer.connection.getStats();
          let rttMs = 0;
          let jitterMs = 0;
          let packetLoss = 0;
          let packetsLost = 0;
          let packetsReceived = 0;

          report.forEach((raw) => {
            const stat = raw as RTCStats & {
              state?: string;
              nominated?: boolean;
              currentRoundTripTime?: number;
              roundTripTime?: number;
              jitter?: number;
              fractionLost?: number;
              packetsLost?: number;
              packetsReceived?: number;
            };
            if (
              stat.type === "candidate-pair" &&
              (stat.state === "succeeded" || stat.nominated) &&
              typeof stat.currentRoundTripTime === "number"
            ) {
              rttMs = Math.max(rttMs, stat.currentRoundTripTime * 1000);
            }
            if (stat.type === "remote-inbound-rtp") {
              if (typeof stat.roundTripTime === "number") {
                rttMs = Math.max(rttMs, stat.roundTripTime * 1000);
              }
              if (typeof stat.jitter === "number") {
                jitterMs = Math.max(jitterMs, stat.jitter * 1000);
              }
              if (typeof stat.fractionLost === "number") {
                packetLoss = Math.max(packetLoss, stat.fractionLost);
              }
              packetsLost += stat.packetsLost ?? 0;
            }
            if (stat.type === "inbound-rtp") {
              if (typeof stat.jitter === "number") {
                jitterMs = Math.max(jitterMs, stat.jitter * 1000);
              }
              packetsLost += stat.packetsLost ?? 0;
              packetsReceived += stat.packetsReceived ?? 0;
            }
          });

          const previous = this.previousPacketCounters.get(peer.peerId);
          if (packetLoss === 0 && previous) {
            const lostDelta = Math.max(0, packetsLost - previous.lost);
            const receivedDelta = Math.max(0, packetsReceived - previous.received);
            const total = lostDelta + receivedDelta;
            if (total > 0) packetLoss = lostDelta / total;
          }
          this.previousPacketCounters.set(peer.peerId, {
            lost: packetsLost,
            received: packetsReceived,
          });

          const pingMetrics = this.pathBalancer.getTelemetry(peer.peerId);
          const metrics: MeshLinkTelemetry = {
            packetLoss: Math.max(packetLoss, this.pingTimeouts.has(peer.peerId) ? 0.1 : 0),
            jitterMs: Math.max(jitterMs, pingMetrics?.jitterMs ?? 0),
            rttMs: Math.max(rttMs, pingMetrics?.rttMs ?? 0),
            sampledAt: Date.now(),
          };
          this.pathBalancer.updateTelemetry(peer.peerId, metrics);
        } catch (error) {
          console.warn(
            `[WebRTCPeerManager] Failed sampling telemetry for ${peer.peerId}:`,
            error,
          );
        }
      }),
    );
  }

  protected broadcastTopology(): void {
    const neighbors = Array.from(this.peers.values())
      .filter((peer) => peer.dataChannel?.readyState === "open")
      .map((peer) => peer.peerId);
    this.adjacency.set(this.localPeerId, new Set(neighbors));

    const links = Array.from(this.adjacency.entries()).map(
      ([peerId, peerNeighbors]) => [
        peerId,
        Array.from(peerNeighbors).slice(0, MAX_TOPOLOGY_PEERS),
      ],
    );
    const message = JSON.stringify({
      type: "mesh-topology",
      links,
      peerKeys: [
        ...(this.localPublicKey
          ? [[this.localPeerId, this.localPublicKey]]
          : []),
        ...Array.from(this.remotePublicKeys.entries()),
      ].slice(0, MAX_TOPOLOGY_PEERS),
      generatedAt: Date.now(),
    });
    for (const peer of this.peers.values()) {
      if (peer.dataChannel?.readyState === "open") {
        try {
          peer.dataChannel.send(message);
        } catch (error) {
          console.warn(
            `[WebRTCPeerManager] Failed advertising topology to ${peer.peerId}:`,
            error,
          );
        }
      }
    }
  }

  protected handleMeshControlMessage(
    peerId: string,
    message: Record<string, unknown>,
  ): boolean {
    if (message.type === "mesh-telemetry-ping") {
      const peer = this.peers.get(peerId);
      if (
        peer?.dataChannel?.readyState === "open" &&
        typeof message.sentAt === "number"
      ) {
        peer.dataChannel.send(
          JSON.stringify({ type: "mesh-telemetry-pong", sentAt: message.sentAt }),
        );
      }
      return true;
    }

    if (message.type === "mesh-telemetry-pong") {
      const sentAt = this.pendingTelemetryPings.get(peerId);
      if (typeof message.sentAt === "number" && sentAt === message.sentAt) {
        const rttMs = Math.max(0, Date.now() - sentAt);
        const previousRtt = this.previousRtt.get(peerId);
        const previousJitter = this.jitterEstimates.get(peerId) ?? 0;
        const jitterMs =
          previousRtt === undefined
            ? previousJitter
            : 0.75 * previousJitter + 0.25 * Math.abs(rttMs - previousRtt);
        this.previousRtt.set(peerId, rttMs);
        this.jitterEstimates.set(peerId, jitterMs);
        this.pendingTelemetryPings.delete(peerId);
        this.pingTimeouts.delete(peerId);
        const current = this.pathBalancer.getTelemetry(peerId);
        this.pathBalancer.updateTelemetry(peerId, {
          packetLoss: current?.packetLoss ?? 0,
          jitterMs,
          rttMs,
          sampledAt: Date.now(),
        });
      }
      return true;
    }

    if (message.type === "key-exchange") {
      if (typeof message.publicKey === "string") {
        void this.acceptPeerPublicKey(peerId, message.publicKey).catch((error) =>
          console.error(
            `[WebRTCPeerManager] Failed deriving a shared key for ${peerId}:`,
            error,
          ),
        );
      }
      return true;
    }

    if (message.type === "mesh-topology") {
      if (!Array.isArray(message.links)) return true;
      for (const link of message.links.slice(0, MAX_TOPOLOGY_PEERS)) {
        if (
          !Array.isArray(link) ||
          typeof link[0] !== "string" ||
          !Array.isArray(link[1])
        ) {
          continue;
        }
        const neighbors = new Set(
          link[1]
            .filter(
              (neighbor): neighbor is string =>
                typeof neighbor === "string" &&
                neighbor.length > 0 &&
                neighbor.length <= 256,
            )
            .slice(0, MAX_TOPOLOGY_PEERS),
        );
        this.adjacency.set(link[0], neighbors);
      }
      if (Array.isArray(message.peerKeys)) {
        for (const entry of message.peerKeys.slice(0, MAX_TOPOLOGY_PEERS)) {
          if (
            Array.isArray(entry) &&
            typeof entry[0] === "string" &&
            typeof entry[1] === "string" &&
            entry[0] !== this.localPeerId &&
            entry[1].length <= 1024
          ) {
            if (this.remotePublicKeys.get(entry[0]) !== entry[1]) {
              this.derivedSharedKeys.delete(entry[0]);
              const peer = this.peers.get(entry[0]);
              if (peer) peer.sharedKey = null;
            }
            this.remotePublicKeys.set(entry[0], entry[1]);
          }
        }
      }
      return true;
    }

    if (message.type === "mesh-relay") {
      this.handleRelayEnvelope(peerId, message);
      return true;
    }

    if (message.type === "mesh-encrypted-payload") {
      void this.handleEncryptedPayload(
        peerId,
        message as unknown as EncryptedMeshPayload,
      );
      return true;
    }

    return false;
  }

  protected async handleEncryptedPayload(
    sourcePeerId: string,
    message: EncryptedMeshPayload,
  ): Promise<void> {
    if (
      typeof message.transferId !== "string" ||
      message.transferId.length > 256 ||
      !Number.isInteger(message.sequence) ||
      message.sequence < 0 ||
      !Array.isArray(message.iv) ||
      message.iv.length !== 12 ||
      !message.iv.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
      !Array.isArray(message.ciphertext) ||
      message.ciphertext.length === 0 ||
      message.ciphertext.length > 100_000 ||
      !message.ciphertext.every(
        (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
      )
    ) {
      return;
    }

    try {
      const sharedKey = await this.getSharedKeyForPeer(sourcePeerId);
      if (!sharedKey) throw new Error(`No end-to-end key for peer ${sourcePeerId}`);
      const plaintext = await decryptChunk(
        {
          index: message.sequence,
          iv: Uint8Array.from(message.iv),
          ciphertext: Uint8Array.from(message.ciphertext),
        },
        sharedKey,
      );
      const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Record<
        string,
        unknown
      >;
      this.dispatchTransferPayload(sourcePeerId, {
        ...payload,
        transferId: message.transferId,
        meshSequence: message.sequence,
      });
    } catch (error) {
      console.error(
        `[WebRTCPeerManager] Failed decrypting relayed payload from ${sourcePeerId}:`,
        error,
      );
    }
  }

  protected handleRelayEnvelope(
    incomingPeerId: string,
    message: Record<string, unknown>,
  ): void {
    if (
      typeof message.id !== "string" ||
      message.id.length > 512 ||
      typeof message.source !== "string" ||
      message.source.length > 256 ||
      typeof message.destination !== "string" ||
      message.destination.length > 256 ||
      !Array.isArray(message.visited) ||
      message.visited.length === 0 ||
      message.visited.length > MAX_RELAY_HOPS + 1 ||
      !message.visited.every((peer): peer is string => typeof peer === "string") ||
      typeof message.hops !== "number" ||
      !Number.isInteger(message.hops) ||
      message.hops < 0 ||
      message.hops >= MAX_RELAY_HOPS ||
      typeof message.payload !== "object" ||
      message.payload === null ||
      Array.isArray(message.payload) ||
      (message.payload as Record<string, unknown>).type !==
        "mesh-encrypted-payload"
    ) {
      return;
    }

    const envelope = message as unknown as MeshRelayEnvelope;
    if (
      envelope.source !== envelope.visited[0] ||
      envelope.visited[envelope.visited.length - 1] !== incomingPeerId ||
      envelope.visited.length !== envelope.hops + 1 ||
      new Set(envelope.visited).size !== envelope.visited.length
    ) {
      return;
    }
    const now = Date.now();
    for (const [packetId, expiresAt] of this.seenRelayPackets) {
      if (expiresAt <= now) this.seenRelayPackets.delete(packetId);
    }
    if (this.seenRelayPackets.has(envelope.id)) return;
    this.seenRelayPackets.set(envelope.id, now + 60_000);

    if (envelope.destination === this.localPeerId) {
      this.handleMeshControlMessage(envelope.source, envelope.payload);
      return;
    }
    if (
      envelope.hops >= MAX_RELAY_HOPS ||
      envelope.visited.includes(this.localPeerId)
    ) {
      return;
    }

    const visited = [...envelope.visited, this.localPeerId];
    const attempted = new Set([...visited, incomingPeerId]);
    let routes = this.routesTo(envelope.destination, attempted);
    while (routes.length > 0) {
      const route = this.pathBalancer.choosePath(routes);
      const nextPeerId = route?.path[1];
      if (!route || !nextPeerId) return;
      try {
        this.sendRelayToPeer(nextPeerId, {
          ...envelope,
          visited,
          hops: envelope.hops + 1,
        });
        return;
      } catch (error) {
        console.warn(
          `[WebRTCPeerManager] Mesh relay path via ${nextPeerId} failed:`,
          error,
        );
        attempted.add(nextPeerId);
        routes = this.routesTo(envelope.destination, attempted);
      }
    }
  }

  protected routesTo(
    destination: string,
    excludedPeers: ReadonlySet<string> = new Set(),
  ): MeshRoute[] {
    const adjacency = new Map<string, ReadonlySet<string>>();
    for (const [peerId, neighbors] of this.adjacency) {
      adjacency.set(
        peerId,
        new Set(Array.from(neighbors).filter((neighbor) => !excludedPeers.has(neighbor))),
      );
    }
    const openNeighbors = new Set(
      Array.from(this.peers.values())
        .filter((peer) => peer.dataChannel?.readyState === "open")
        .map((peer) => peer.peerId)
        .filter((peerId) => !excludedPeers.has(peerId)),
    );
    adjacency.set(this.localPeerId, openNeighbors);
    return findMeshRoutes(
      this.localPeerId,
      destination,
      adjacency,
      4,
      MAX_RELAY_HOPS,
    ).filter((route) => this.peers.get(route.path[1])?.dataChannel?.readyState === "open");
  }

  protected sendRelayToPeer(
    peerId: string,
    envelope: MeshRelayEnvelope,
  ): void {
    const peer = this.peers.get(peerId);
    if (!peer?.dataChannel || peer.dataChannel.readyState !== "open") {
      throw new Error(`Mesh relay next hop ${peerId} is not connected`);
    }
    peer.dataChannel.send(JSON.stringify(envelope));
  }

  protected async sendRoutedPayload(
    destination: string,
    payload: Record<string, unknown>,
    transferId: string,
    sequence: number,
  ): Promise<void> {
    const attempted = new Set<string>();
    let routes = this.routesTo(destination);
    while (routes.length > 0) {
      const route = this.pathBalancer.choosePath(routes);
      if (!route) break;
      const nextPeerId = route.path[1];
      try {
        if (route.path.length === 2) {
          const peer = this.peers.get(nextPeerId);
          if (!peer?.dataChannel || peer.dataChannel.readyState !== "open") {
            throw new Error(`Direct data channel to peer ${destination} is unavailable`);
          }
          peer.dataChannel.send(
            JSON.stringify({ ...payload, meshSequence: sequence }),
          );
        } else {
          const sharedKey = await this.getSharedKeyForPeer(destination);
          if (!sharedKey) {
            throw new Error(`No end-to-end encryption key for peer ${destination}`);
          }
          const encrypted = await encryptChunk(
            new TextEncoder().encode(JSON.stringify(payload)),
            sharedKey,
            sequence,
          );
          const packetPayload: EncryptedMeshPayload = {
            type: "mesh-encrypted-payload",
            transferId,
            sequence,
            iv: Array.from(encrypted.iv),
            ciphertext: Array.from(encrypted.ciphertext),
          };
          this.sendRelayToPeer(nextPeerId, {
            type: "mesh-relay",
            id: `${transferId}:${sequence}`,
            source: this.localPeerId,
            destination,
            visited: [this.localPeerId],
            hops: 0,
            payload: packetPayload,
          });
        }
        return;
      } catch (error) {
        console.warn(
          `[WebRTCPeerManager] Packet ${sequence} path via ${nextPeerId} failed:`,
          error,
        );
        attempted.add(nextPeerId);
        routes = this.routesTo(destination, attempted);
      }
    }
    throw new Error(`All mesh routes to peer ${destination} failed`);
  }

  protected dispatchTransferPayload(
    sourcePeerId: string,
    payload: Record<string, unknown>,
  ): void {
    const transferId = payload.transferId;
    const sequence = payload.meshSequence;
    if (
      typeof transferId !== "string" ||
      typeof sequence !== "number" ||
      !Number.isInteger(sequence) ||
      sequence < 0
    ) {
      for (const handler of this.messageHandlers) handler(sourcePeerId, payload);
      return;
    }

    const key = `${sourcePeerId}:${transferId}`;
    let state = this.transferDeliveryState.get(key);
    if (!state) {
      state = { nextSequence: 0, pending: new Map() };
      this.transferDeliveryState.set(key, state);
    }
    if (sequence < state.nextSequence || state.pending.has(sequence)) return;
    state.pending.set(sequence, payload);

    while (state.pending.has(state.nextSequence)) {
      const next = state.pending.get(state.nextSequence)!;
      state.pending.delete(state.nextSequence);
      state.nextSequence++;
      const { meshSequence: _meshSequence, ...applicationPayload } = next;
      for (const handler of this.messageHandlers) {
        handler(sourcePeerId, applicationPayload);
      }
      if (applicationPayload.type === "file-complete") {
        this.transferDeliveryState.delete(key);
        return;
      }
    }
  }

  protected async handleSignalingMessage(
    message: Record<string, unknown>,
  ): Promise<void> {
    switch (message.type) {
      case "offer":
        if (message.targetPeerId === this.localPeerId) {
          await this.handleOffer(
            message.peerId as string,
            message.offer as RTCSessionDescriptionInit,
          );
        }
        break;

      case "answer":
        if (message.targetPeerId === this.localPeerId) {
          await this.handleAnswer(
            message.peerId as string,
            message.answer as RTCSessionDescriptionInit,
          );
        }
        break;

      case "ice-candidate":
        if (message.targetPeerId === this.localPeerId) {
          const peer = this.peers.get(message.peerId as string);
          if (peer && message.candidate) {
            await peer.connection.addIceCandidate(
              message.candidate as RTCIceCandidateInit,
            );
          }
        }
        break;

      case "peer-join":
        if ((message.peerId as string) !== this.localPeerId) {
          this.cleanupPeer(message.peerId as string);
          await this.initiateConnection(message.peerId as string);
        }
        break;
    }
  }

  public cleanupPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.connection.onicecandidate = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.ondatachannel = null;
    peer.connection.close();

    if (peer.dataChannel) {
      peer.dataChannel.onopen = null;
      peer.dataChannel.onclose = null;
      peer.dataChannel.onmessage = null;
      peer.dataChannel.close();
    }

    peer.status = "disconnected";
    peer.lifecycleState = ConnectionLifecycleState.DISCONNECTED;
    this.notifyLifecycleChange(peerId, ConnectionLifecycleState.DISCONNECTED);

    this.peers.delete(peerId);
    this.pathBalancer.removePeer(peerId);
    this.previousPacketCounters.delete(peerId);
    this.pendingTelemetryPings.delete(peerId);
    this.pingTimeouts.delete(peerId);
    this.previousRtt.delete(peerId);
    this.jitterEstimates.delete(peerId);
    this.adjacency.delete(peerId);
    for (const neighbors of this.adjacency.values()) {
      neighbors.delete(peerId);
    }
    this.broadcastTopology();
  }

  protected async initiateConnection(peerId: string): Promise<void> {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const peer: PeerConnection = {
      peerId,
      connection: pc,
      dataChannel: null,
      sharedKey: null,
      status: "connecting",
      lifecycleState: ConnectionLifecycleState.CONNECTING,
    };

    this.peers.set(peerId, peer);
    this.notifyLifecycleChange(peerId, ConnectionLifecycleState.CONNECTING);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendMessage({
          type: "ice-candidate",
          peerId: this.localPeerId,
          targetPeerId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const lifecycle = mapPeerConnectionToLifecycleState(pc.connectionState);
      peer.lifecycleState = lifecycle;
      peer.status = this.mapToPeerStatus(lifecycle);
      this.notifyLifecycleChange(peerId, lifecycle);
      this.notifyHandlers();
    };

    const dc = pc.createDataChannel(DC_LABEL, DC_CONFIG);
    peer.dataChannel = dc;
    this.setupDataChannel(dc, peerId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendMessage({
      type: "offer",
      peerId: this.localPeerId,
      targetPeerId: peerId,
      offer: pc.localDescription?.toJSON(),
    });
  }

  protected async handleOffer(
    peerId: string,
    offer: RTCSessionDescriptionInit,
  ): Promise<void> {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const peer: PeerConnection = {
      peerId,
      connection: pc,
      dataChannel: null,
      sharedKey: null,
      status: "connecting",
      lifecycleState: ConnectionLifecycleState.CONNECTING,
    };

    this.peers.set(peerId, peer);
    this.notifyLifecycleChange(peerId, ConnectionLifecycleState.CONNECTING);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendMessage({
          type: "ice-candidate",
          peerId: this.localPeerId,
          targetPeerId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const lifecycle = mapPeerConnectionToLifecycleState(pc.connectionState);
      peer.lifecycleState = lifecycle;
      peer.status = this.mapToPeerStatus(lifecycle);
      this.notifyLifecycleChange(peerId, lifecycle);
      this.notifyHandlers();
    };

    pc.ondatachannel = (event) => {
      peer.dataChannel = event.channel;
      this.setupDataChannel(event.channel, peerId);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendMessage({
      type: "answer",
      peerId: this.localPeerId,
      targetPeerId: peerId,
      answer: pc.localDescription?.toJSON(),
    });
  }

  protected async handleAnswer(
    peerId: string,
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    const peer = this.peers.get(peerId);
    if (peer) {
      await peer.connection.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
    }
  }

  protected setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    channel.onopen = () => {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.status = "connected";
        peer.lifecycleState = ConnectionLifecycleState.CONNECTED;
        this.notifyLifecycleChange(peerId, ConnectionLifecycleState.CONNECTED);
      }
      this.deriveKeyForPeer(peerId);
      this.notifyHandlers();
      this.broadcastTopology();
    };

    channel.onclose = () => {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.status = "disconnected";
        peer.lifecycleState = ConnectionLifecycleState.DISCONNECTED;
        this.notifyLifecycleChange(
          peerId,
          ConnectionLifecycleState.DISCONNECTED,
        );
      }
      this.adjacency.get(this.localPeerId)?.delete(peerId);
      this.broadcastTopology();
      this.notifyHandlers();
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data &&
          typeof data === "object" &&
          this.handleMeshControlMessage(peerId, data as Record<string, unknown>)
        ) {
          return;
        }
        this.dispatchTransferPayload(peerId, data as Record<string, unknown>);
      } catch (error) {
        console.error(`[WebRTCPeerManager] Failed handling data from ${peerId}:`, error);
      }
    };
  }

  protected async deriveKeyForPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || !this.keyPair) return;

    const publicKeyStr = await exportPublicKey(this.keyPair.publicKey);
    peer.dataChannel?.send(
      JSON.stringify({ type: "key-exchange", publicKey: publicKeyStr }),
    );
  }

  protected async acceptPeerPublicKey(
    peerId: string,
    publicKey: string,
  ): Promise<void> {
    if (!this.keyPair) return;
    this.remotePublicKeys.set(peerId, publicKey);
    this.derivedSharedKeys.delete(peerId);
    const importedKey = await importPublicKey(publicKey);
    const sharedKey = await deriveSharedKey(this.keyPair.privateKey, importedKey);
    this.derivedSharedKeys.set(peerId, sharedKey);
    const peer = this.peers.get(peerId);
    if (peer) peer.sharedKey = sharedKey;
    this.broadcastTopology();
  }

  protected async getSharedKeyForPeer(peerId: string): Promise<CryptoKey | null> {
    const directKey = this.peers.get(peerId)?.sharedKey;
    if (directKey) return directKey;
    const derivedKey = this.derivedSharedKeys.get(peerId);
    if (derivedKey) return derivedKey;
    const publicKey = this.remotePublicKeys.get(peerId);
    if (!publicKey || !this.keyPair) return null;
    const importedKey = await importPublicKey(publicKey);
    const sharedKey = await deriveSharedKey(this.keyPair.privateKey, importedKey);
    this.derivedSharedKeys.set(peerId, sharedKey);
    return sharedKey;
  }

  public onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public onLifecycleChange(handler: LifecycleChangeHandler): () => void {
    this.lifecycleHandlers.add(handler);
    return () => this.lifecycleHandlers.delete(handler);
  }

  protected sendMessage(message: Record<string, unknown>): void {
    if (this.roomSocket?.readyState === WebSocket.OPEN) {
      this.roomSocket.send(JSON.stringify(message));
    }
  }

  protected notifyHandlers(): void {
    for (const handler of this.messageHandlers) {
      handler("__status__", { peers: this.getPeersStatus() });
    }
  }

  protected notifyLifecycleChange(
    peerId: string,
    state: ConnectionLifecycleState,
  ): void {
    for (const handler of this.lifecycleHandlers) {
      try {
        handler(peerId, state);
      } catch (err) {
        console.error("[WebRTCPeerManager] Lifecycle handler error:", err);
      }
    }
  }

  public getPeersStatus(): Array<{
    peerId: string;
    status: PeerStatus;
    lifecycleState?: ConnectionLifecycleState;
  }> {
    return Array.from(this.peers.values()).map((p) => ({
      peerId: p.peerId,
      status: p.status,
      lifecycleState: p.lifecycleState,
    }));
  }

  public getPeer(peerId: string): PeerConnection | undefined {
    return this.peers.get(peerId);
  }

  protected mapToPeerStatus(lifecycle: ConnectionLifecycleState): PeerStatus {
    switch (lifecycle) {
      case ConnectionLifecycleState.CONNECTED:
      case ConnectionLifecycleState.DEGRADED:
        return "connected";
      case ConnectionLifecycleState.RECONNECTING:
      case ConnectionLifecycleState.CONNECTING:
        return "connecting";
      case ConnectionLifecycleState.DISCONNECTED:
      default:
        return "disconnected";
    }
  }

  public async sendFile(file: File, peerId: string): Promise<FileTransfer> {
    const sharedKey = await this.getSharedKeyForPeer(peerId);
    if (!sharedKey || this.routesTo(peerId).length === 0) {
      throw new Error("No mesh route or encryption key available for peer");
    }

    const transfer: FileTransfer = {
      id:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).substring(2, 15),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      progress: 0,
      status: "encrypting",
    };

    try {
      transfer.status = "encrypting";
      const { chunks, checksum, totalChunks } = await encryptFile(
        file,
        sharedKey,
      );

      transfer.status = "sending";
      transfer.checksum = checksum;

      await this.sendRoutedPayload(
        peerId,
        {
          type: "file-metadata",
          transferId: transfer.id,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          checksum,
          totalChunks,
        },
        transfer.id,
        0,
      );

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkData = {
          type: "file-chunk",
          transferId: transfer.id,
          index: chunk.index,
          iv: Array.from(chunk.iv),
          ciphertext: Array.from(chunk.ciphertext),
        };
        await this.sendRoutedPayload(peerId, chunkData, transfer.id, i + 1);
        transfer.progress = Math.round(((i + 1) / totalChunks) * 100);
        this.notifyHandlers();
      }

      await this.sendRoutedPayload(
        peerId,
        { type: "file-complete", transferId: transfer.id },
        transfer.id,
        chunks.length + 1,
      );

      transfer.status = "complete";
      transfer.progress = 100;
    } catch {
      transfer.status = "failed";
    }

    return transfer;
  }

  public disconnect(): void {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    if (this.topologyTimer) clearInterval(this.topologyTimer);
    this.telemetryTimer = null;
    this.topologyTimer = null;
    for (const [peerId, peer] of this.peers.entries()) {
      peer.dataChannel?.close();
      peer.connection.close();
      this.notifyLifecycleChange(
        peerId,
        ConnectionLifecycleState.DISCONNECTED,
      );
    }
    this.peers.clear();
    this.adjacency.clear();
    this.previousPacketCounters.clear();
    this.pendingTelemetryPings.clear();
    this.pingTimeouts.clear();
    this.previousRtt.clear();
    this.jitterEstimates.clear();
    this.seenRelayPackets.clear();
    this.transferDeliveryState.clear();
    this.remotePublicKeys.clear();
    this.derivedSharedKeys.clear();
    this.roomSocket?.close();
    this.keyPair = null;
  }
}

/**
 * Drop-in P2PManager alias for backwards compatibility.
 */
export class P2PManager extends WebRTCPeerManager {}
