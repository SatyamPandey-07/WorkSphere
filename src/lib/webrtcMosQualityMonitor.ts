/**
 * WebRTC Connection Quality Monitor with ITU-T G.107 E-Model MOS (Mean Opinion Score)
 * Estimation and Adaptive Track Degradation Controller.
 *
 * Implements:
 * 1. ITU-T G.107 Transmission Rating Factor (R-factor) and MOS (1.0 to 4.5).
 * 2. Exponential Moving Average (EMA) smoothing for RTT, Jitter, and Packet Loss.
 * 3. Hysteresis buffer to prevent rapid oscillation ("flapping") across tiers.
 * 4. Adaptive track constraint recommendations (framerate, bitrate, resolution scale).
 * 5. Direct extraction from browser RTCStatsReport.
 */

export type QualityTierName =
  | "excellent"
  | "good"
  | "fair"
  | "poor"
  | "critical";

export interface TrackConstraintsRecommendation {
  video: {
    enabled: boolean;
    maxBitrate: number; // bps
    maxFramerate: number; // fps
    width: number;
    height: number;
    scaleResolutionDownBy: number;
  };
  audio: {
    enabled: boolean;
    maxBitrate: number; // bps
    stereo: boolean;
  };
}

export interface QualityTier {
  name: QualityTierName;
  minMos: number;
  label: string;
  color: string;
  recommendation: TrackConstraintsRecommendation;
}

export const QUALITY_TIERS: Record<QualityTierName, QualityTier> = {
  excellent: {
    name: "excellent",
    minMos: 4.1,
    label: "Excellent (HD)",
    color: "#10b981", // emerald-500
    recommendation: {
      video: {
        enabled: true,
        maxBitrate: 2_500_000,
        maxFramerate: 30,
        width: 1920,
        height: 1080,
        scaleResolutionDownBy: 1.0,
      },
      audio: {
        enabled: true,
        maxBitrate: 64_000,
        stereo: true,
      },
    },
  },
  good: {
    name: "good",
    minMos: 3.7,
    label: "Good (720p)",
    color: "#3b82f6", // blue-500
    recommendation: {
      video: {
        enabled: true,
        maxBitrate: 1_200_000,
        maxFramerate: 30,
        width: 1280,
        height: 720,
        scaleResolutionDownBy: 1.5,
      },
      audio: {
        enabled: true,
        maxBitrate: 48_000,
        stereo: false,
      },
    },
  },
  fair: {
    name: "fair",
    minMos: 3.1,
    label: "Fair (480p)",
    color: "#f59e0b", // amber-500
    recommendation: {
      video: {
        enabled: true,
        maxBitrate: 600_000,
        maxFramerate: 20,
        width: 854,
        height: 480,
        scaleResolutionDownBy: 2.0,
      },
      audio: {
        enabled: true,
        maxBitrate: 32_000,
        stereo: false,
      },
    },
  },
  poor: {
    name: "poor",
    minMos: 2.5,
    label: "Poor (360p Low)",
    color: "#f97316", // orange-500
    recommendation: {
      video: {
        enabled: true,
        maxBitrate: 250_000,
        maxFramerate: 15,
        width: 640,
        height: 360,
        scaleResolutionDownBy: 3.0,
      },
      audio: {
        enabled: true,
        maxBitrate: 20_000,
        stereo: false,
      },
    },
  },
  critical: {
    name: "critical",
    minMos: 1.0,
    label: "Critical (Audio Priority)",
    color: "#ef4444", // red-500
    recommendation: {
      video: {
        enabled: false,
        maxBitrate: 80_000,
        maxFramerate: 5,
        width: 320,
        height: 180,
        scaleResolutionDownBy: 4.0,
      },
      audio: {
        enabled: true,
        maxBitrate: 16_000,
        stereo: false,
      },
    },
  },
};

export interface RawNetworkMetrics {
  rttMs?: number;
  jitterMs?: number;
  packetsLost?: number;
  packetsSent?: number;
  packetsReceived?: number;
  fractionLost?: number;
  timestamp?: number;
}

export interface MosScoreResult {
  mos: number;
  rFactor: number;
  tier: QualityTier;
  smoothed: {
    rttMs: number;
    jitterMs: number;
    lossRatio: number;
  };
  raw: RawNetworkMetrics;
  timestamp: number;
  transition?: "upgrade" | "downgrade" | "stable";
}

