/**
 * WebRTC Simulcast Video Bitrate Ladder and Sender-Side Packet Loss Adaptation.
 *
 * Implements:
 * 1. Three-tier simulcast video bitrate ladder:
 *    - High: 1280x720, 30 fps, 1500 kbps (scaleResolutionDownBy = 1.0)
 *    - Medium: 640x360, 20 fps, 500 kbps (scaleResolutionDownBy = 2.0)
 *    - Low: 320x180, 15 fps, 150 kbps (scaleResolutionDownBy = 4.0)
 * 2. RTCP statistics monitoring via getStats() polled every ~2 seconds:
 *    - packet loss fraction (preferring fractionLost, falling back to delta loss ratio)
 *    - RTT (remote-inbound-rtp or candidate-pair)
 *    - jitter (inbound / remote-inbound)
 * 3. Adaptive degradation state machine:
 *    - NORMAL -> DEGRADED when packet loss > 8% OR RTT > 350ms
 *    - High layer is dynamically disabled via RTCRtpSender.setParameters()
 *    - Medium and Low layers remain active; audio is never touched
 *    - Recovers to NORMAL only after >15 consecutive seconds of stable healthy conditions
 *    - Any bad sample during recovery resets the recovery streak
 *    - Idempotent: avoids redundant setParameters() calls when state is unchanged
 */

export type SimulcastLayerId = "high" | "medium" | "low";

export type SimulcastAdaptationState = "NORMAL" | "DEGRADED";

export interface Resolution {
  width: number;
  height: number;
}

export interface SimulcastLayerConfig {
  rid: SimulcastLayerId;
  targetResolution: Resolution;
  maxBitrate: number; // bps
  maxFramerate: number; // fps
  scaleResolutionDownBy: number;
  active: boolean;
}

/**
 * Baseline 3-tier simulcast video bitrate ladder.
 * All layers are active by default.
 */
export const SIMULCAST_BITRATE_LADDER: readonly SimulcastLayerConfig[] = [
  {
    rid: "high",
    targetResolution: { width: 1280, height: 720 },
    maxBitrate: 1_500_000, // 1500 kbps
    maxFramerate: 30,
    scaleResolutionDownBy: 1.0,
    active: true,
  },
  {
    rid: "medium",
    targetResolution: { width: 640, height: 360 },
    maxBitrate: 500_000, // 500 kbps
    maxFramerate: 20,
    scaleResolutionDownBy: 2.0,
    active: true,
  },
  {
    rid: "low",
    targetResolution: { width: 320, height: 180 },
    maxBitrate: 150_000, // 150 kbps
    maxFramerate: 15,
    scaleResolutionDownBy: 4.0,
    active: true,
  },
] as const;

/**
 * Calculates appropriate scaleResolutionDownBy for a target layer height
 * given the camera's source capture height.
 * scaleResolutionDownBy must be >= 1.0.
 */
export function computeScaleResolutionDownBy(
  sourceHeight: number,
  targetHeight: number,
): number {
  if (targetHeight <= 0 || sourceHeight <= 0) return 1.0;
  const factor = sourceHeight / targetHeight;
  return Math.max(1.0, Math.round(factor * 100) / 100);
}

/**
 * Creates standard RTCRtpEncodingParameters for the 3 simulcast layers.
 * Scale factors are calculated relative to source resolution if provided.
 */
export function createSimulcastEncodings(
  sourceResolution?: Resolution,
): RTCRtpEncodingParameters[] {
  const sourceHeight = sourceResolution?.height ?? 720;

  return SIMULCAST_BITRATE_LADDER.map((layer) => ({
    rid: layer.rid,
    maxBitrate: layer.maxBitrate,
    maxFramerate: layer.maxFramerate,
    scaleResolutionDownBy: computeScaleResolutionDownBy(
      sourceHeight,
      layer.targetResolution.height,
    ),
    active: layer.active,
  }));
}

/**
 * Configures the 3-layer simulcast ladder on a video sender using RTCRtpSender.setParameters().
 * Audio senders are strictly bypassed to preserve audio behavior.
 */
