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

import {
  Resolution,
  SimulcastAdaptationState,
  SimulcastLayerConfig,
  NetworkStats,
  CumulativeStatsState,
  SimulcastControllerOptions,
} from "./types";

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
    resolvedHeight
      ? {
          width: Math.round((resolvedHeight * 16) / 9),
          height: resolvedHeight,
        }
      : undefined,
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
  return params;
}

/**
 * Extracts network hints (packet loss fraction, RTT, jitter) from an RTCStatsReport.
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

    if (
      videoSender?.track?.id &&
      stat.trackId &&
      stat.trackId !== videoSender.track.id
    ) {
      return;
    }

    // 1. Candidate Pair
    if (
      stat.type === "candidate-pair" &&
      (stat.state === "succeeded" || stat.nominated === true)
    ) {
      if (typeof stat.currentRoundTripTime === "number") {
        const val = stat.currentRoundTripTime;
        rttMs = val < 10 ? val * 1000 : val;
      }
    }

    // 2. Remote Inbound RTP
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
        let f = stat.fractionLost;
        if (f > 100) f /= 255;
        else if (f > 1) f /= 100;
        fractionLost = Math.max(0, Math.min(1, f));
      }
      if (typeof stat.packetsLost === "number") {
        cumPacketsLost = stat.packetsLost;
      }
    }

    // 3. Inbound RTP
    if (stat.type === "inbound-rtp") {
      if (typeof stat.jitter === "number" && jitterMs === undefined) {
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

    // 4. Outbound RTP
    if (stat.type === "outbound-rtp") {
      if (typeof stat.packetsSent === "number") {
        cumPacketsSent = stat.packetsSent;
      }
    }
  });

  // If fractionLost was not provided directly by RTCP, calculate from deltas
  if (fractionLost === undefined && cumPacketsLost !== undefined) {
    const currentTotalPackets = cumPacketsReceived ?? cumPacketsSent;
    if (previous && previous.packetsLost !== undefined) {
      const prevTotal = previous.packetsReceived ?? previous.packetsSent ?? 0;
      const isCounterReset =
        (previous.packetsLost !== undefined &&
          cumPacketsLost < previous.packetsLost) ||
        (currentTotalPackets !== undefined &&
          prevTotal > 0 &&
          currentTotalPackets < prevTotal);

      if (isCounterReset) {
        if (
          currentTotalPackets !== undefined &&
          cumPacketsLost + currentTotalPackets > 0
        ) {
          fractionLost = Math.max(
            0,
            Math.min(1, cumPacketsLost / (cumPacketsLost + currentTotalPackets)),
          );
        }
      } else {
        const deltaLost = Math.max(
          0,
          cumPacketsLost - (previous.packetsLost ?? 0),
        );
        const deltaPackets =
          currentTotalPackets !== undefined
            ? Math.max(0, currentTotalPackets - prevTotal)
            : 0;
        const totalDelta = deltaLost + deltaPackets;
        if (totalDelta > 0) {
          fractionLost = Math.max(0, Math.min(1, deltaLost / totalDelta));
        }
      }
    } else if (
      currentTotalPackets !== undefined &&
      cumPacketsLost + currentTotalPackets > 0
    ) {
      fractionLost = Math.max(
        0,
        Math.min(1, cumPacketsLost / (cumPacketsLost + currentTotalPackets)),
      );
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
 */
export function evaluateNetworkCondition(stats: NetworkStats): {
  isBadSample: boolean;
  isHighLoss: boolean;
  isHighRtt: boolean;
} {
  const isHighLoss =
    stats.packetLossFraction !== undefined && stats.packetLossFraction > 0.08;
  const isHighRtt = stats.rttMs !== undefined && stats.rttMs > 350;
  const isBadSample = isHighLoss || isHighRtt;

  return { isBadSample, isHighLoss, isHighRtt };
}

/**
 * Modifies video sender parameters to enable or disable the high-resolution layer.
 */
export async function setHighLayerActive(
  sender: RTCRtpSender,
  active: boolean,
): Promise<boolean> {
  if (sender.track && sender.track.kind !== "video") {
    return false;
  }

  const params = sender.getParameters();
  if (!params || !params.encodings || params.encodings.length === 0) {
    return false;
  }

  let highIndex = params.encodings.findIndex(
    (e) => e.rid === "high" || e.rid === "h",
  );
  if (highIndex === -1) {
    if (params.encodings.length > 1) {
      highIndex = 0;
    } else {
      return false;
    }
  }

  const highEncoding = params.encodings[highIndex];
  if (!highEncoding) return false;

  if (highEncoding.active === active) {
    return false;
  }

  highEncoding.active = active;

  params.encodings.forEach((enc, index) => {
    if (index !== highIndex) {
      enc.active = true;
    }
  });

  await sender.setParameters(params);
  return true;
}

/**
 * Controller that monitors RTCP stats and adapts the video simulcast ladder.
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

  public start(): void {
    if (this.isDestroyed) return;
    this.stop();

    this.pollTimer = setInterval(async () => {
      await this.pollStats();
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.stop();
  }

  public async pollStats(): Promise<void> {
    if (this.isDestroyed || this.isPolling) return;

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
      const errConnState: string | undefined = this.pc.connectionState;
      const errSigState: string | undefined = this.pc.signalingState;
      if (errConnState === "closed" || errSigState === "closed") {
        this.destroy();
      }
    } finally {
      this.isPolling = false;
    }
  }

  public async evaluateSample(stats: NetworkStats): Promise<boolean> {
    if (this.isDestroyed) return false;

    const { isBadSample } = evaluateNetworkCondition(stats);
    const now = stats.timestamp || Date.now();

    if (this.state === "NORMAL") {
      if (isBadSample) {
        this.state = "DEGRADED";
        this.healthySince = null;
        this.consecutiveHealthySamples = 0;
        await setHighLayerActive(this.videoSender, false);
        this.options.onStateChange?.(this.state);
        return true;
      }
      return false;
    } else {
      if (isBadSample) {
        this.healthySince = null;
        this.consecutiveHealthySamples = 0;
        return false;
      } else {
        if (this.healthySince === null) {
          this.healthySince = now;
          this.consecutiveHealthySamples = 1;
        } else {
          this.consecutiveHealthySamples += 1;
        }

        const stableDurationMs = now - this.healthySince;
        if (stableDurationMs > this.recoveryThresholdMs) {
          this.state = "NORMAL";
          this.healthySince = null;
          this.consecutiveHealthySamples = 0;
          await setHighLayerActive(this.videoSender, true);
          this.options.onStateChange?.(this.state);
          return true;
        }

        return false;
      }
    }
  }
}