export interface MosMonitorConfig {
  emaAlpha: number; // Smoothing factor for metrics (0.0 to 1.0)
  hysteresisBuffer: number; // MOS buffer required before upgrading tiers (prevents flapping)
  upgradeConsecutiveRequired: number; // Number of consecutive stable updates needed before upgrading
  initialTier: QualityTierName;
}

export const DEFAULT_MOS_CONFIG: MosMonitorConfig = {
  emaAlpha: 0.25,
  hysteresisBuffer: 0.15,
  upgradeConsecutiveRequired: 2,
  initialTier: "excellent",
};

/**
 * Calculates ITU-T G.107 E-model transmission rating factor R (0 to 100).
 */
export function calculateRFactor(
  rttMs: number,
  jitterMs: number,
  lossRatio: number,
): number {
  const cleanR0 = 94.2;

  // One-way delay estimation d = RTT/2 + 2 * jitter
  const oneWayDelay = Math.max(0, rttMs / 2 + 2 * jitterMs);

  // Delay Impairment Id
  let id = 0;
  if (oneWayDelay <= 177.3) {
    id = 0.024 * oneWayDelay;
  } else {
    id = 0.024 * oneWayDelay + 0.11 * (oneWayDelay - 177.3);
  }

  // Equipment Impairment Ie based on packet loss (0 <= lossRatio <= 1)
  const lossPercent = Math.min(100, Math.max(0, lossRatio * 100));
  // Standard ITU-T Opus/PLC loss robustness model: 95 * P / (P + Bpl), Bpl ~= 10
  const ie = (95 * lossPercent) / (lossPercent + 10);

  const rFactor = cleanR0 - id - ie;
  return Math.max(0, Math.min(100, rFactor));
}

/**
 * Calculates MOS score (1.0 to 4.5) from transmission rating factor R.
 */
export function calculateMosFromRFactor(r: number): number {
  if (r <= 0) return 1.0;
  if (r >= 100) return 4.5;

  const mos = 1 + 0.035 * r + r * (r - 60) * (100 - r) * 7e-6;
  return Math.round(Math.min(4.5, Math.max(1.0, mos)) * 100) / 100;
}

/**
 * Helper combining R-factor and MOS calculation.
 */
export function estimateMos(
  rttMs: number,
  jitterMs: number,
  lossRatio: number,
): { mos: number; rFactor: number } {
  const rFactor = Math.round(calculateRFactor(rttMs, jitterMs, lossRatio) * 10) / 10;
  const mos = calculateMosFromRFactor(rFactor);
  return { mos, rFactor };
}

/**
 * Maps a MOS score directly to the corresponding QualityTier.
 */
export function getTierForMos(mos: number): QualityTier {
  if (mos >= QUALITY_TIERS.excellent.minMos) return QUALITY_TIERS.excellent;
  if (mos >= QUALITY_TIERS.good.minMos) return QUALITY_TIERS.good;
  if (mos >= QUALITY_TIERS.fair.minMos) return QUALITY_TIERS.fair;
  if (mos >= QUALITY_TIERS.poor.minMos) return QUALITY_TIERS.poor;
  return QUALITY_TIERS.critical;
}

/**
 * Extracts normalized network hints from browser RTCStatsReport.
 */
