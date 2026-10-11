export interface MeshLinkTelemetry {
  packetLoss: number;
  jitterMs: number;
  rttMs: number;
  sampledAt: number;
  // Directional metrics on asymmetric links (#5739)
  oneWaySendMs?: number;
  oneWayReceiveMs?: number;
  bufferedAmountBytes?: number;
  sendQueueDelayMs?: number;
  receiveQueueDelayMs?: number;
}

export interface MeshRoute {
  destination: string;
  path: string[];
}

export const MIN_CHUNK_SIZE = 16 * 1024; // 16KB (16,384 bytes)
export const MAX_CHUNK_SIZE = 64 * 1024; // 64KB (65,536 bytes)
export const DEFAULT_CHUNK_SIZE = 16 * 1024; // 16KB
export const MIN_PACKET_SIZE = MIN_CHUNK_SIZE;
export const MAX_PACKET_SIZE = MAX_CHUNK_SIZE;
export const DEFAULT_PACKET_SIZE = DEFAULT_CHUNK_SIZE;
export const DEFAULT_STEP_PRECISION = 1024; // 1KB step precision

export interface MtuProbeMessage {
  type: "mesh-mtu-probe";
  probeId: string;
  size: number;
  payload?: string;
  timestamp: number;
}

export interface MtuProbeAckMessage {
  type: "mesh-mtu-probe-ack";
  probeId: string;
  size: number;
  timestamp: number;
}

export interface MeshPathBalancerOptions {
  packetLossThreshold?: number;
  jitterThresholdMs?: number;
  rttThresholdMs?: number;
  recoverySamples?: number;
  minChunkSize?: number;
  maxChunkSize?: number;
  minPacketSize?: number;
  maxPacketSize?: number;
  stepPrecision?: number;
  // Asymmetric link weighting factors (#5739)
  bufferedAmountThresholdBytes?: number;
  sendQueueWeight?: number;
  receiveQueueWeight?: number;
}

const DEFAULT_OPTIONS: Required<MeshPathBalancerOptions> = {
  packetLossThreshold: 0.05,
  jitterThresholdMs: 50,
  rttThresholdMs: 300,
  recoverySamples: 3,
  minChunkSize: MIN_CHUNK_SIZE,
  maxChunkSize: MAX_CHUNK_SIZE,
  minPacketSize: MIN_PACKET_SIZE,
  maxPacketSize: MAX_PACKET_SIZE,
  stepPrecision: DEFAULT_STEP_PRECISION,
  bufferedAmountThresholdBytes: 256 * 1024, // 256KB outbound buffer threshold
  sendQueueWeight: 1.5,
  receiveQueueWeight: 1.0,
};

/**
 * Chooses paths per packet, failing over immediately and returning traffic
 * to the best route after consecutive healthy telemetry samples.
 * Manages Path MTU Discovery (PMTUD) and optimal dynamic chunk/packet sizing.
 */
export class MeshPathBalancer {
  private readonly options: Required<MeshPathBalancerOptions>;
  private readonly telemetry = new Map<string, MeshLinkTelemetry>();
  private readonly recoverySamples = new Map<string, number>();
  private readonly congestedLinks = new Set<string>();
  private alternativeCursor = 0;

  constructor(options: MeshPathBalancerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  private readonly optimalChunkSizes = new Map<string, number>();
  private alternativeCursor = 0;

  constructor(options: MeshPathBalancerOptions = {}) {
    const minChunk =
      options.minChunkSize ?? options.minPacketSize ?? DEFAULT_OPTIONS.minChunkSize;
    const maxChunk =
      options.maxChunkSize ?? options.maxPacketSize ?? DEFAULT_OPTIONS.maxChunkSize;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      minChunkSize: minChunk,
      minPacketSize: minChunk,
      maxChunkSize: maxChunk,
      maxPacketSize: maxChunk,
    };
  }

  updateTelemetry(peerId: string, metrics: MeshLinkTelemetry): void {
    this.telemetry.set(peerId, metrics);
    const congested =
      metrics.packetLoss >= this.options.packetLossThreshold ||
      metrics.jitterMs >= this.options.jitterThresholdMs ||
      metrics.rttMs >= this.options.rttThresholdMs;
    const congested = this.checkCongestion(metrics);

    if (congested) {
      this.congestedLinks.add(peerId);
      this.recoverySamples.set(peerId, 0);
    } else if (this.congestedLinks.has(peerId)) {
      const samples = (this.recoverySamples.get(peerId) ?? 0) + 1;
      this.recoverySamples.set(peerId, samples);
      if (samples >= this.options.recoverySamples) {
        this.congestedLinks.delete(peerId);
        this.recoverySamples.delete(peerId);
      }
    }
  }

