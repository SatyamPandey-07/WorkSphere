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
    cleanupMeshPeerDataChannels(this);
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

/**
 * 15-second keepalive interval for WebRTC DataChannels to prevent cellular NAT gateway timeouts.
 * Issue #9895: keepalive ping on 15s intervals
 */
export const DATA_CHANNEL_KEEPALIVE_INTERVAL_MS = 15_000;

export interface KeepalivePingPacket {
  type: 'PING';
  ts: number;
}

export interface KeepalivePongPacket {
  type: 'PONG';
  ts: number;
}

export type KeepalivePacket = KeepalivePingPacket | KeepalivePongPacket;

export function isKeepalivePacket(data: unknown): data is KeepalivePacket {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Record<string, unknown>;
  return (
    (candidate.type === 'PING' || candidate.type === 'PONG') &&
    typeof candidate.ts === 'number' &&
    Number.isFinite(candidate.ts)
  );
}

interface ChannelKeepaliveSession {
  channel: RTCDataChannel;
  timer: ReturnType<typeof setInterval> | null;
  intervalMs: number;
  onOpenHandler: (() => void) | null;
  onMessageHandler: ((event: MessageEvent) => void) | null;
  onCloseHandler: (() => void) | null;
  onErrorHandler: ((event: Event) => void) | null;
  onPongReceived?: (ts: number, rttMs?: number) => void;
}

const channelKeepaliveRegistry = new WeakMap<RTCDataChannel, ChannelKeepaliveSession>();
const peerDataChannelsRegistry = new WeakMap<MeshPeerConnection, Set<RTCDataChannel>>();

/**
 * Checks whether keepalive is currently active/running on a DataChannel.
 */
export function isDataChannelKeepaliveActive(channel: RTCDataChannel): boolean {
  if (!channel) return false;
  const session = channelKeepaliveRegistry.get(channel);
  return session !== undefined && session.timer !== null;
}

/**
 * Starts sending a PING packet every 15 seconds over an open DataChannel.
 * Ensures at most one interval per channel, idempotent operation, and safe cleanup.
 */
export function startDataChannelKeepalive(
  channel: RTCDataChannel,
  options?: {
    intervalMs?: number;
    onPongReceived?: (ts: number, rttMs?: number) => void;
  }
): void {
  if (!channel) return;

  const intervalMs = options?.intervalMs ?? DATA_CHANNEL_KEEPALIVE_INTERVAL_MS;
  let session = channelKeepaliveRegistry.get(channel);

  if (!session) {
    session = {
      channel,
      timer: null,
      intervalMs,
      onOpenHandler: null,
      onMessageHandler: null,
      onCloseHandler: null,
      onErrorHandler: null,
      onPongReceived: options?.onPongReceived,
    };
    channelKeepaliveRegistry.set(channel, session);
    setupKeepaliveInterception(session, channel);
  } else {
    session.intervalMs = intervalMs;
    if (options?.onPongReceived) {
      session.onPongReceived = options.onPongReceived;
    }
  }

  // If channel is already open and timer not yet started, start interval
  if (channel.readyState === 'open' && session.timer === null) {
    startPingTimer(session, intervalMs);
  }
}

/**
 * Stops keepalive timers and removes listeners for a DataChannel.
 * Fully idempotent.
 */
export function stopDataChannelKeepalive(channel: RTCDataChannel): void {
  if (!channel) return;
  const session = channelKeepaliveRegistry.get(channel);
  if (!session) return;

  if (session.timer !== null) {
    clearInterval(session.timer);
    session.timer = null;
  }

  // Detach event listeners if they were added via addEventListener
  if (typeof channel.removeEventListener === 'function') {
    if (session.onOpenHandler) {
      channel.removeEventListener('open', session.onOpenHandler);
      session.onOpenHandler = null;
    }
    if (session.onMessageHandler) {
      channel.removeEventListener('message', session.onMessageHandler);
      session.onMessageHandler = null;
    }
    if (session.onCloseHandler) {
      channel.removeEventListener('close', session.onCloseHandler);
      session.onCloseHandler = null;
    }
    if (session.onErrorHandler) {
      channel.removeEventListener('error', session.onErrorHandler);
      session.onErrorHandler = null;
    }
  }

  channelKeepaliveRegistry.delete(channel);
}