export function extractNetworkMetricsFromStats(
  report: RTCStatsReport,
): RawNetworkMetrics {
  let rttMs: number | undefined;
  let jitterMs: number | undefined;
  let packetsLost: number | undefined;
  let packetsSent: number | undefined;
  let packetsReceived: number | undefined;
  let fractionLost: number | undefined;

  report.forEach((stat: any) => {
    // 1. Candidate pair round trip time
    if (stat.type === "candidate-pair" && (stat.state === "succeeded" || stat.nominated)) {
      if (typeof stat.currentRoundTripTime === "number") {
        rttMs = stat.currentRoundTripTime * 1000;
      }
    }

    // 2. Remote inbound RTP (feedback from remote peer)
    if (stat.type === "remote-inbound-rtp") {
      if (typeof stat.roundTripTime === "number") {
        rttMs = stat.roundTripTime * 1000;
      }
      if (typeof stat.jitter === "number") {
        jitterMs = stat.jitter * 1000;
      }
      if (typeof stat.fractionLost === "number") {
        fractionLost = stat.fractionLost;
      }
      if (typeof stat.packetsLost === "number") {
        packetsLost = stat.packetsLost;
      }
    }

    // 3. Inbound RTP (receiver side)
    if (stat.type === "inbound-rtp") {
      if (typeof stat.jitter === "number" && jitterMs === undefined) {
        jitterMs = stat.jitter * 1000;
      }
      if (typeof stat.packetsLost === "number" && packetsLost === undefined) {
        packetsLost = stat.packetsLost;
      }
      if (typeof stat.packetsReceived === "number") {
        packetsReceived = stat.packetsReceived;
      }
    }

    // 4. Outbound RTP (sender side)
    if (stat.type === "outbound-rtp") {
      if (typeof stat.packetsSent === "number") {
        packetsSent = stat.packetsSent;
      }
    }
  });

  return {
    rttMs,
    jitterMs,
    packetsLost,
    packetsSent,
    packetsReceived,
    fractionLost,
    timestamp: Date.now(),
  };
}

export class WebRtcMosQualityMonitor {
  private config: MosMonitorConfig;
  private currentTier: QualityTier;
  private smoothedRtt: number | null = null;
  private smoothedJitter: number | null = null;
  private smoothedLoss: number | null = null;
  private lastResult: MosScoreResult | null = null;
  private upgradeCandidateTier: QualityTierName | null = null;
  private upgradeConsecutiveCount = 0;
  private listeners: Set<(result: MosScoreResult) => void> = new Set();

  constructor(config: Partial<MosMonitorConfig> = {}) {
    this.config = { ...DEFAULT_MOS_CONFIG, ...config };
    this.currentTier = QUALITY_TIERS[this.config.initialTier];
  }

  /**
   * Ingests raw network telemetry, calculates EMA smoothing and ITU-T MOS score,
   * and evaluates adaptive degradation tier transitions.
   */
  public updateMetrics(raw: RawNetworkMetrics): MosScoreResult {
    const rtt = Math.max(0, raw.rttMs ?? 0);
    const jitter = Math.max(0, raw.jitterMs ?? 0);

    // Compute loss ratio (from fractionLost, or packetsLost / total)
    let lossRatio = 0;
    if (typeof raw.fractionLost === "number" && raw.fractionLost >= 0) {
      lossRatio = Math.min(1.0, raw.fractionLost);
    } else if (raw.packetsLost !== undefined) {
      const total =
        (raw.packetsSent ?? 0) > 0
          ? raw.packetsSent!
          : (raw.packetsReceived ?? 0) + raw.packetsLost;
      lossRatio = total > 0 ? Math.min(1.0, raw.packetsLost / total) : 0;
    }

    // EMA smoothing
    const alpha = this.config.emaAlpha;
    this.smoothedRtt =
      this.smoothedRtt === null ? rtt : alpha * rtt + (1 - alpha) * this.smoothedRtt;
    this.smoothedJitter =
      this.smoothedJitter === null ? jitter : alpha * jitter + (1 - alpha) * this.smoothedJitter;
    this.smoothedLoss =
      this.smoothedLoss === null ? lossRatio : alpha * lossRatio + (1 - alpha) * this.smoothedLoss;

    // Estimate MOS based on smoothed indicators
    const { mos, rFactor } = estimateMos(
      this.smoothedRtt,
      this.smoothedJitter,
      this.smoothedLoss,
    );

    const naturalTier = getTierForMos(mos);
    let transition: "upgrade" | "downgrade" | "stable" = "stable";

    // Tier Evaluation with Hysteresis & Anti-Flapping
    const tierOrder: QualityTierName[] = [
      "critical",
      "poor",
      "fair",
      "good",
      "excellent",
    ];
    const currentIndex = tierOrder.indexOf(this.currentTier.name);
    const naturalIndex = tierOrder.indexOf(naturalTier.name);

    if (naturalIndex < currentIndex) {
      // DOWNGRADE: Immediate transition to protect real-time call health
      this.currentTier = naturalTier;
      this.upgradeCandidateTier = null;
      this.upgradeConsecutiveCount = 0;
      transition = "downgrade";
    } else if (naturalIndex > currentIndex) {
      // UPGRADE: Apply hysteresis buffer and require consecutive samples
      const targetMinMos = naturalTier.minMos + this.config.hysteresisBuffer;

      if (mos >= targetMinMos) {
        if (this.upgradeCandidateTier === naturalTier.name) {
          this.upgradeConsecutiveCount++;
        } else {
          this.upgradeCandidateTier = naturalTier.name;
          this.upgradeConsecutiveCount = 1;
        }

        if (this.upgradeConsecutiveCount >= this.config.upgradeConsecutiveRequired) {
          this.currentTier = naturalTier;
          this.upgradeCandidateTier = null;
          this.upgradeConsecutiveCount = 0;
          transition = "upgrade";
        }
      } else {
        this.upgradeCandidateTier = null;
        this.upgradeConsecutiveCount = 0;
      }
    } else {
      this.upgradeCandidateTier = null;
      this.upgradeConsecutiveCount = 0;
    }

    const result: MosScoreResult = {
      mos,
      rFactor,
      tier: this.currentTier,
      smoothed: {
        rttMs: Math.round(this.smoothedRtt * 10) / 10,
        jitterMs: Math.round(this.smoothedJitter * 10) / 10,
        lossRatio: Math.round(this.smoothedLoss * 1000) / 1000,
      },
      raw,
      timestamp: raw.timestamp ?? Date.now(),
      transition,
    };

    this.lastResult = result;
    this.notifyListeners(result);
    return result;
  }

