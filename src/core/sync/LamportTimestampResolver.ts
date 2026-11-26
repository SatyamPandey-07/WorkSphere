export interface HybridLogicalTimestamp {
  wallMs: number;
  logical: number;
  nodeId: string;
}

export interface LamportTimestampResolverOptions {
  nodeId?: string;
  maxLogicalCounter?: number;
  maxClockDriftMs?: number;
  /** Emit telemetry when future skew is at least this many milliseconds; defaults to 60 seconds. */
  clockSkewWarningThresholdMs?: number;
  /** Minimum interval between emitted warnings for the same remote peer. */
  clockSkewWarningThrottleMs?: number;
  nowFn?: () => number;
}

export interface ClockSkewWarningTelemetry {
  event: "hlc.clock_skew_warning";
  remoteNodeId: string;
  observedSkewMs: number;
  warningThresholdMs: number;
  maxClockDriftMs: number;
  observedAtMs: number;
  willClamp: boolean;
}

export interface RemoteReceiveResult {
  timestamp: HybridLogicalTimestamp;
  clampedSkew: boolean;
  saturatedLogical: boolean;
  rejectedCorrupted: boolean;
  clockSkewWarning?: ClockSkewWarningTelemetry;
}

export const DEFAULT_MAX_LOGICAL_COUNTER = 65_535;
export const DEFAULT_MAX_CLOCK_DRIFT_MS = 300_000;
export const DEFAULT_CLOCK_SKEW_WARNING_THRESHOLD_MS = 60_000;
export const DEFAULT_CLOCK_SKEW_WARNING_THROTTLE_MS = 60_000;

const MAX_TRACKED_SKEW_PEERS = 256;

function normalizeNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored >= 0 ? floored : fallback;
}

