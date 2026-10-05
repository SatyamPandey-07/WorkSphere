/**
 * Unified WebRTC and Real-Time Types.
 */

import {
  ConnectionLifecycleState,
  ConnectionState,
} from "../connectionState";

export { ConnectionLifecycleState, ConnectionState };

// Quality & MOS Types
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
  emaAlpha: number;
  hysteresisBuffer: number;
  upgradeConsecutiveRequired: number;
  initialTier: QualityTierName;
}

// Simulcast Types
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

export interface SimulcastControllerOptions {
  pollIntervalMs?: number;
  recoveryThresholdMs?: number;
  onStateChange?: (state: SimulcastAdaptationState) => void;
}

// Peer & Data Channel Types
export type PeerStatus = "connecting" | "connected" | "disconnected" | "failed";

export interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  sharedKey: CryptoKey | null;
  status: PeerStatus;
  lifecycleState?: ConnectionLifecycleState;
}

export interface FileTransfer {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  progress: number;
  status:
    | "encrypting"
    | "sending"
    | "receiving"
    | "verifying"
    | "complete"
    | "failed";
  checksum?: string;
}

export type PeerState = {
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  isSettingRemoteAnswerPending: boolean;
};

// Signaling Types
export type SignalKind = "peer-join" | "offer" | "answer" | "ice" | "peer-leave";

export type SignalMessage = {
  type: "webrtc-signal";
  kind: SignalKind;
  from: string;
  to?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};