export async function configureSimulcastSender(
  sender: RTCRtpSender,
  sourceResolution?: Resolution,
): Promise<RTCRtpParameters> {
  // Preserve existing audio behavior: do not configure video encodings on audio
  if (sender.track && sender.track.kind !== "video") {
    return sender.getParameters();
  }

  // Derive source height from track settings when available
  let resolvedHeight = sourceResolution?.height;
  if (!resolvedHeight && typeof sender.track?.getSettings === "function") {
    resolvedHeight = sender.track.getSettings().height;
  }

  const encodings = createSimulcastEncodings(
    resolvedHeight ? { width: Math.round((resolvedHeight * 16) / 9), height: resolvedHeight } : undefined,
  );

  const params = sender.getParameters() || {};
  if (params.encodings && params.encodings.length === encodings.length) {
    params.encodings.forEach((enc, i) => {
      enc.maxBitrate = encodings[i].maxBitrate;
      enc.maxFramerate = encodings[i].maxFramerate;
      enc.scaleResolutionDownBy = encodings[i].scaleResolutionDownBy;
      enc.active = encodings[i].active;
    });
    await sender.setParameters(params);
  } else if (!params.encodings || params.encodings.length === 0) {
    params.encodings = encodings;
    await sender.setParameters(params);
  }
  // If params.encodings exists and its length differs from encodings.length,
  // do not replace the browser-owned encoding array with a different-length array.
  return params;
}

export interface NetworkStats {
  packetLossFraction?: number; // 0.0 to 1.0 (e.g. 0.08 = 8%)
  rttMs?: number; // Round trip time in milliseconds
  jitterMs?: number; // Jitter in milliseconds
  timestamp: number;
}

export interface CumulativeStatsState {
  packetsLost?: number;
  packetsReceived?: number;
  packetsSent?: number;
  timestamp?: number;
}

/**
 * Extracts network hints (packet loss fraction, RTT, jitter) from an RTCStatsReport.
 * Handles both fractionLost (spec) and cumulative packet counts (calculating delta loss ratio).
 * Explicitly associates statistics with the video stream and filters out audio streams.
 */