  private checkCongestion(metrics: MeshLinkTelemetry): boolean {
    const isLossCongested = metrics.packetLoss >= this.options.packetLossThreshold;
    const isJitterCongested = metrics.jitterMs >= this.options.jitterThresholdMs;
    const isRttCongested = metrics.rttMs >= this.options.rttThresholdMs;

    // Check outbound data channel buffer fill rate (#5739)
    const isBufferCongested =
      metrics.bufferedAmountBytes !== undefined &&
      metrics.bufferedAmountBytes >= this.options.bufferedAmountThresholdBytes;

    // Check asymmetric send queue delay (#5739)
    const directionalLatency = this.calculateDirectionalLinkCost(metrics, "send");
    const isDirectionalDelayCongested = directionalLatency >= this.options.rttThresholdMs;

    return isLossCongested || isJitterCongested || isRttCongested || isBufferCongested || isDirectionalDelayCongested;
  }

  /**
   * Calculates directional link cost accounting for asymmetric links,
   * outbound buffer fill rates, and weighted send/receive queue delays (#5739).
   */
  public calculateDirectionalLinkCost(
    metrics: MeshLinkTelemetry,
    direction: "send" | "receive" = "send"
  ): number {
    const oneWayBase =
      direction === "send"
        ? (metrics.oneWaySendMs ?? metrics.rttMs / 2)
        : (metrics.oneWayReceiveMs ?? metrics.rttMs / 2);

    // Dynamic queue delay contribution
    const queueDelay =
      direction === "send"
        ? (metrics.sendQueueDelayMs ?? 0) * this.options.sendQueueWeight
        : (metrics.receiveQueueDelayMs ?? 0) * this.options.receiveQueueWeight;

    // Outbound buffer pressure penalty (e.g. 50ms penalty per 64KB queued)
    const bufferPenaltyMs =
      direction === "send" && metrics.bufferedAmountBytes
        ? (metrics.bufferedAmountBytes / (64 * 1024)) * 50
        : 0;

    return oneWayBase + queueDelay + bufferPenaltyMs;
  }

  removePeer(peerId: string): void {
    this.telemetry.delete(peerId);
    this.recoverySamples.delete(peerId);
    this.congestedLinks.delete(peerId);
    this.optimalChunkSizes.delete(peerId);
  }

  isCongested(peerId: string, now = Date.now()): boolean {
    const metrics = this.telemetry.get(peerId);
    if (metrics && now - metrics.sampledAt <= 5000) {
      const congested =
        metrics.packetLoss >= this.options.packetLossThreshold ||
        metrics.jitterMs >= this.options.jitterThresholdMs ||
        metrics.rttMs >= this.options.rttThresholdMs;
      if (congested) return true;
      if (this.checkCongestion(metrics)) return true;
    }
    return this.congestedLinks.has(peerId);
  }

  getTelemetry(peerId: string): MeshLinkTelemetry | undefined {
    return this.telemetry.get(peerId);
  }

