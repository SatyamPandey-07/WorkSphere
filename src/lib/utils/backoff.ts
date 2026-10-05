/**
 * Shared Reconnect and Exponential Backoff Utility.
 *
 * Provides standardized exponential backoff formulas, jitter calculations,
 * and retry manager implementations across real-time connections (PartySocket, WebRTC, WebSocket).
 */

export interface BackoffOptions {
  maxRetries?: number;
  minReconnectionDelay?: number;
  maxReconnectionDelay?: number;
  reconnectionDelayGrowFactor?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  baseDelay?: number;
  maxDelay?: number;
  factor?: number;
  jitterRatio?: number;
  random?: () => number;
}

export type PartyReconnectOptions = {
  maxRetries: number;
  minReconnectionDelay: number;
  maxReconnectionDelay: number;
  reconnectionDelayGrowFactor: number;
};

export const PARTY_SOCKET_RECONNECT_OPTIONS: PartyReconnectOptions = {
  maxRetries: 5,
  minReconnectionDelay: 1_000,
  maxReconnectionDelay: 30_000,
  reconnectionDelayGrowFactor: 2,
} as const;

export const DEFAULT_BACKOFF_OPTIONS = PARTY_SOCKET_RECONNECT_OPTIONS;

export interface CalculateJitteredBackoffOptions {
  baseDelay?: number;
  maxDelay?: number;
  random?: () => number;
}

/**
 * Calculates exponential backoff with ±20% jitter for reconnect attempts.
 * Returns 0 for retryCount <= 0 (initial connection attempt).
 *
 * Formula:
 * base = min(maxDelay, minDelay * (growFactor ^ (retryCount - 1)))
 * jitter = base * (random * 0.4 - 0.2)
 * result = clamp(minDelay, maxDelay, round(base + jitter))
 */
export function jitteredReconnectDelay(
  retryCount: number,
  opts: Partial<BackoffOptions> | PartyReconnectOptions = PARTY_SOCKET_RECONNECT_OPTIONS,
  random: () => number = Math.random,
): number {
  if (retryCount <= 0) return 0;

  const min =
    opts.minReconnectionDelay ??
    opts.baseDelay ??
    opts.initialDelayMs ??
    DEFAULT_BACKOFF_OPTIONS.minReconnectionDelay;
  const max =
    opts.maxReconnectionDelay ??
    opts.maxDelay ??
    opts.maxDelayMs ??
    DEFAULT_BACKOFF_OPTIONS.maxReconnectionDelay;
  const grow =
    opts.reconnectionDelayGrowFactor ??
    opts.factor ??
    DEFAULT_BACKOFF_OPTIONS.reconnectionDelayGrowFactor;
  const randomFn = opts.random ?? random;

  const base = Math.min(max, min * Math.pow(grow, retryCount - 1));
  const jitterRatio = opts.jitterRatio ?? 0.2;
  const jitter = base * (randomFn() * (jitterRatio * 2) - jitterRatio);

  return Math.round(Math.min(max, Math.max(min, base + jitter)));
}

/**
 * Full-jitter exponential backoff formula (#3769):
 * twait = min(tmax, tbase * 2^attempt) * random(0.8, 1.2)
 */
export function calculateJitteredBackoff(
  attempt: number,
  options: CalculateJitteredBackoffOptions = {},
): number {
  if (attempt <= 0) return 0;

  const baseDelay =
    options.baseDelay ?? PARTY_SOCKET_RECONNECT_OPTIONS.minReconnectionDelay;
  const maxDelay =
    options.maxDelay ?? PARTY_SOCKET_RECONNECT_OPTIONS.maxReconnectionDelay;
  const randomFn = options.random ?? Math.random;

  const cappedBase = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));
  const jitterFactor = 0.8 + randomFn() * 0.4;
  const delayWithJitter = cappedBase * jitterFactor;

  return Math.round(Math.min(maxDelay, Math.max(0, delayWithJitter)));
}

/**
 * Generic exponential backoff calculation for queues and background tasks.
 */
export function calculateBackoff(
  attempt: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: boolean;
  } = {},
  random: () => number = Math.random,
): number {
  if (attempt <= 0) return 0;

  const base = options.baseDelayMs ?? 1000;
  const max = options.maxDelayMs ?? 30000;
  const factor = options.factor ?? 2;
  const rawBackoff = Math.min(max, base * Math.pow(factor, attempt - 1));

  if (options.jitter) {
    const jitter = rawBackoff * 0.5 * random();
    return Math.min(max, Math.round(rawBackoff + jitter));
  }

  return Math.round(rawBackoff);
}

/**
 * Stateful Backoff Manager to handle retries, delay steps, and resets.
 */
export class BackoffManager {
  private currentAttempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(private options: BackoffOptions = DEFAULT_BACKOFF_OPTIONS) {}

  public get attempt(): number {
    return this.currentAttempt;
  }

  public get maxRetries(): number {
    return this.options.maxRetries ?? DEFAULT_BACKOFF_OPTIONS.maxRetries;
  }

  public canRetry(): boolean {
    return this.currentAttempt < this.maxRetries;
  }

  public nextDelay(): number {
    this.currentAttempt += 1;
    return jitteredReconnectDelay(this.currentAttempt, this.options);
  }

  public reset(): void {
    this.currentAttempt = 0;
    this.cancel();
  }

  public cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public async waitNext(): Promise<boolean> {
    if (!this.canRetry()) {
      return false;
    }

    const delay = this.nextDelay();
    if (delay <= 0) {
      return true;
    }

    this.cancel();
    this.abortController = new AbortController();

    return new Promise<boolean>((resolve) => {
      this.timer = setTimeout(() => {
        this.timer = null;
        resolve(true);
      }, delay);

      this.abortController?.signal.addEventListener("abort", () => {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        resolve(false);
      });
    });
  }
}
