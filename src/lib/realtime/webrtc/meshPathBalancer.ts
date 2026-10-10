export interface MeshLinkTelemetry {
  packetLoss: number;
  jitterMs: number;
  rttMs: number;
  sampledAt: number;
}

export interface MeshRoute {
  destination: string;
  path: string[];
}

export interface MeshPathBalancerOptions {
  packetLossThreshold?: number;
  jitterThresholdMs?: number;
  rttThresholdMs?: number;
  recoverySamples?: number;
}

const DEFAULT_OPTIONS: Required<MeshPathBalancerOptions> = {
  packetLossThreshold: 0.05,
  jitterThresholdMs: 50,
  rttThresholdMs: 300,
  recoverySamples: 3,
};

/**
 * Chooses paths per packet, failing over immediately and returning traffic
 * to the best route after consecutive healthy telemetry samples.
 */
export class MeshPathBalancer {
  private readonly options: Required<MeshPathBalancerOptions>;
  private readonly telemetry = new Map<string, MeshLinkTelemetry>();
  private readonly recoverySamples = new Map<string, number>();
  private readonly congestedLinks = new Set<string>();
  private alternativeCursor = 0;

  constructor(options: MeshPathBalancerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  updateTelemetry(peerId: string, metrics: MeshLinkTelemetry): void {
    this.telemetry.set(peerId, metrics);
    const congested =
      metrics.packetLoss >= this.options.packetLossThreshold ||
      metrics.jitterMs >= this.options.jitterThresholdMs ||
      metrics.rttMs >= this.options.rttThresholdMs;

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

  removePeer(peerId: string): void {
    this.telemetry.delete(peerId);
    this.recoverySamples.delete(peerId);
    this.congestedLinks.delete(peerId);
  }

  isCongested(peerId: string, now = Date.now()): boolean {
    const metrics = this.telemetry.get(peerId);
    if (metrics && now - metrics.sampledAt <= 5000) {
      const congested =
        metrics.packetLoss >= this.options.packetLossThreshold ||
        metrics.jitterMs >= this.options.jitterThresholdMs ||
        metrics.rttMs >= this.options.rttThresholdMs;
      if (congested) return true;
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
    const alternatives = available.filter(
      (route) => route.path !== primary?.path,
    );

    if (!primary || alternatives.length === 0) {
      return primary ?? available[0];
    }

    const primaryPeer = primary.path[1];
    if (this.isCongested(primaryPeer, now)) {
      return alternatives[this.alternativeCursor++ % alternatives.length];
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
