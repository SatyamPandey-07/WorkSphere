/**
 * WebRTC P2P Data Channel Manager
 *
 * Manages WebRTC RTCDataChannel connections for peer-to-peer file transfer.
 * Uses PartyKit for signaling and peer discovery.
 */

import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptFile,
  decryptFile,
  type KeyPair,
  type EncryptedChunk,
} from "./encryption";

export type PeerStatus = "connecting" | "connected" | "disconnected" | "failed";

export interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  sharedKey: CryptoKey | null;
  status: PeerStatus;
}

export interface FileTransfer {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  progress: number;
  status: "encrypting" | "sending" | "receiving" | "verifying" | "complete" | "failed";
  checksum?: string;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const DC_LABEL = "files";
const DC_CONFIG: RTCDataChannelInit = { ordered: true };

type MessageHandler = (peerId: string, data: unknown) => void;

export class P2PManager {
  private peers: Map<string, PeerConnection> = new Map();
  private keyPair: KeyPair | null = null;
  private sendChannel: RTCDataChannel | null = null;
  private roomSocket: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private localPeerId: string = "";

  constructor(
    private partyKitHost: string,
    private roomName: string,
  ) {
    this.localPeerId = crypto.randomUUID();
  }

  async initialize(): Promise<string> {
    this.keyPair = await generateKeyPair();
    const publicKey = await exportPublicKey(this.keyPair.publicKey);

    return this.localPeerId;
  }

  connectToSignaling(): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
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
      this.sendMessage({
        type: "peer-join",
        peerId: this.localPeerId,
      });
    };
  }

  private async handleSignalingMessage(message: Record<string, unknown>): Promise<void> {
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
          await this.initiateConnection(message.peerId as string);
        }
        break;
    }
  }

  private async initiateConnection(peerId: string): Promise<void> {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const peer: PeerConnection = {
      peerId,
      connection: pc,
      dataChannel: null,
      sharedKey: null,
      status: "connecting",
    };

    this.peers.set(peerId, peer);

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
      peer.status = this.mapConnectionState(pc.connectionState);
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

  private async handleOffer(
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
    };

    this.peers.set(peerId, peer);

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
      peer.status = this.mapConnectionState(pc.connectionState);
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

  private async handleAnswer(
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

  private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    channel.onopen = () => {
      const peer = this.peers.get(peerId);
      if (peer) peer.status = "connected";
      this.deriveKeyForPeer(peerId);
      this.notifyHandlers();
    };

    channel.onclose = () => {
      const peer = this.peers.get(peerId);
      if (peer) peer.status = "disconnected";
      this.notifyHandlers();
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const handler of this.messageHandlers) {
          handler(peerId, data);
        }
      } catch {
        // Binary data — handled separately
      }
    };
  }

  private async deriveKeyForPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || !this.keyPair) return;

    // In production, the peer's public key would be exchanged via signaling
    // For now, we use a simplified key exchange through the data channel
    const publicKeyStr = await exportPublicKey(this.keyPair.publicKey);

    peer.dataChannel?.send(
      JSON.stringify({ type: "key-exchange", publicKey: publicKeyStr }),
    );
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  private sendMessage(message: Record<string, unknown>): void {
    if (this.roomSocket?.readyState === WebSocket.OPEN) {
      this.roomSocket.send(JSON.stringify(message));
    }
  }

  private notifyHandlers(): void {
    for (const handler of this.messageHandlers) {
      handler("__status__", { peers: this.getPeersStatus() });
    }
  }

  getPeersStatus(): Array<{ peerId: string; status: PeerStatus }> {
    return Array.from(this.peers.values()).map((p) => ({
      peerId: p.peerId,
      status: p.status,
    }));
  }

  private mapConnectionState(state: RTCPeerConnectionState): PeerStatus {
    switch (state) {
      case "connected":
        return "connected";
      case "disconnected":
      case "closed":
        return "disconnected";
      case "failed":
        return "failed";
      default:
        return "connecting";
    }
  }

  async sendFile(file: File, peerId: string): Promise<FileTransfer> {
    const peer = this.peers.get(peerId);
    if (!peer?.sharedKey || !peer.dataChannel) {
      throw new Error("Not connected to peer or key not derived");
    }

    const transfer: FileTransfer = {
      id: crypto.randomUUID(),
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

      // Send metadata first
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

      // Send encrypted chunks
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

      // Send completion signal
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

  disconnect(): void {
    for (const peer of this.peers.values()) {
      peer.dataChannel?.close();
      peer.connection.close();
    }
    this.peers.clear();
    this.roomSocket?.close();
    this.keyPair = null;
  }
}
