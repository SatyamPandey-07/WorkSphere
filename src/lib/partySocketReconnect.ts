/**
 * PartySocket Reconnection Protocol
 *
 * ### State Machine Transitions
 * | Current State  | Next State     | Trigger / Description |
 * | :------------- | :------------- | :-------------------- |
 * | `DISCONNECTED` | `CONNECTING`   | Initial connection attempt or manual connect call. |
 * | `CONNECTING`   | `CONNECTED`    | Connection established successfully. |
 * | `CONNECTING`   | `RECONNECTING` | Initial connection failed, attempting to retry. |
 * | `CONNECTED`    | `RECONNECTING` | Connection dropped unexpectedly. |
 * | `RECONNECTING` | `CONNECTING`   | Executing the next retry attempt. |
 * | `RECONNECTING` | `DISCONNECTED` | Max retries reached, giving up. |
 *
 * ### Configuration Options
 * - `maxRetries` (number): The maximum number of reconnection attempts before terminating the process.
 * - `initialDelayMs` / `minReconnectionDelay` (number): The base delay in milliseconds before the first reconnection attempt.
 * - `maxDelayMs` / `maxReconnectionDelay` (number): The maximum delay in milliseconds between reconnection attempts (used for backoff limits).
 *
 * ### Example: Custom Event Listener Binding
 * ```typescript
 * const socket = new PartySocket({ host: "localhost:8080" });
 *
 * // Bind a custom listener to track reconnection attempts
 * socket.addEventListener("reconnecting", (event) => {
 *   console.log(`Reconnecting... Attempt ${event.detail.attempt}`);
 * });
 * ```
 */

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

export enum ConnectionState {
  CLOSED = "CLOSED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
}

type DelaySocket = {
  _retryCount: number;
  _getNextDelay: () => number;
  _connect?: () => void;
  _disconnect?: (code?: number, reason?: string) => void;
  _clearTimeouts?: () => void;
  _wait?: () => Promise<void>;
  addEventListener?: (
    event: string,
    callback: (...args: any[]) => void,
  ) => void;
  __worksphereJitter?: boolean;
  __worksphereState?: ConnectionState;
};

/** Swap in jittered backoff on a live PartySocket instance (idempotent). */
export function attachJitteredBackoff<T extends object>(socket: T): T {
  const s = socket as T & DelaySocket;
  if (s.__worksphereJitter) return socket;

  let pendingTimeoutId: any = null;
  s.__worksphereState = ConnectionState.CLOSED;

  s._getNextDelay = function (this: DelaySocket) {
    return jitteredReconnectDelay(this._retryCount);
  };

  s._wait = function (this: any) {
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
    }
    return new Promise<void>((resolve) => {
      pendingTimeoutId = setTimeout(() => {
        pendingTimeoutId = null;
        resolve();
      }, this._getNextDelay());
    });
  };

  const originalClearTimeouts = s._clearTimeouts;
  s._clearTimeouts = function (this: any) {
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
      pendingTimeoutId = null;
    }
    if (originalClearTimeouts) {
      originalClearTimeouts.call(this);
    }
  };

  const originalDisconnect = s._disconnect;
  s._disconnect = function (this: any, code?: number, reason?: string) {
    s.__worksphereState = ConnectionState.CLOSED;
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
      pendingTimeoutId = null;
    }
    if (originalDisconnect) {
      originalDisconnect.call(this, code, reason);
    }
  };

  const originalConnect = s._connect;
  if (originalConnect) {
    s._connect = function (this: any) {
      if (
        s.__worksphereState === ConnectionState.CONNECTING ||
        s.__worksphereState === ConnectionState.CONNECTED
      ) {
        return;
      }
      s.__worksphereState = ConnectionState.CONNECTING;
      if (pendingTimeoutId) {
        clearTimeout(pendingTimeoutId);
        pendingTimeoutId = null;
      }
      originalConnect.call(this);
    };
  }

  if (typeof s.addEventListener === "function") {
    s.addEventListener("open", () => {
      s.__worksphereState = ConnectionState.CONNECTED;
    });

    s.addEventListener("close", () => {
      s.__worksphereState = ConnectionState.CLOSED;
    });

    s.addEventListener("error", () => {
      s.__worksphereState = ConnectionState.CLOSED;
    });
  }

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
