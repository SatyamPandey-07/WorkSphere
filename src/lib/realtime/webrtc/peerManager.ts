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
  encryptFile,
  type KeyPair,
} from "@/lib/p2p/encryption";
import {
  ConnectionLifecycleState,
  mapPeerConnectionToLifecycleState,
} from "../connectionState";
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
    await exportPublicKey(this.keyPair.publicKey);
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
    };
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
      this.notifyHandlers();
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const handler of this.messageHandlers) {
          handler(peerId, data);
        }
      } catch {
        // Binary data
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
    const peer = this.peers.get(peerId);
    if (!peer?.sharedKey || !peer.dataChannel) {
      throw new Error("Not connected to peer or key not derived");
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
        peer.sharedKey,
      );

      transfer.status = "sending";
      transfer.checksum = checksum;

      peer.dataChannel.send(
        JSON.stringify({
          type: "file-metadata",
          transferId: transfer.id,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          checksum,
          totalChunks,
        }),
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
        peer.dataChannel.send(JSON.stringify(chunkData));
        transfer.progress = Math.round(((i + 1) / totalChunks) * 100);
        this.notifyHandlers();
      }

      peer.dataChannel.send(
        JSON.stringify({ type: "file-complete", transferId: transfer.id }),
      );

      transfer.status = "complete";
      transfer.progress = 100;
    } catch {
      transfer.status = "failed";
    }

    return transfer;
  }

  public disconnect(): void {
    for (const [peerId, peer] of this.peers.entries()) {
      peer.dataChannel?.close();
      peer.connection.close();
      this.notifyLifecycleChange(
        peerId,
        ConnectionLifecycleState.DISCONNECTED,
      );
    }
    this.peers.clear();
    this.roomSocket?.close();
    this.keyPair = null;
  }
}

/**
 * Drop-in P2PManager alias for backwards compatibility.
 */
export class P2PManager extends WebRTCPeerManager {}