export function extractRTCPStats(
  report: RTCStatsReport,
  previous?: CumulativeStatsState,
  videoSender?: RTCRtpSender,
): { stats: NetworkStats; cumulative: CumulativeStatsState } {
  let rttMs: number | undefined;
  let jitterMs: number | undefined;
  let fractionLost: number | undefined;
  let cumPacketsLost: number | undefined;
  let cumPacketsReceived: number | undefined;
  let cumPacketsSent: number | undefined;

  report.forEach((stat: any) => {
    // Audio safety: Never extract video loss/rtt/jitter from audio RTP streams
    if (stat.kind === "audio" || stat.mediaType === "audio") {
      return;
    }

    // If videoSender has a known track ID, ensure outbound-rtp matches if trackId is provided
    if (
      videoSender?.track?.id &&
      stat.trackId &&
      stat.trackId !== videoSender.track.id
    ) {
      return;
    }
    // 1. Candidate Pair (currentRoundTripTime is in seconds)
    if (stat.type === "candidate-pair" && (stat.state === "succeeded" || stat.nominated === true)) {
      if (typeof stat.currentRoundTripTime === "number") {
        const val = stat.currentRoundTripTime;
        rttMs = val < 10 ? val * 1000 : val;
      }
    }

    // 2. Remote Inbound RTP (RTCP Receiver Report for our outbound video stream)
    if (stat.type === "remote-inbound-rtp") {
      if (typeof stat.roundTripTime === "number") {
        const val = stat.roundTripTime;
        rttMs = val < 10 ? val * 1000 : val;
      }
      if (typeof stat.jitter === "number") {
        const val = stat.jitter;
        const jMs = val < 10 ? val * 1000 : val;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if (typeof stat.fractionLost === "number") {
        // Standard WebRTC RTCStatsReport: fractionLost is 0.0 to 1.0
        let f = stat.fractionLost;
        if (f > 100) f /= 255;
        else if (f > 1) f /= 100;
        fractionLost = Math.max(0, Math.min(1, f));
      }
      if (typeof stat.packetsLost === "number") {
        cumPacketsLost = stat.packetsLost;
      }
    }

    // 3. Inbound RTP (receiver-side statistics)
    if (stat.type === "inbound-rtp") {
      if (typeof stat.jitter === "number") {
        const val = stat.jitter;
        const jMs = val < 10 ? val * 1000 : val;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if (typeof stat.fractionLost === "number" && fractionLost === undefined) {
        let f = stat.fractionLost;
        if (f > 100) f /= 255;
        else if (f > 1) f /= 100;
        fractionLost = Math.max(0, Math.min(1, f));
      }
      if (typeof stat.packetsLost === "number" && cumPacketsLost === undefined) {
        cumPacketsLost = stat.packetsLost;
      }
      if (typeof stat.packetsReceived === "number") {
        cumPacketsReceived = stat.packetsReceived;
      }
    }

    // 4. Outbound RTP (for matching packetsSent)
    if (stat.type === "outbound-rtp") {
      if (typeof stat.packetsSent === "number") {
        cumPacketsSent = stat.packetsSent;
      }
    }
  });

  // If fractionLost was not provided directly by RTCP, calculate from deltas
  if (fractionLost === undefined && cumPacketsLost !== undefined) {
    const currentTotalPackets = (cumPacketsReceived ?? cumPacketsSent);
    if (previous && previous.packetsLost !== undefined) {
      const prevTotal = (previous.packetsReceived ?? previous.packetsSent ?? 0);
      const isCounterReset =
        (previous.packetsLost !== undefined && cumPacketsLost < previous.packetsLost) ||
        (currentTotalPackets !== undefined && prevTotal > 0 && currentTotalPackets < prevTotal);

      if (isCounterReset) {
        // Counter restarted: establish a fresh baseline without calculating skewed deltas
        if (currentTotalPackets !== undefined && (cumPacketsLost + currentTotalPackets) > 0) {
          fractionLost = Math.max(0, Math.min(1, cumPacketsLost / (cumPacketsLost + currentTotalPackets)));
        }
      } else {
        const deltaLost = Math.max(0, cumPacketsLost - (previous.packetsLost ?? 0));
        const deltaPackets = currentTotalPackets !== undefined
          ? Math.max(0, currentTotalPackets - prevTotal)
          : 0;
        const totalDelta = deltaLost + deltaPackets;
        if (totalDelta > 0) {
          fractionLost = Math.max(0, Math.min(1, deltaLost / totalDelta));
        }
      }
    } else if (currentTotalPackets !== undefined && (cumPacketsLost + currentTotalPackets) > 0) {
      fractionLost = Math.max(0, Math.min(1, cumPacketsLost / (cumPacketsLost + currentTotalPackets)));
    }
  }

  const stats: NetworkStats = {
    packetLossFraction: fractionLost,
    rttMs,
    jitterMs,
    timestamp: Date.now(),
  };

  const cumulative: CumulativeStatsState = {
    packetsLost: cumPacketsLost,
    packetsReceived: cumPacketsReceived,
    packetsSent: cumPacketsSent,
    timestamp: stats.timestamp,
  };

  return { stats, cumulative };
}

/**
 * Evaluates whether network conditions violate degradation thresholds.
 * Thresholds:
 * - packet loss fraction > 0.08 (8%)
 * - RTT > 350 ms
 */
export function evaluateNetworkCondition(stats: NetworkStats): {
  isBadSample: boolean;
  isHighLoss: boolean;
  isHighRtt: boolean;
} {
  const isHighLoss = stats.packetLossFraction !== undefined && stats.packetLossFraction > 0.08;
  const isHighRtt = stats.rttMs !== undefined && stats.rttMs > 350;
  const isBadSample = isHighLoss || isHighRtt;

  return { isBadSample, isHighLoss, isHighRtt };
}

/**
 * Modifies video sender parameters to enable or disable the high-resolution layer.
 * Medium and Low layers remain active.
 * Audio is never modified.
 * Returns true if setParameters() was called, false if already in the desired state.
 */
export async function setHighLayerActive(
  sender: RTCRtpSender,
  active: boolean,
): Promise<boolean> {
  // Audio safety check
  if (sender.track && sender.track.kind !== "video") {
    return false;
  }

  const params = sender.getParameters();
  if (!params || !params.encodings || params.encodings.length === 0) {
    return false;
  }

  // Identify high layer by rid 'high' / 'h', or by lowest scaleResolutionDownBy, or index 0
  let highIndex = params.encodings.findIndex(
    (e) => e.rid === "high" || e.rid === "h",
  );
  if (highIndex === -1) {
    if (params.encodings.length > 1) {
      highIndex = 0;
    } else {
      // Unicast stream without simulcast RID — do not disable
      return false;
    }
  }

  const highEncoding = params.encodings[highIndex];
  if (!highEncoding) return false;

  // Avoid unnecessary setParameters() calls if high layer is already in desired activation state
  if (highEncoding.active === active) {
    return false;
  }

  highEncoding.active = active;

  // Medium and low layers always remain active
  params.encodings.forEach((enc, index) => {
    if (index !== highIndex) {
      enc.active = true;
    }
  });

  await sender.setParameters(params);
  return true;
}

export interface SimulcastControllerOptions {
  pollIntervalMs?: number; // Default: 2000ms
  recoveryThresholdMs?: number; // Default: 15000ms
  onStateChange?: (state: SimulcastAdaptationState) => void;
}

/**
 * Controller that monitors RTCP stats and adapts the video simulcast ladder.
 *
 * State Machine:
 * NORMAL
 *   |
 *   | packet loss > 8% OR RTT > 350ms
 *   v
 * DEGRADED
 *   |
 *   | continuously healthy for > 15s (recovery timer resets on any bad sample)
 *   v
 * NORMAL
 */
export class SimulcastAdaptiveController {
  private pc: RTCPeerConnection;
  private videoSender: RTCRtpSender;
  private state: SimulcastAdaptationState = "NORMAL";
  private pollIntervalMs: number;
  private recoveryThresholdMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;
  private isPolling = false;
  private healthySince: number | null = null;
  private consecutiveHealthySamples = 0;
  private prevCumulativeStats?: CumulativeStatsState;
  private options: SimulcastControllerOptions;

  constructor(
    pc: RTCPeerConnection,
    videoSender: RTCRtpSender,
    options: SimulcastControllerOptions = {},
  ) {
    this.pc = pc;
    this.videoSender = videoSender;
    this.options = options;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.recoveryThresholdMs = options.recoveryThresholdMs ?? 15000;
  }

  public getState(): SimulcastAdaptationState {
    return this.state;
  }

  public isHealthy(): boolean {
    return this.state === "NORMAL";
  }

  public getConsecutiveHealthySamples(): number {
    return this.consecutiveHealthySamples;
  }

  public getHealthySince(): number | null {
    return this.healthySince;
  }

  /**
   * Starts periodic stats polling approximately every 2 seconds.
   * Idempotent: cleans up any existing interval before starting.
   */
  public start(): void {
    if (this.isDestroyed) return;
    this.stop();

    this.pollTimer = setInterval(async () => {
      await this.pollStats();
    }, this.pollIntervalMs);
  }

  /**
   * Stops periodic stats polling.
   */
  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Cleans up all intervals, stops monitoring, and prevents future calls.
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.stop();
  }

  /**
   * Manually runs a single polling pass (useful for deterministic tests).
   */
  public async pollStats(): Promise<void> {
    if (this.isDestroyed || this.isPolling) return;

    // Terminate polling if peer connection is closed
    const currentConnState: string | undefined = this.pc.connectionState;
    const currentSigState: string | undefined = this.pc.signalingState;
    if (currentConnState === "closed" || currentSigState === "closed") {
      this.destroy();
      return;
    }

    this.isPolling = true;
    try {
      let report: RTCStatsReport;
      if (typeof this.videoSender.getStats === "function") {
        try {
          report = await this.videoSender.getStats();
        } catch {
          report = await this.pc.getStats();
        }
      } else {
        report = await this.pc.getStats();
      }
      if (this.isDestroyed) return;

      const { stats, cumulative } = extractRTCPStats(
        report,
        this.prevCumulativeStats,
        this.videoSender,
      );
      this.prevCumulativeStats = cumulative;

      await this.evaluateSample(stats);
    } catch {
      // Gracefully handle closed connection or temporarily unavailable stats
      const errConnState: string | undefined = this.pc.connectionState;
      const errSigState: string | undefined = this.pc.signalingState;
      if (errConnState === "closed" || errSigState === "closed") {
        this.destroy();
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Ingests a network stats sample and executes the adaptation state machine.
   * Returns true if a state transition occurred, false otherwise.
   */
  public async evaluateSample(stats: NetworkStats): Promise<boolean> {
    if (this.isDestroyed) return false;

    const { isBadSample } = evaluateNetworkCondition(stats);
    const now = stats.timestamp || Date.now();

    if (this.state === "NORMAL") {
      if (isBadSample) {
        // NORMAL -> DEGRADED transition
        this.state = "DEGRADED";
        this.healthySince = null;
        this.consecutiveHealthySamples = 0;
        await setHighLayerActive(this.videoSender, false);
        this.options.onStateChange?.(this.state);
        return true;
      }
      // Stable in NORMAL; do not redundantly invoke setParameters()
      return false;
    } else {
      // Currently in DEGRADED
      if (isBadSample) {
        // Bad sample interrupts recovery window: reset streak
        this.healthySince = null;
        this.consecutiveHealthySamples = 0;
        // High layer is already inactive; do not redundantly invoke setParameters()
        return false;
      } else {
        // Healthy sample received while degraded
        if (this.healthySince === null) {
          this.healthySince = now;
          this.consecutiveHealthySamples = 1;
        } else {
          this.consecutiveHealthySamples += 1;
        }

        const stableDurationMs = now - this.healthySince;
        // High layer recovers only after > 15 consecutive seconds of healthy samples
        if (stableDurationMs > this.recoveryThresholdMs) {
          this.state = "NORMAL";
          this.healthySince = null;
          this.consecutiveHealthySamples = 0;
          await setHighLayerActive(this.videoSender, true);
          this.options.onStateChange?.(this.state);
          return true;
        }

        // Still within 15s recovery window: keep high layer disabled
        return false;
      }
    }
  }
}