  /**
   * Convenience ingestion directly from an RTCPeerConnection RTCStatsReport.
   */
  public updateFromReport(report: RTCStatsReport): MosScoreResult {
    const raw = extractNetworkMetricsFromStats(report);
    return this.updateMetrics(raw);
  }

  /**
   * Returns current active tier.
   */
  public getCurrentTier(): QualityTier {
    return this.currentTier;
  }

  /**
   * Returns current active track constraint recommendations.
   */
  public getRecommendations(): TrackConstraintsRecommendation {
    return this.currentTier.recommendation;
  }

  /**
   * Returns latest evaluated result.
   */
  public getCurrentResult(): MosScoreResult | null {
    return this.lastResult;
  }

  /**
   * Subscribes to MOS updates and tier changes.
   */
  public subscribe(listener: (result: MosScoreResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Applies the current degradation recommendations to an active RTCPeerConnection's senders.
   */
  public async applyToPeerConnection(pc: RTCPeerConnection): Promise<boolean> {
    const rec = this.currentTier.recommendation;
    let applied = false;

    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;

      if (sender.track.kind === "video") {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = rec.video.maxBitrate;
          params.encodings[0].maxFramerate = rec.video.maxFramerate;
          params.encodings[0].scaleResolutionDownBy = rec.video.scaleResolutionDownBy;
          await sender.setParameters(params);
          applied = true;
        } catch {
          // Browser may ignore mid-stream parameter modification
        }
      }

      if (sender.track.kind === "audio") {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = rec.audio.maxBitrate;
          await sender.setParameters(params);
          applied = true;
        } catch {
          // Browser may ignore mid-stream parameter modification
        }
      }
    }

    return applied;
  }

  /**
   * Resets monitor state.
   */
  public reset(): void {
    this.smoothedRtt = null;
    this.smoothedJitter = null;
    this.smoothedLoss = null;
    this.lastResult = null;
    this.upgradeCandidateTier = null;
    this.upgradeConsecutiveCount = 0;
    this.currentTier = QUALITY_TIERS[this.config.initialTier];
  }

  private notifyListeners(result: MosScoreResult): void {
    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch (err) {
        console.error("[WebRtcMosQualityMonitor] Listener error:", err);
      }
    }
  }
}

/**
 * Singleton instance.
 */
export const globalMosQualityMonitor = new WebRtcMosQualityMonitor();

/**
 * Factory helper.
 */
export function createWebRtcMosMonitor(
  config?: Partial<MosMonitorConfig>,
): WebRtcMosQualityMonitor {
  return new WebRtcMosQualityMonitor(config);
}