function startPingTimer(session: ChannelKeepaliveSession, intervalMs: number): void {
  if (session.timer !== null) return;

  session.timer = setInterval(() => {
    const ch = session.channel;
    if (!ch || ch.readyState !== 'open') {
      if (session.timer !== null) {
        clearInterval(session.timer);
        session.timer = null;
      }
      return;
    }

    try {
      const pingPacket: KeepalivePingPacket = {
        type: 'PING',
        ts: Date.now(),
      };
      ch.send(JSON.stringify(pingPacket));
    } catch {
      // Ignore send errors during abrupt closing
    }
  }, intervalMs);

  if (session.timer && typeof (session.timer as any).unref === 'function') {
    (session.timer as any).unref();
  }
}

function setupKeepaliveInterception(
  session: ChannelKeepaliveSession,
  channel: RTCDataChannel
): void {
  session.onOpenHandler = () => {
    if (channel.readyState === 'open' && session.timer === null) {
      startPingTimer(session, DATA_CHANNEL_KEEPALIVE_INTERVAL_MS);
    }
  };

  session.onMessageHandler = (event: MessageEvent) => {
    handleIncomingChannelMessage(session, channel, event);
  };

  session.onCloseHandler = () => {
    stopDataChannelKeepalive(channel);
  };

  session.onErrorHandler = () => {
    if (channel.readyState === 'closed' || channel.readyState === 'closing') {
      stopDataChannelKeepalive(channel);
    }
  };

  if (typeof channel.addEventListener === 'function') {
    channel.addEventListener('open', session.onOpenHandler);
    channel.addEventListener('message', session.onMessageHandler);
    channel.addEventListener('close', session.onCloseHandler);
    channel.addEventListener('error', session.onErrorHandler);
  }
}

/**
 * Defensively inspects incoming message payload.
 * If PING -> replies with PONG and swallows message (does not invoke app handler).
 * If PONG -> consumes internally, updates RTT callback if available, and swallows message.
 * If unrelated message -> returns false so it continues to application handlers.
 */
export function handleIncomingChannelMessage(
  session: ChannelKeepaliveSession,
  channel: RTCDataChannel,
  event: MessageEvent
): boolean {
  if (typeof event.data === 'string') {
    let parsed: any = null;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      // Malformed JSON is not a heartbeat, pass through to application
      return false;
    }

    if (isKeepalivePacket(parsed)) {
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      if (parsed.type === 'PING') {
        if (channel.readyState === 'open') {
          try {
            const pongPacket: KeepalivePongPacket = {
              type: 'PONG',
              ts: parsed.ts, // Echo received ping timestamp
            };
            channel.send(JSON.stringify(pongPacket));
          } catch {
            // Ignore send errors
          }
        }
        return true; // Consumed heartbeat
      }

      if (parsed.type === 'PONG') {
        const now = Date.now();
        const rttMs = typeof parsed.ts === 'number' && parsed.ts > 0 ? Math.max(0, now - parsed.ts) : undefined;
        session.onPongReceived?.(parsed.ts, rttMs);
        return true; // Consumed heartbeat
      }
    }
  }

  return false;
}

/**
 * Tracks a DataChannel on a MeshPeerConnection instance and automatically starts keepalive.
 */
export function registerMeshPeerDataChannel(
  peer: MeshPeerConnection,
  channel: RTCDataChannel
): void {
  if (!peer || !channel) return;

  let channels = peerDataChannelsRegistry.get(peer);
  if (!channels) {
    channels = new Set();
    peerDataChannelsRegistry.set(peer, channels);
  }
  channels.add(channel);

  startDataChannelKeepalive(channel);
}

/**
 * Cleans up all DataChannels associated with a MeshPeerConnection instance.
 */
export function cleanupMeshPeerDataChannels(peer: MeshPeerConnection): void {
  if (!peer) return;
  const channels = peerDataChannelsRegistry.get(peer);
  if (channels) {
    for (const channel of channels) {
      stopDataChannelKeepalive(channel);
    }
    channels.clear();
    peerDataChannelsRegistry.delete(peer);
  }
}
