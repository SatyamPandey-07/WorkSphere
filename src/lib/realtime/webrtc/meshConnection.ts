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