function normalizeNonNegativeOption(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function compareHlc(
  a: Pick<HybridLogicalTimestamp, "wallMs" | "logical" | "nodeId">,
  b: Pick<HybridLogicalTimestamp, "wallMs" | "logical" | "nodeId">,
): number {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1;
  if (a.logical !== b.logical) return a.logical < b.logical ? -1 : 1;
  if (a.nodeId === b.nodeId) return 0;
  return a.nodeId < b.nodeId ? -1 : 1;
}

export class LamportTimestampResolver {
  public readonly nodeId: string;
  public readonly maxLogicalCounter: number;
  public readonly maxClockDriftMs: number;
  public readonly clockSkewWarningThresholdMs: number;
  public readonly clockSkewWarningThrottleMs: number;

  private readonly nowFn: () => number;
  private readonly lastSkewWarningByPeer = new Map<string, number>();
  private wallMs: number;
  private logical: number;

  constructor(options: LamportTimestampResolverOptions = {}) {
    this.nodeId =
      typeof options.nodeId === "string" && options.nodeId.trim().length > 0
        ? options.nodeId.trim()
        : "local-peer";
    this.maxLogicalCounter =
      typeof options.maxLogicalCounter === "number" &&
      Number.isFinite(options.maxLogicalCounter) &&
      options.maxLogicalCounter >= 1
        ? Math.floor(options.maxLogicalCounter)
        : DEFAULT_MAX_LOGICAL_COUNTER;
    this.maxClockDriftMs = normalizeNonNegativeOption(
      options.maxClockDriftMs,
      DEFAULT_MAX_CLOCK_DRIFT_MS,
    );
    this.clockSkewWarningThresholdMs = normalizeNonNegativeOption(
      options.clockSkewWarningThresholdMs,
      DEFAULT_CLOCK_SKEW_WARNING_THRESHOLD_MS,
    );
    this.clockSkewWarningThrottleMs = normalizeNonNegativeOption(
      options.clockSkewWarningThrottleMs,
      DEFAULT_CLOCK_SKEW_WARNING_THROTTLE_MS,
    );
    this.nowFn = options.nowFn ?? Date.now;
    const initialNow = normalizeNonNegativeInt(this.nowFn(), 0);
    this.wallMs = initialNow;
    this.logical = 0;
  }

  public getCurrentTimestamp(): HybridLogicalTimestamp {
    return { wallMs: this.wallMs, logical: this.logical, nodeId: this.nodeId };
  }

  private clampLogicalCounter(candidate: number): {
    value: number;
    saturated: boolean;
  } {
    const safeCandidate = normalizeNonNegativeInt(candidate, 0);
    if (safeCandidate > this.maxLogicalCounter) {
      return { value: this.maxLogicalCounter, saturated: true };
    }
    return { value: safeCandidate, saturated: false };
  }

  public tick(physicalNowMs: number = this.nowFn()): HybridLogicalTimestamp {
    const now = normalizeNonNegativeInt(physicalNowMs, this.wallMs);
    if (now > this.wallMs) {
      this.wallMs = now;
      this.logical = 0;
      return this.getCurrentTimestamp();
    }

    const next = this.clampLogicalCounter(this.logical + 1);
    if (next.saturated) {
      this.wallMs += 1;
      this.logical = 0;
    } else {
      this.logical = next.value;
    }
    return this.getCurrentTimestamp();
  }

  /**
   * Emits a throttled warning for remote HLC timestamps sufficiently far ahead
   * of the local wall clock. It does not mutate this resolver's HLC state.
   */
  public observeRemoteClockSkew(
    remote: Partial<HybridLogicalTimestamp> | null | undefined,
    physicalNowMs: number = this.nowFn(),
  ): ClockSkewWarningTelemetry | undefined {
    if (
      !remote ||
      typeof remote.wallMs !== "number" ||
      !Number.isFinite(remote.wallMs) ||
      remote.wallMs < 0
    ) {
      return undefined;
    }

    const now = normalizeNonNegativeInt(physicalNowMs, this.wallMs);
    const remoteWall = Math.floor(remote.wallMs);
    const observedSkewMs = Math.max(0, remoteWall - now);
    // Equality is a threshold crossing and should be visible in telemetry.
    if (observedSkewMs < this.clockSkewWarningThresholdMs) {
      return undefined;
    }

    const remoteNodeId =
      typeof remote.nodeId === "string" && remote.nodeId.trim().length > 0
        ? remote.nodeId.trim().slice(0, 128)
        : "unknown-peer";
    const lastWarningMs = this.lastSkewWarningByPeer.get(remoteNodeId);
    if (
      lastWarningMs !== undefined &&
      now - lastWarningMs < this.clockSkewWarningThrottleMs
    ) {
      return undefined;
    }

    if (
      !this.lastSkewWarningByPeer.has(remoteNodeId) &&
      this.lastSkewWarningByPeer.size >= MAX_TRACKED_SKEW_PEERS
    ) {
      const oldestPeerId = this.lastSkewWarningByPeer.keys().next().value;
      if (oldestPeerId !== undefined) {
        this.lastSkewWarningByPeer.delete(oldestPeerId);
      }
    }
    this.lastSkewWarningByPeer.delete(remoteNodeId);
    this.lastSkewWarningByPeer.set(remoteNodeId, now);

    const warning: ClockSkewWarningTelemetry = {
      event: "hlc.clock_skew_warning",
      remoteNodeId,
      observedSkewMs,
      warningThresholdMs: this.clockSkewWarningThresholdMs,
      maxClockDriftMs: this.maxClockDriftMs,
      observedAtMs: now,
      willClamp: remoteWall > now + this.maxClockDriftMs,
    };

    try {
      console.warn("[LamportTimestampResolver] HLC clock skew warning", warning);
    } catch (error) {
      console.error(
        "[LamportTimestampResolver] Failed to emit clock skew warning",
        error,
      );
    }

    return warning;
  }

  public receiveRemote(
    remote: Partial<HybridLogicalTimestamp> | null | undefined,
    physicalNowMs: number = this.nowFn(),
  ): RemoteReceiveResult {
    const now = normalizeNonNegativeInt(physicalNowMs, this.wallMs);
    const prevWall = this.wallMs;
    const prevLogical = this.logical;

    if (
      !remote ||
      typeof remote.wallMs !== "number" ||
      !Number.isFinite(remote.wallMs) ||
      remote.wallMs < 0
    ) {
      this.tick(now);
      return {
        timestamp: this.getCurrentTimestamp(),
        clampedSkew: false,
        saturatedLogical: false,
        rejectedCorrupted: true,
      };
    }

    const clockSkewWarning = this.observeRemoteClockSkew(remote, now);
    const maxAllowedWallMs = now + this.maxClockDriftMs;
    let remoteWall = Math.floor(remote.wallMs);
    let clampedSkew = false;
    if (remoteWall > maxAllowedWallMs) {
      remoteWall = maxAllowedWallMs;
      clampedSkew = true;
    }

    const rawRemoteLogical =
      typeof remote.logical === "number" && Number.isFinite(remote.logical)
        ? Math.floor(remote.logical)
        : 0;
    const corruptedLogical =
      rawRemoteLogical < 0 || rawRemoteLogical > this.maxLogicalCounter;
    const remoteLogical = Math.max(
      0,
      Math.min(this.maxLogicalCounter, rawRemoteLogical),
    );
    const nextWall = Math.max(prevWall, remoteWall, now);
    let nextLogical = 0;
    let saturatedLogical = false;

    if (nextWall === prevWall && nextWall === remoteWall) {
      const clamped = this.clampLogicalCounter(
        Math.max(prevLogical, remoteLogical) + 1,
      );
      nextLogical = clamped.value;
      saturatedLogical = clamped.saturated;
    } else if (nextWall === prevWall) {
      const clamped = this.clampLogicalCounter(prevLogical + 1);
      nextLogical = clamped.value;
      saturatedLogical = clamped.saturated;
    } else if (nextWall === remoteWall) {
      const clamped = this.clampLogicalCounter(remoteLogical + 1);
      nextLogical = clamped.value;
      saturatedLogical = clamped.saturated;
    }

    if (saturatedLogical) {
      this.wallMs = nextWall + 1;
      this.logical = 0;
    } else {
      this.wallMs = nextWall;
      this.logical = nextLogical;
    }

    return {
      timestamp: this.getCurrentTimestamp(),
      clampedSkew,
      saturatedLogical: saturatedLogical || corruptedLogical,
      rejectedCorrupted: false,
      ...(clockSkewWarning ? { clockSkewWarning } : {}),
    };
  }
}

export default LamportTimestampResolver;
