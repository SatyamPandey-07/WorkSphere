export const ICE_RESTART_TIMEOUT_MS = 10_000;

export interface MeshPeerConfig {
  peerId: string;
  iceServers?: RTCIceServer[];
  relayIceServers?: RTCIceServer[];
  iceRestartTimeoutMs?: number;
  onSendOffer?: (
    peerId: string,
    offer: RTCSessionDescriptionInit,
    options?: { forceRelay?: boolean }
  ) => Promise<void> | void;
  onIceCandidate?: (peerId: string, candidate: RTCIceCandidateInit) => void;
  onStateChange?: (
    peerId: string,
    state: RTCIceConnectionState | 'relay_reconnecting' | 'closed'
  ) => void;
}

export class MeshPeerConnection {
  public readonly peerId: string;
  private pc: RTCPeerConnection | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;
  private readonly iceServers: RTCIceServer[];
  private readonly relayIceServers: RTCIceServer[];
  private readonly restartTimeoutMs: number;
  private readonly onSendOffer?: MeshPeerConfig['onSendOffer'];
  private readonly onIceCandidate?: MeshPeerConfig['onIceCandidate'];
  private readonly onStateChange?: MeshPeerConfig['onStateChange'];

  constructor(config: MeshPeerConfig) {
    this.peerId = config.peerId;
    this.iceServers = config.iceServers ?? [
      { urls: 'stun:stun.l.google.com:19302' },
    ];
    this.relayIceServers = config.relayIceServers ?? this.iceServers;
    this.restartTimeoutMs = config.iceRestartTimeoutMs ?? ICE_RESTART_TIMEOUT_MS;
    this.onSendOffer = config.onSendOffer;
    this.onIceCandidate = config.onIceCandidate;
    this.onStateChange = config.onStateChange;
    this.attachPeerConnection(false);
  }

  public get connection(): RTCPeerConnection | null {
    return this.pc;
  }

  private attachPeerConnection(forceRelay: boolean): void {
    const rtcConfig: RTCConfiguration = {
      iceServers: forceRelay ? this.relayIceServers : this.iceServers,
      ...(forceRelay ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
    };

    const peer = new RTCPeerConnection(rtcConfig);
    peer.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(this.peerId, event.candidate.toJSON());
      }
    };

    peer.oniceconnectionstatechange = () => {
      this.handleIceConnectionStateChange(peer);
    };

    this.pc = peer;
  }

  public async handleIceConnectionStateChange(
    peer: RTCPeerConnection | null = this.pc
  ): Promise<void> {
    if (this.isClosed || !peer) return;

    const state = peer.iceConnectionState;
    this.onStateChange?.(this.peerId, state);

    if (state === 'connected' || state === 'completed') {
      this.clearRestartTimer();
      return;
    }

    if (state === 'disconnected' || state === 'failed') {
      await this.triggerIceRestart(peer);
    }
  }

  public async triggerIceRestart(
    peer: RTCPeerConnection | null = this.pc
  ): Promise<void> {
    if (this.isClosed || !peer) return;

    if (typeof peer.restartIce === 'function') {
      peer.restartIce();
    }

    this.startRestartTimeout();

    if (typeof peer.createOffer === 'function') {
      const offer = await peer.createOffer({ iceRestart: true });
      if (typeof peer.setLocalDescription === 'function') {
        await peer.setLocalDescription(offer);
      }
      await this.onSendOffer?.(this.peerId, offer, { forceRelay: false });
    }
  }

  private startRestartTimeout(): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      void this.fallbackToTurnRelay();
    }, this.restartTimeoutMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  public async fallbackToTurnRelay(): Promise<void> {
    if (this.isClosed) return;
    this.clearRestartTimer();

    if (this.pc) {
      this.pc.oniceconnectionstatechange = null;
      this.pc.onicecandidate = null;
      if (typeof this.pc.close === 'function') {
        this.pc.close();
      }
      this.pc = null;
    }

    this.onStateChange?.(this.peerId, 'relay_reconnecting');
    this.attachPeerConnection(true);

    const relayPeer = this.pc;
    if (relayPeer && typeof relayPeer.createOffer === 'function') {
      const offer = await relayPeer.createOffer({ iceRestart: true });
      if (typeof relayPeer.setLocalDescription === 'function') {
        await relayPeer.setLocalDescription(offer);
      }
      await this.onSendOffer?.(this.peerId, offer, { forceRelay: true });
    }
  }

  public close(): void {
    this.isClosed = true;
    this.clearRestartTimer();
    if (this.pc) {
      this.pc.oniceconnectionstatechange = null;
      this.pc.onicecandidate = null;
      if (typeof this.pc.close === 'function') {
        this.pc.close();
      }
      this.pc = null;
    }
    this.onStateChange?.(this.peerId, 'closed');
  }
}
