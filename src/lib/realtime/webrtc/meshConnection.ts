export interface RtspAudioSample {
  timestampMs: number;
  packetsSent: number;
  packetsLost: number;
  rttMs?: number;
}

export interface AdaptiveAudioTelemetryEvent {
  type: 'audio:bitrate_changed';
  peerId: string;
  previousBitrateBps: number;
  nextBitrateBps: number;
  lossFraction: number;
  rttMs: number;
  reason: string;
  timestampMs: number;
}

export const MIN_AUDIO_BITRATE_BPS = 16_000;
export const THROTTLED_AUDIO_BITRATE_BPS = 24_000;
export const MAX_AUDIO_BITRATE_BPS = 64_000;
export const SLIDING_WINDOW_MS = 5_000;

export function computeWindowedAudioMetrics(
  samples: RtspAudioSample[],
  windowMs = SLIDING_WINDOW_MS
): {
  lossFraction: number;
  avgRttMs: number;
  hasData: boolean;
} {
  if (samples.length === 0) {
    return { lossFraction: 0, avgRttMs: 0, hasData: false };
  }

  const latestTs = samples[samples.length - 1].timestampMs;
  const cutoff = latestTs - windowMs;
  const windowed = samples.filter((s) => s.timestampMs >= cutoff);
  const active = windowed.length >= 2 ? windowed : samples;

  const first = active[0];
  const last = active[active.length - 1];

  const deltaSent = Math.max(0, last.packetsSent - first.packetsSent);
  const deltaLost = Math.max(0, last.packetsLost - first.packetsLost);
  const totalPackets = deltaSent + deltaLost;
  const lossFraction = totalPackets > 0 ? deltaLost / totalPackets : 0;

  const rttValues = active
    .map((s) => s.rttMs)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);

  const avgRttMs =
    rttValues.length > 0
      ? rttValues.reduce((sum, v) => sum + v, 0) / rttValues.length
      : 0;

  return {
    lossFraction,
    avgRttMs,
    hasData: totalPackets > 0 || rttValues.length > 0,
  };
}

export function selectTargetAudioBitrateBps(
  currentBitrateBps: number,
  lossFraction: number,
  rttMs: number
): { targetBps: number; reason: string } {
  const clampedCurrent = Math.min(
    MAX_AUDIO_BITRATE_BPS,
    Math.max(MIN_AUDIO_BITRATE_BPS, currentBitrateBps)
  );

  if (lossFraction > 0.15) {
    return {
      targetBps: MIN_AUDIO_BITRATE_BPS,
      reason: `high_packet_loss (${(lossFraction * 100).toFixed(1)}%)`,
    };
  }

  if (lossFraction > 0.05) {
    return {
      targetBps: THROTTLED_AUDIO_BITRATE_BPS,
      reason: `elevated_packet_loss (${(lossFraction * 100).toFixed(1)}%)`,
    };
  }

  if (lossFraction < 0.01 && rttMs < 80) {
    const restoredBps =
      clampedCurrent < THROTTLED_AUDIO_BITRATE_BPS
        ? THROTTLED_AUDIO_BITRATE_BPS
        : MAX_AUDIO_BITRATE_BPS;
    return {
      targetBps: restoredBps,
      reason: `healthy_link (loss=${(lossFraction * 100).toFixed(2)}%, rtt=${Math.round(rttMs)}ms)`,
    };
  }

  return {
    targetBps: clampedCurrent,
    reason: 'hold_current_bitrate',
  };
}

export async function applyAudioMaxBitrate(
  sender: RTCRtpSender,
  maxBitrateBps: number
): Promise<boolean> {
  if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') {
    return false;
  }

  const boundedBitrate = Math.min(
    MAX_AUDIO_BITRATE_BPS,
    Math.max(MIN_AUDIO_BITRATE_BPS, Math.round(maxBitrateBps))
  );

  const params = sender.getParameters();
  const encodings = Array.isArray(params.encodings) && params.encodings.length > 0
    ? params.encodings
    : [{}];

  const nextEncodings = encodings.map((enc) => ({
    ...enc,
    maxBitrate: boundedBitrate,
  }));

  await sender.setParameters({
    ...params,
    encodings: nextEncodings,
  });

  return true;
}

export class AdaptiveAudioBitrateController {
  private readonly peerId: string;
  private readonly samples: RtspAudioSample[] = [];
  private readonly onTelemetry?: (event: AdaptiveAudioTelemetryEvent) => void;
  private currentBitrateBps: number;

  constructor(
    peerId: string,
    options: {
      initialBitrateBps?: number;
      onTelemetry?: (event: AdaptiveAudioTelemetryEvent) => void;
    } = {}
  ) {
    this.peerId = peerId;
    this.currentBitrateBps = Math.min(
      MAX_AUDIO_BITRATE_BPS,
      Math.max(
        MIN_AUDIO_BITRATE_BPS,
        options.initialBitrateBps ?? MAX_AUDIO_BITRATE_BPS
      )
    );
    this.onTelemetry = options.onTelemetry;
  }

  getBitrateBps(): number {
    return this.currentBitrateBps;
  }

  async sampleAndAdapt(
    pc: Pick<RTCPeerConnection, 'getStats' | 'getSenders'>,
    timestampMs = Date.now()
  ): Promise<number> {
    const stats = await pc.getStats();
    let packetsSent = 0;
    let packetsLost = 0;
    let rttMs: number | undefined;

    stats.forEach((report) => {
      const r = report as {
        type?: string;
        kind?: string;
        mediaType?: string;
        packetsSent?: number;
        packetsLost?: number;
        roundTripTime?: number;
      };
      const isAudio = r.kind === 'audio' || r.mediaType === 'audio';
      if (r.type === 'outbound-rtp' && isAudio && typeof r.packetsSent === 'number') {
        packetsSent += r.packetsSent;
      }
      if (r.type === 'remote-inbound-rtp') {
        if (typeof r.packetsLost === 'number') {
          packetsLost += r.packetsLost;
        }
        if (typeof r.roundTripTime === 'number') {
          rttMs = r.roundTripTime * 1000;
        }
      }
    });

    this.samples.push({ timestampMs, packetsSent, packetsLost, rttMs });
    const cutoff = timestampMs - SLIDING_WINDOW_MS * 2;
    while (this.samples.length > 0 && this.samples[0].timestampMs < cutoff) {
      this.samples.shift();
    }

    const { lossFraction, avgRttMs, hasData } = computeWindowedAudioMetrics(
      this.samples,
      SLIDING_WINDOW_MS
    );
    if (!hasData) {
      return this.currentBitrateBps;
    }

    const { targetBps, reason } = selectTargetAudioBitrateBps(
      this.currentBitrateBps,
      lossFraction,
      avgRttMs
    );

    if (targetBps !== this.currentBitrateBps) {
      const audioSender = pc
        .getSenders()
        .find((s) => s.track?.kind === 'audio');

      if (audioSender) {
        await applyAudioMaxBitrate(audioSender, targetBps);
      }

      const previousBitrateBps = this.currentBitrateBps;
      this.currentBitrateBps = targetBps;

      this.onTelemetry?.({
        type: 'audio:bitrate_changed',
        peerId: this.peerId,
        previousBitrateBps,
        nextBitrateBps: targetBps,
        lossFraction,
        rttMs: avgRttMs,
        reason,
        timestampMs,
      });
    }

    return this.currentBitrateBps;
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

