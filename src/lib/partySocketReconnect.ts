/**
 * Shared PartySocket reconnect tuning.
 *
 * Default partysocket uses infinite retries and a 0ms delay on the first
 * reconnect, which storms the server when the network interface flaps
 * (Wi‑Fi → cellular). Cap attempts and back off with jitter instead.
 */

export const PARTY_SOCKET_RECONNECT_OPTIONS = {
  maxRetries: 10,
  minReconnectionDelay: 1_000,
  maxReconnectionDelay: 30_000,
  reconnectionDelayGrowFactor: 2,
} as const;

export type PartyReconnectOptions = {
  maxRetries: number;
  minReconnectionDelay: number;
  maxReconnectionDelay: number;
  reconnectionDelayGrowFactor: number;
};

/**
 * Delay before reconnect attempt `retryCount`.
 * PartySocket increments retryCount before waiting; 0 is the initial connect.
 */
export function jitteredReconnectDelay(
  retryCount: number,
  opts: PartyReconnectOptions = PARTY_SOCKET_RECONNECT_OPTIONS,
  random: () => number = Math.random,
): number {
  if (retryCount <= 0) return 0;

  const { minReconnectionDelay: min, maxReconnectionDelay: max } = opts;
  const grow = opts.reconnectionDelayGrowFactor;
  const base = Math.min(max, min * grow ** (retryCount - 1));
  // ±20% jitter so clients don't retry in lockstep after a mass disconnect
  const jitter = base * (random() * 0.4 - 0.2);
  return Math.round(Math.min(max, Math.max(min, base + jitter)));
}

type DelaySocket = {
  _retryCount: number;
  _getNextDelay: () => number;
  __worksphereJitter?: boolean;
};

/** Swap in jittered backoff on a live PartySocket instance (idempotent). */
export function attachJitteredBackoff<T extends object>(socket: T): T {
  const s = socket as T & DelaySocket;
  if (s.__worksphereJitter) return socket;

  s._getNextDelay = function (this: DelaySocket) {
    return jitteredReconnectDelay(this._retryCount);
  };
  s.__worksphereJitter = true;
  return socket;
}

export interface RegionProbeConfig {
  regions: string[];
  pingTimeoutMs?: number;
}

export class PartySocketReconnectManager {
  private retryCount = 0;
  private config: PartyReconnectOptions & RegionProbeConfig;
  public currentRegion: string | null = null;

  constructor(config: Partial<PartyReconnectOptions> & RegionProbeConfig) {
    this.config = {
      ...PARTY_SOCKET_RECONNECT_OPTIONS,
      ...config,
      pingTimeoutMs: config.pingTimeoutMs ?? 3000,
    };
  }

  async probeRegion(region: string): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.pingTimeoutMs,
    );
    const start = Date.now();
    try {
      const url = region.startsWith("http") ? region : `https://${region}`;
      await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        mode: "no-cors",
      });
      return Date.now() - start;
    } catch {
      return Infinity;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getBestRegion(): Promise<string | null> {
    if (this.config.regions.length === 0) return null;
    if (this.config.regions.length === 1) return this.config.regions[0];

    const latencies = await Promise.all(
      this.config.regions.map(async (r) => {
        const lat = await this.probeRegion(r);
        return { region: r, lat };
      }),
    );

    const healthy = latencies.filter((l) => l.lat < Infinity);
    if (healthy.length === 0) return null;

    healthy.sort((a, b) => a.lat - b.lat);
    return healthy[0].region;
  }

  async onDisconnect(): Promise<string | null> {
    this.retryCount++;
    if (this.retryCount > this.config.maxRetries) {
      return null;
    }

    const delay = jitteredReconnectDelay(this.retryCount, this.config);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const bestRegion = await this.getBestRegion();
    if (bestRegion) {
      this.currentRegion = bestRegion;
    }
    return bestRegion;
  }

  onConnect(): void {
    this.retryCount = 0;
  }
}