  choosePath(routes: MeshRoute[], now = Date.now()): MeshRoute | null {
    const available = routes.filter((route) => route.path.length >= 2);
    if (available.length === 0) return null;

    const primary = available.find(
      (route) =>
        route.path.length === 2 &&
        route.path[route.path.length - 1] === route.destination,
    ) ?? available[0];
  getOptimalChunkSize(peerId: string): number {
    return this.optimalChunkSizes.get(peerId) ?? this.options.minChunkSize;
  }

  setOptimalChunkSize(peerId: string, size: number): void {
    const clamped = Math.min(
      this.options.maxChunkSize,
      Math.max(this.options.minChunkSize, Math.round(size)),
    );
    this.optimalChunkSizes.set(peerId, clamped);
  }

  getOptimalPacketSize(peerId: string): number {
    return this.getOptimalChunkSize(peerId);
  }

  setOptimalPacketSize(peerId: string, size: number): void {
    this.setOptimalChunkSize(peerId, size);
  }

  createProbePacket(size: number, probeId?: string): MtuProbeMessage {
    const id =
      probeId ??
      `probe_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const headerEstimate = 90;
    const paddingLength = Math.max(0, size - headerEstimate);
    return {
      type: "mesh-mtu-probe",
      probeId: id,
      size,
      payload: "X".repeat(paddingLength),
      timestamp: Date.now(),
    };
  }

  /**
   * Performs binary search probe packet sequence to discover the maximum
   * unfragmented payload size between minChunkSize (16KB) and maxChunkSize (64KB).
   *
   * @param peerId Target peer connection ID
   * @param probeFn Prober callback that attempts sending a packet of size bytes and returns true on success
   * @param options Custom search bounds or step precision
   * @returns Optimal payload size discovered (in bytes)
   */
  async probeChannelMtu(
    peerId: string,
    probeFn: (size: number) => Promise<boolean> | boolean,
    options: { minSize?: number; maxSize?: number; stepPrecision?: number } = {},
  ): Promise<number> {
    const min = options.minSize ?? this.options.minChunkSize;
    const max = options.maxSize ?? this.options.maxChunkSize;
    const step = options.stepPrecision ?? this.options.stepPrecision;

    // Verify baseline minimum payload
    try {
      const minSuccess = await probeFn(min);
      if (!minSuccess) {
        this.setOptimalChunkSize(peerId, min);
        return min;
      }
    } catch {
      this.setOptimalChunkSize(peerId, min);
      return min;
    }

    let low = min + step;
    let high = max;
    let optimal = min;

    while (low <= high) {
      const rawMid = Math.floor((low + high) / 2);
      const mid = Math.min(
        max,
        Math.max(min, Math.round(rawMid / step) * step),
      );

      if (mid < low || mid > high) break;

      let success = false;
      try {
        success = await probeFn(mid);
      } catch {
        success = false;
      }

      if (success) {
        optimal = Math.max(optimal, mid);
        low = mid + step;
      } else {
        high = mid - step;
      }
    }

    this.setOptimalChunkSize(peerId, optimal);
    return optimal;
  }

  discoverPathMtu(
    peerId: string,
    probeFn: (size: number) => Promise<boolean> | boolean,
    options?: { minSize?: number; maxSize?: number; stepPrecision?: number },
  ): Promise<number> {
    return this.probeChannelMtu(peerId, probeFn, options);
  }

  choosePath(
    routes: MeshRoute[],
    now = Date.now(),
    direction: "send" | "receive" = "send"
  ): MeshRoute | null {
    const available = routes.filter((route) => route.path.length >= 2);
    if (available.length === 0) return null;

    const primary =
      available.find(
        (route) =>
          route.path.length === 2 &&
          route.path[route.path.length - 1] === route.destination,
      ) ?? available[0];
    const alternatives = available.filter(
      (route) => route.path !== primary?.path,
    );

    if (!primary || alternatives.length === 0) {
      return primary ?? available[0];
    }

    const primaryPeer = primary.path[1];
    const primaryMetrics = this.telemetry.get(primaryPeer);

    // If primary link is congested, divert immediately
    if (this.isCongested(primaryPeer, now)) {
      return alternatives[this.alternativeCursor++ % alternatives.length];
    }

    // Directional link cost comparison on asymmetric links (#5739)
    if (primaryMetrics) {
      const primaryCost = this.calculateDirectionalLinkCost(primaryMetrics, direction);

      // Check if an alternative route has significantly lower directional latency
      let bestAlt: MeshRoute | null = null;
      let lowestAltCost = Infinity;

      for (const alt of alternatives) {
        const altFirstHop = alt.path[1];
        if (this.isCongested(altFirstHop, now)) continue;

        const altMetrics = this.telemetry.get(altFirstHop);
        if (altMetrics) {
          const altCost = this.calculateDirectionalLinkCost(altMetrics, direction);
          if (altCost < lowestAltCost) {
            lowestAltCost = altCost;
            bestAlt = alt;
          }
        }
      }

      // If alternative path offers > 20% lower directional cost, switch to it
      if (bestAlt && lowestAltCost < primaryCost * 0.8) {
        return bestAlt;
      }
    }

    return primary;
  }
}

export function findMeshRoutes(
  localPeerId: string,
  destination: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  maxRoutes = 4,
  maxHops = 5,
): MeshRoute[] {
  const routes: MeshRoute[] = [];
  const queue: string[][] = [[localPeerId]];

  while (queue.length > 0 && routes.length < maxRoutes) {
    const path = queue.shift()!;
    if (path.length - 1 >= maxHops) continue;
    const neighbors = adjacency.get(path[path.length - 1]) ?? new Set<string>();
    for (const neighbor of neighbors) {
      if (path.includes(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === destination) {
        routes.push({ destination, path: nextPath });
        continue;
      }
      queue.push(nextPath);
    }
  }

  return routes.sort((a, b) => a.path.length - b.path.length);
}
