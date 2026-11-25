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

export const INITIAL_RECONNECT_DELAY_MS = 1000;
export const MAX_RECONNECT_DELAY_MS = 30000;
export const MAX_RECONNECT_JITTER_MS = 500;

export function calculateReconnectBackoffDelay(
  attempts: number,
  options?: {
    initialDelay?: number;
    maxDelay?: number;
    randomJitter?: number;
  }
): number {
  const initialDelay = options?.initialDelay ?? INITIAL_RECONNECT_DELAY_MS;
  const maxDelay = options?.maxDelay ?? MAX_RECONNECT_DELAY_MS;
  const jitter =
    options?.randomJitter !== undefined
      ? options.randomJitter
      : Math.random() * MAX_RECONNECT_JITTER_MS;

  const delay = Math.min(
    initialDelay * Math.pow(2, Math.max(0, attempts)) + jitter,
    maxDelay
  );

  return Math.min(delay, maxDelay);
}

interface PeerReconnectState {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const meshPeerReconnectRegistry = new Map<string, PeerReconnectState>();

export function getMeshPeerReconnectState(peerId: string): {
  attempts: number;
  hasActiveTimer: boolean;
} {
  const state = meshPeerReconnectRegistry.get(peerId);
  return {
    attempts: state ? state.attempts : 0,
    hasActiveTimer: !!(state && state.timer !== null),
  };
}

export function resetMeshPeerReconnect(peerId: string): void {
  const state = meshPeerReconnectRegistry.get(peerId);
  if (state) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    meshPeerReconnectRegistry.delete(peerId);
  }
}

export function clearAllMeshPeerReconnects(): void {
  for (const state of meshPeerReconnectRegistry.values()) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }
  meshPeerReconnectRegistry.clear();
}

export function handleMeshPeerPingAck(peerId: string): void {
  const state = meshPeerReconnectRegistry.get(peerId);
  if (state) {
    state.attempts = 0;
  }
}

