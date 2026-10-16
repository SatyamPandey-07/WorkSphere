/**
 * ComputeMesh.ts
 * Manages the lifecycle of RTCPeerConnections and negotiates compute capabilities
 * with local peers in the same physical mesh network.
 */

export interface PeerCapabilities {
  peerId: string;
  cpuCores: number;
  availableMemoryMB: number;
  maxChunkSizeBytes: number;
  batteryLevel: number;
  isIdle: boolean;
}

export interface MeshPeer {
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  capabilities: PeerCapabilities | null;
  lastHeartbeat: number;
}

export type MeshEventType = 'peer-joined' | 'peer-left' | 'capabilities-updated' | 'error';

export class ComputeMeshNetwork {
  private peers: Map<string, MeshPeer> = new Map();
  private localCapabilities: PeerCapabilities;
  private eventListeners: Map<MeshEventType, Set<(data: any) => void>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(localCapabilities: PeerCapabilities) {
    this.localCapabilities = localCapabilities;
    this.startHeartbeat();
  }

  public on(event: MeshEventType, callback: (data: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  private emit(event: MeshEventType, data: any): void {
    this.eventListeners.get(event)?.forEach(cb => cb(data));
  }

  public async createOffer(targetPeerId: string, signalServer: any): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    const dataChannel = pc.createDataChannel('compute-burst', {
      ordered: true,
      maxRetransmits: 3
    });

    this.setupDataChannelEvents(dataChannel, targetPeerId);
    this.setupPeerConnectionEvents(pc, targetPeerId, signalServer);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.peers.set(targetPeerId, {
      connection: pc,
      dataChannel,
      capabilities: null,
      lastHeartbeat: Date.now()
    });

    return pc.localDescription!;
  }

  public async handleOffer(targetPeerId: string, offer: RTCSessionDescriptionInit, signalServer: any): Promise<RTCSessionDescriptionInit> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannelEvents(channel, targetPeerId);
      const peer = this.peers.get(targetPeerId);
      if (peer) peer.dataChannel = channel;
    };

    this.setupPeerConnectionEvents(pc, targetPeerId, signalServer);
    await pc.setRemoteDescription(offer);
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.peers.set(targetPeerId, {
      connection: pc,
      dataChannel: null,
      capabilities: null,
      lastHeartbeat: Date.now()
    });

    return pc.localDescription!;
  }

  public async handleAnswer(targetPeerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(targetPeerId);
    if (peer) {
      await peer.connection.setRemoteDescription(answer);
    }
  }

  private setupDataChannelEvents(channel: RTCDataChannel, peerId: string): void {
    channel.onopen = () => {
      this.sendCapabilities(channel);
      this.emit('peer-joined', { peerId });
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'capabilities') {
          const peer = this.peers.get(peerId);
          if (peer) {
            peer.capabilities = data.payload;
            this.emit('capabilities-updated', { peerId, capabilities: data.payload });
          }
        }
      } catch (err) {
        // Binary data handling for chunks is managed by TaskChunker
      }
    };

    channel.onclose = () => {
      this.peers.delete(peerId);
      this.emit('peer-left', { peerId });
    };
  }

  private setupPeerConnectionEvents(pc: RTCPeerConnection, peerId: string, signalServer: any): void {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalServer.sendIceCandidate(peerId, event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.peers.delete(peerId);
        this.emit('peer-left', { peerId });
      }
    };
  }

  private sendCapabilities(channel: RTCDataChannel): void {
    if (channel.readyState === 'open') {
      channel.send(JSON.stringify({
        type: 'capabilities',
        payload: this.localCapabilities
      }));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      this.peers.forEach((peer, peerId) => {
        if (now - peer.lastHeartbeat > 15000) {
          peer.connection.close();
          this.peers.delete(peerId);
          this.emit('peer-left', { peerId });
        } else if (peer.dataChannel?.readyState === 'open') {
          peer.dataChannel.send(JSON.stringify({ type: 'ping', timestamp: now }));
        }
      });
    }, 5000);
  }

  public getAvailablePeers(): MeshPeer[] {
    return Array.from(this.peers.values()).filter(p => p.capabilities?.isIdle && p.dataChannel?.readyState === 'open');
  }

  public destroy(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.peers.forEach(peer => peer.connection.close());
    this.peers.clear();
  }
}