export function scheduleMeshPeerReconnect(
  peerId: string,
  reconnectCallback: () => void | Promise<void>,
  options?: {
    initialDelay?: number;
    maxDelay?: number;
    randomJitter?: number;
  }
): number | null {
  if (!peerId) return null;

  let state = meshPeerReconnectRegistry.get(peerId);
  if (!state) {
    state = { attempts: 0, timer: null };
    meshPeerReconnectRegistry.set(peerId, state);
  }

  // Prevent multiple simultaneous reconnect timers for the same peer
  if (state.timer !== null) {
    return null;
  }

  const delay = calculateReconnectBackoffDelay(state.attempts, options);
  state.attempts++;

  state.timer = setTimeout(() => {
    if (state) {
      state.timer = null;
    }
    try {
      void reconnectCallback();
    } catch (err) {
      console.warn(`[MeshPeerConnection] Reconnect callback error for peer ${peerId}:`, err);
    }
  }, delay);

  if (state.timer && typeof (state.timer as any).unref === 'function') {
    (state.timer as any).unref();
  }

  return delay;
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
      resetMeshPeerReconnect(this.peerId);
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
    resetMeshPeerReconnect(this.peerId);
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
  peerId?: string;
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
    peerId?: string;
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
      peerId: options?.peerId,
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
    if (options?.peerId) {
      session.peerId = options.peerId;
    }
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
        if (session.peerId) {
          handleMeshPeerPingAck(session.peerId);
        }
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

  startDataChannelKeepalive(channel, { peerId: peer.peerId });
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

/**
 * DataChannel listener tracking registry to prevent memory leaks and duplicate listeners
 * across peer reconnections, ICE renegotiations, and channel replacements.
 */
type ChannelListenerMap = Map<string, Set<EventListenerOrEventListenerObject>>;
const channelListenerRegistry = new WeakMap<RTCDataChannel, ChannelListenerMap>();

export function registerDataChannelListener(
  channel: RTCDataChannel,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
): void {
  if (!channel || typeof channel.addEventListener !== 'function') return;

  let listenerMap = channelListenerRegistry.get(channel);
  if (!listenerMap) {
    listenerMap = new Map();
    channelListenerRegistry.set(channel, listenerMap);
  }

  let listenersForType = listenerMap.get(type);
  if (!listenersForType) {
    listenersForType = new Set();
    listenerMap.set(type, listenersForType);
  }

  // Idempotent registration: attach if not already tracked
  if (!listenersForType.has(listener)) {
    channel.addEventListener(type, listener, options);
    listenersForType.add(listener);
  }
}

export function unregisterDataChannelListener(
  channel: RTCDataChannel,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions
): void {
  if (!channel || typeof channel.removeEventListener !== 'function') return;

  const listenerMap = channelListenerRegistry.get(channel);
  if (listenerMap) {
    const listenersForType = listenerMap.get(type);
    if (listenersForType && listenersForType.has(listener)) {
      channel.removeEventListener(type, listener, options);
      listenersForType.delete(listener);
      if (listenersForType.size === 0) {
        listenerMap.delete(type);
      }
    }
  } else {
    channel.removeEventListener(type, listener, options);
  }
}

export function cleanupDataChannelListeners(channel: RTCDataChannel): void {
  if (!channel) return;

  const listenerMap = channelListenerRegistry.get(channel);
  if (listenerMap && typeof channel.removeEventListener === 'function') {
    for (const [type, listeners] of listenerMap.entries()) {
      for (const listener of listeners) {
        try {
          channel.removeEventListener(type, listener);
        } catch {
          // Ignore removal errors on closed or mock channels
        }
      }
    }
    listenerMap.clear();
    channelListenerRegistry.delete(channel);
  }

  // Clear property event handlers as well to prevent memory leaks from inline handlers
  try {
    channel.onmessage = null;
    channel.onerror = null;
    channel.onclose = null;
    channel.onopen = null;
  } catch {
    // Ignore property assignment errors on strict mocks
  }
}

export function getDataChannelListenerCount(
  channel: RTCDataChannel,
  type?: string
): number {
  const listenerMap = channelListenerRegistry.get(channel);
  if (!listenerMap) return 0;
  if (type) {
    return listenerMap.get(type)?.size ?? 0;
  }
  let total = 0;
  for (const listeners of listenerMap.values()) {
    total += listeners.size;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Issue #9727: Automatic WebRTC TURN Relay Bandwidth Budget Throttle
// ---------------------------------------------------------------------------

export type TurnRelayStatus = 'direct' | 'relay' | 'unknown';

export interface CandidatePairStatsInfo {
  candidatePairId: string;
  localCandidateType?: string;
  remoteCandidateType?: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  currentRoundTripTime?: number;
  relayStatus: TurnRelayStatus;
}

/**
 * Inspects an RTCStatsReport from RTCPeerConnection.getStats() and detects
 * whether the active candidate pair uses a TURN relay (`candidateType === "relay"`).
 */
export function detectCandidatePairRelay(stats: RTCStatsReport): {
  status: TurnRelayStatus;
  isRelayed: boolean;
  localCandidateType?: string;
  remoteCandidateType?: string;
  activePair?: CandidatePairStatsInfo;
} {
  if (!stats || typeof stats.forEach !== 'function') {
    return { status: 'unknown', isRelayed: false };
  }

  const candidatesById = new Map<string, { id: string; candidateType?: string; type?: string }>();
  const candidatePairs: any[] = [];
  let transportSelectedPairId: string | undefined;

  stats.forEach((report: any) => {
    if (!report || typeof report !== 'object' || !report.type) return;

    if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
      candidatesById.set(report.id, {
        id: report.id,
        candidateType: report.candidateType || report.type,
      });
    } else if (report.type === 'transport' && report.selectedCandidatePairId) {
      transportSelectedPairId = report.selectedCandidatePairId;
    } else if (report.type === 'candidate-pair') {
      candidatePairs.push(report);
    }
  });

  // Find active candidate pair
  let activePairReport = candidatePairs.find(
    (cp) => transportSelectedPairId && cp.id === transportSelectedPairId
  );

  if (!activePairReport) {
    activePairReport = candidatePairs.find(
      (cp) => cp.selected === true || (cp.nominated === true && (cp.state === 'succeeded' || !cp.state))
    );
  }

  if (!activePairReport) {
    activePairReport = candidatePairs.find((cp) => cp.nominated === true);
  }

  if (!activePairReport && candidatePairs.length > 0) {
    activePairReport = candidatePairs.find((cp) => cp.state === 'succeeded');
  }

  if (!activePairReport) {
    return { status: 'unknown', isRelayed: false };
  }

  const localCand = activePairReport.localCandidateId
    ? candidatesById.get(activePairReport.localCandidateId)
    : undefined;
  const remoteCand = activePairReport.remoteCandidateId
    ? candidatesById.get(activePairReport.remoteCandidateId)
    : undefined;

  const localType = (localCand?.candidateType || activePairReport.localCandidateType || '').toLowerCase();
  const remoteType = (remoteCand?.candidateType || activePairReport.remoteCandidateType || '').toLowerCase();

  let relayStatus: TurnRelayStatus = 'unknown';

  if (localType === 'relay' || remoteType === 'relay') {
    relayStatus = 'relay';
  } else if (
    (localType === 'host' || localType === 'srflx' || localType === 'prflx') &&
    (remoteType === 'host' || remoteType === 'srflx' || remoteType === 'prflx')
  ) {
    relayStatus = 'direct';
  } else if (localType || remoteType) {
    relayStatus = localType === 'relay' || remoteType === 'relay' ? 'relay' : 'direct';
  }

  const activePair: CandidatePairStatsInfo = {
    candidatePairId: activePairReport.id,
    localCandidateType: localType || undefined,
    remoteCandidateType: remoteType || undefined,
    state: activePairReport.state,
    nominated: activePairReport.nominated,
    selected: activePairReport.selected,
    currentRoundTripTime: activePairReport.currentRoundTripTime,
    relayStatus,
  };

  return {
    status: relayStatus,
    isRelayed: relayStatus === 'relay',
    localCandidateType: localType || undefined,
    remoteCandidateType: remoteType || undefined,
    activePair,
  };
}

/**
 * 48 kbps bandwidth budget constants.
 * 48 kbps = 48,000 bits/sec = 6,000 bytes/sec.
 */
export const RELAY_BANDWIDTH_BUDGET_BPS = 48_000;
export const RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC = 6_000;
export const RELAY_BURST_CAPACITY_BYTES = 12_000; // 2 seconds burst capacity
export const RELAY_BUFFERED_LOW_THRESHOLD_BYTES = 6_000; // 1 second threshold

export type MessagePriority = 'high' | 'normal' | 'low';

export interface QueuedDataChannelMessage {
  id: number;
  data: string | ArrayBuffer | Uint8Array;
  byteLength: number;
  priority: MessagePriority;
  timestamp: number;
  channel: RTCDataChannel;
  coalesceKey?: string;
}

export interface DataChannelRateLimiterConfig {
  bytesPerSecond?: number;
  burstCapacityBytes?: number;
  maxQueueBytes?: number;
  maxQueueMessages?: number;
  maxQueueSize?: number;
  maxBufferedAmountBytes?: number;
  onThrottled?: (queueLength: number, queuedBytes: number) => void;
  onDrain?: () => void;
}

/**
 * Token bucket rate limiter for WebRTC DataChannels.
 * Enforces an aggregate bandwidth ceiling (e.g., 48 kbps = 6,000 bytes/s) across DataChannels,
 * supports priority queues (high/normal/low), coalesces replaceable updates (e.g. cursor moves),
 * and cooperates with browser backpressure (`channel.bufferedAmount` & `bufferedamountlow`).
 */
export class DataChannelRateLimiter {
  private readonly bytesPerSecond: number;
  private readonly burstCapacity: number;
  private readonly maxQueueBytes: number;
  private readonly maxQueueMessages: number;
  private readonly maxBufferedAmountBytes: number;
  private readonly onThrottled?: (queueLength: number, queuedBytes: number) => void;
  private readonly onDrain?: () => void;

  private tokens: number;
  private lastRefillTimestamp: number;
  private queue: QueuedDataChannelMessage[] = [];
  private queuedBytes: number = 0;
  private nextMessageId: number = 1;
  private drainTimer: NodeJS.Timeout | null = null;
  private isDraining: boolean = false;
  private isEnabled: boolean = true;
  private activeChannels = new Set<RTCDataChannel>();

  constructor(config: DataChannelRateLimiterConfig = {}) {
    this.bytesPerSecond = config.bytesPerSecond ?? RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC;
    this.burstCapacity = config.burstCapacityBytes ?? RELAY_BURST_CAPACITY_BYTES;
    this.tokens = this.burstCapacity;
    this.lastRefillTimestamp = Date.now();
    this.maxQueueBytes = config.maxQueueBytes ?? 256 * 1024; // 256 KB
    this.maxQueueMessages = config.maxQueueSize ?? config.maxQueueMessages ?? 500;
    this.maxBufferedAmountBytes = config.maxBufferedAmountBytes ?? RELAY_BUFFERED_LOW_THRESHOLD_BYTES * 2;
    this.onThrottled = config.onThrottled;
    this.onDrain = config.onDrain;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.drainAllImmediately();
    } else {
      this.lastRefillTimestamp = Date.now();
      this.tokens = this.burstCapacity;
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getQueuedCount(): number {
    return this.queue.length;
  }

  public getQueuedBytes(): number {
    return this.queuedBytes;
  }

  public getAvailableTokens(): number {
    this.refillTokens();
    return this.tokens;
  }

  private refillTokens(now = Date.now()): void {
    const elapsedSeconds = Math.max(0, (now - this.lastRefillTimestamp) / 1000);
    this.lastRefillTimestamp = now;
    this.tokens = Math.min(
      this.burstCapacity,
      this.tokens + elapsedSeconds * this.bytesPerSecond
    );
  }

  public registerChannel(channel: RTCDataChannel): void {
    if (!channel || this.activeChannels.has(channel)) return;
    this.activeChannels.add(channel);

    try {
      if (typeof channel.bufferedAmountLowThreshold === 'number') {
        channel.bufferedAmountLowThreshold = RELAY_BUFFERED_LOW_THRESHOLD_BYTES;
      }
    } catch {
      // Ignore on mock/restricted channels
    }

    const lowHandler = () => {
      this.stopDrainTimer();
      this.processQueue();
    };

    registerDataChannelListener(channel, 'bufferedamountlow', lowHandler);
    registerDataChannelListener(channel, 'close', () => {
      this.activeChannels.delete(channel);
      this.dropMessagesForChannel(channel);
    });
  }

  public unregisterChannel(channel: RTCDataChannel): void {
    this.activeChannels.delete(channel);
    this.dropMessagesForChannel(channel);
  }

  private dropMessagesForChannel(channel: RTCDataChannel): void {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter((msg) => {
      if (msg.channel === channel) {
        this.queuedBytes -= msg.byteLength;
        return false;
      }
      return true;
    });
    if (this.queue.length < initialLen && this.queue.length === 0) {
      this.stopDrainTimer();
      this.onDrain?.();
    }
  }

  /**
   * Alias for enqueue for ergonomic use.
   */
  public send(
    channel: RTCDataChannel,
    data: string | ArrayBuffer | Uint8Array,
    options: {
      priority?: MessagePriority;
      coalesceKey?: string;
      coalescingKey?: string;
    } = {}
  ): boolean {
    const coalesceKey = options.coalesceKey ?? options.coalescingKey;
    return this.enqueue(channel, data, {
      priority: options.priority,
      coalesceKey,
    });
  }

  /**
   * Enqueues or immediately sends a message through a DataChannel.
   * If rate limiter is disabled, sends immediately.
   * If coalesceKey is provided, replaces any existing unsent message with the same coalesceKey.
   */
  public enqueue(
    channel: RTCDataChannel,
    data: string | ArrayBuffer | Uint8Array,
    options: {
      priority?: MessagePriority;
      coalesceKey?: string;
    } = {}
  ): boolean {
    if (channel.readyState !== 'open') {
      return false;
    }

    this.registerChannel(channel);

    // If disabled, bypass token bucket and send directly
    if (!this.isEnabled) {
      try {
        channel.send(data as any);
        return true;
      } catch {
        return false;
      }
    }

    const byteLength =
      typeof data === 'string'
        ? (typeof Buffer !== 'undefined' ? Buffer.byteLength(data, 'utf8') : new TextEncoder().encode(data).byteLength)
        : data.byteLength;
    this.refillTokens();

    // If coalesceKey is provided, check if a message with that key already exists in queue
    if (options.coalesceKey) {
      const existingIdx = this.queue.findIndex(
        (m) => m.channel === channel && m.coalesceKey === options.coalesceKey
      );
      if (existingIdx !== -1) {
        this.queuedBytes -= this.queue[existingIdx].byteLength;
        this.queue[existingIdx] = {
          id: this.nextMessageId++,
          data,
          byteLength,
          priority: options.priority ?? 'low',
          timestamp: Date.now(),
          channel,
          coalesceKey: options.coalesceKey,
        };
        this.queuedBytes += byteLength;
        this.scheduleDrain(0);
        return true;
      }
    }

    // If queue is empty, channel has buffer headroom, and we have enough tokens, send immediately!
    const bufferedAmount = channel.bufferedAmount ?? 0;
    if (
      this.queue.length === 0 &&
      bufferedAmount <= RELAY_BUFFERED_LOW_THRESHOLD_BYTES &&
      this.tokens >= byteLength
    ) {
      try {
        this.tokens -= byteLength;
        channel.send(data as any);
        return true;
      } catch {
        // If send fails, fall through to queue
      }
    }

    // Queue bounds check
    if (
      this.queuedBytes + byteLength > this.maxQueueBytes ||
      this.queue.length >= this.maxQueueMessages
    ) {
      // Try to drop low-priority items first
      const dropIdx = this.queue.findIndex((m) => m.priority === 'low');
      if (dropIdx !== -1) {
        const dropped = this.queue.splice(dropIdx, 1)[0];
        this.queuedBytes -= dropped.byteLength;
      } else {
        // Cannot fit
        this.onThrottled?.(this.queue.length, this.queuedBytes);
        return false;
      }
    }

    const item: QueuedDataChannelMessage = {
      id: this.nextMessageId++,
      data,
      byteLength,
      priority: options.priority ?? 'normal',
      timestamp: Date.now(),
      channel,
      coalesceKey: options.coalesceKey,
    };

    // Priority ordering: high -> normal -> low
    const priorityWeight: Record<MessagePriority, number> = {
      high: 3,
      normal: 2,
      low: 1,
    };

    let insertIdx = this.queue.length;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (priorityWeight[this.queue[i].priority] >= priorityWeight[item.priority]) {
        insertIdx = i + 1;
        break;
      }
      if (i === 0) {
        insertIdx = 0;
      }
    }

    this.queue.splice(insertIdx, 0, item);
    this.queuedBytes += byteLength;

    this.onThrottled?.(this.queue.length, this.queuedBytes);
    this.scheduleDrain(0);
    return true;
  }

  private scheduleDrain(delayMs: number): void {
    if (this.drainTimer !== null) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.processQueue();
    }, Math.max(0, delayMs));

    if (this.drainTimer && typeof (this.drainTimer as any).unref === 'function') {
      (this.drainTimer as any).unref();
    }
  }

  private stopDrainTimer(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private processQueue(): void {
    if (this.isDraining || this.queue.length === 0) return;
    this.isDraining = true;

    try {
      this.refillTokens();

      while (this.queue.length > 0) {
        const next = this.queue[0];
        const channel = next.channel;

        if (channel.readyState !== 'open') {
          // Channel closed, drop this message
          this.queue.shift();
          this.queuedBytes -= next.byteLength;
          continue;
        }

        const bufferedAmount = channel.bufferedAmount ?? 0;
        if (bufferedAmount > this.maxBufferedAmountBytes) {
          // Channel is congested, wait for bufferedamountlow event
          break;
        }

        if (this.tokens < next.byteLength) {
          // Need to wait for tokens
          const deficit = next.byteLength - this.tokens;
          const waitMs = Math.ceil((deficit / this.bytesPerSecond) * 1000);
          this.scheduleDrain(Math.max(10, waitMs));
          break;
        }

        // We have tokens and channel buffer is ready
        this.queue.shift();
        this.queuedBytes -= next.byteLength;
        this.tokens -= next.byteLength;

        try {
          channel.send(next.data as any);
        } catch (err) {
          console.warn('Error sending rate-limited DataChannel message:', err);
        }
      }

      if (this.queue.length === 0) {
        this.onDrain?.();
      }
    } finally {
      this.isDraining = false;
    }
  }

  private drainAllImmediately(): void {
    this.stopDrainTimer();
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.queuedBytes -= next.byteLength;
      if (next.channel.readyState === 'open') {
        try {
          next.channel.send(next.data as any);
        } catch {
          // Ignore
        }
      }
    }
    this.onDrain?.();
  }

  public destroy(): void {
    this.stopDrainTimer();
    this.queue = [];
    this.queuedBytes = 0;
    this.activeChannels.clear();
  }
}

/**
 * Adaptive relay audio and whiteboard coordinator per peer connection.
 */
export const RELAY_OPTIMIZED_AUDIO_BITRATE_BPS = 24_000; // 24 kbps in relay mode
export const DIRECT_RESTORED_AUDIO_BITRATE_BPS = 64_000; // 64 kbps in direct mode
export const RELAY_WHITEBOARD_THROTTLE_MS = 250; // Throttled update rate for cursor/preview in relay mode
export const DIRECT_WHITEBOARD_THROTTLE_MS = 33; // ~30 fps update rate for direct P2P mode
