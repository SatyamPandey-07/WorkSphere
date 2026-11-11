/**
 * Distributed Lock Manager (Redlock Algorithm) across Multi-Node Redis Clusters.
 *
 * Implements the Redlock algorithm proposed by Salvatore Sanfilippo (antirez) for
 * fault-tolerant distributed locking across N independent Redis nodes without single
 * points of failure.
 *
 * ----------------------------------------------------------------------------------
 * DISTRIBUTED SYSTEMS SAFETY & ASSUMPTIONS:
 * ----------------------------------------------------------------------------------
 * 1. Independent Failure Domains:
 *    All Redis instances in the cluster MUST be independent master nodes without shared
 *    persistence, shared hardware, or asynchronous replication. If nodes share state or
 *    rely on asynchronous master-replica failover, failover race conditions can violate
 *    mutual exclusion.
 *
 * 2. Majority Quorum:
 *    Acquisition and renewal require confirmation from a strict majority:
 *    Quorum = Math.floor(nodeCount / 2) + 1.
 *    For N=3, Quorum=2. For N=5, Quorum=3. Single-node fallback is strictly disallowed.
 *
 * 3. Monotonic Clock & Clock Drift:
 *    All elapsed times and validity computations use performance.now() (monotonic clock)
 *    to avoid vulnerability to NTP adjustments or system clock jumps.
 *    Drift is bounded as: drift = (TTL * driftFactor) + 2ms.
 *    Remaining validity = TTL - elapsed - drift.
 *    If quorum is reached but validity <= 0, the lock is rejected and rolled back.
 *
 * 4. Safe Compare-and-Delete & Compare-and-Extend:
 *    Lock release and renewal are executed via atomic Lua scripts matching the lock token.
 *    A client can NEVER delete or extend a lock held by another process or owner.
 *
 * 5. Fencing Tokens vs. Nonce Identifiers:
 *    Redlock tokens are cryptographically secure random nonces (UUID + random bytes)
 *    designed to guarantee safe release and renewal. They do NOT act as monotonic linear
 *    fencing tokens. Systems requiring strict linearizability across arbitrary GC or
 *    process pauses must pair this lock with database transaction checks or versioning.
 * ----------------------------------------------------------------------------------
 */

import crypto from "crypto";
import { Redis } from "@upstash/redis";

export interface IRedisClient {
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; px?: number; ex?: number } | string,
    ...args: any[]
  ): Promise<any>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<any>;
  del?(...keys: string[]): Promise<any>;
  get?(key: string): Promise<any>;
}

export interface RedlockOptions {
  /** Clock drift factor (default: 0.01 = 1% of TTL) */
  driftFactor?: number;
  /** Number of acquisition retry attempts (default: 3) */
  retryCount?: number;
  /** Base delay between acquisition retries in ms (default: 200) */
  retryDelayMs?: number;
  /** Random jitter added to retry delay in ms (default: 100) */
  retryJitterMs?: number;
  /** Default lock time-to-live in ms (default: 5000) */
  defaultTtlMs?: number;
}

export interface AcquireOptions {
  ttlMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  retryJitterMs?: number;
  /** Enable background heartbeat renewal before expiration */
  autoRenew?: boolean;
  /** Interval in ms to attempt heartbeat renewal (default: ttlMs / 3) */
  renewIntervalMs?: number;
  /** Generate a strictly monotonically increasing fencing token across cluster */
  withFencingToken?: boolean;
}

/**
 * Thrown when a distributed lock lease expires or fails renewal.
 */
export class LockLostError extends Error {
  public readonly code = "LOCK_LOST";

  constructor(message: string = "Distributed lock lease was lost") {
    super(message);
    this.name = "LockLostError";
    Object.setPrototypeOf(this, LockLostError.prototype);
  }
}

/**
 * Atomic compare-and-delete Lua script.
 * Only deletes the key if the stored value matches ARGV[1].
 */
export const REDLOCK_RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Atomic compare-and-extend Lua script.
 * Only extends TTL if the stored value matches ARGV[1].
 */
export const REDLOCK_EXTEND_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], tonumber(ARGV[2]))
else
  return 0
end
`;

/**
 * Atomic acquire with monotonic fencing token generation script.
 * KEYS[1]: resource lock key
 * KEYS[2]: resource fencing sequence key
 * ARGV[1]: unique lock token
 * ARGV[2]: lease TTL in ms
 * Returns [1, fencingToken] if lock acquired; [0, 0] otherwise.
 */
export const REDLOCK_ACQUIRE_FENCING_LUA = `
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", tonumber(ARGV[2])) then
  local fence = redis.call("incr", KEYS[2])
  return {1, fence}
else
  return {0, 0}
end
`;

/**
 * Invokes SET key token NX PX ttl on a Redis client.
 */
async function setNxPx(
  client: IRedisClient,
  key: string,
  token: string,
  ttlMs: number
): Promise<boolean> {
  try {
    const res = await client.set(key, token, { nx: true, px: ttlMs });
    return (
      res === "OK" ||
      res === "ok" ||
      res === 1 ||
      res === true ||
      (typeof res === "string" && res.toUpperCase() === "OK")
    );
  } catch {
    try {
      const res = await (client as any).set(key, token, "PX", ttlMs, "NX");
      return (
        res === "OK" ||
        res === "ok" ||
        res === 1 ||
        res === true ||
        (typeof res === "string" && res.toUpperCase() === "OK")
      );
    } catch {
      return false;
    }
  }
}

/**
 * Executes a Lua script across supported Redis clients (Upstash or standard).
 */
async function evalLua(
  client: IRedisClient,
  script: string,
  keys: string[],
  args: (string | number)[]
): Promise<any> {
  try {
    return await client.eval(script, keys, args);
  } catch (err) {
    if (typeof (client as any).eval === "function") {
      try {
        return await (client as any).eval(script, keys.length, ...keys, ...args);
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Handle representing an actively held distributed lock.
 */
export class DistributedLock {
  public readonly key: string;
  public readonly token: string;
  public validity: number;
  public expiresAt: number;
  public readonly fencingToken?: number;

  private _isLost = false;
  private _isReleased = false;
  private _renewTimer: NodeJS.Timeout | null = null;
  private _isRenewing = false;
  private _lostListeners: Array<() => void> = [];
  private _abortController = new AbortController();
  private _manager: RedlockManager;

  constructor(
    manager: RedlockManager,
    key: string,
    token: string,
    validity: number,
    ttlMs: number,
    options?: { autoRenew?: boolean; renewIntervalMs?: number; fencingToken?: number }
  ) {
    this._manager = manager;
    this.key = key;
    this.token = token;
    this.validity = validity;
    this.expiresAt = performance.now() + validity;
    this.fencingToken = options?.fencingToken;

    if (options?.autoRenew) {
      this.startAutoRenew(ttlMs, options.renewIntervalMs);
    }
  }

  public get isLost(): boolean {
    return this._isLost;
  }

  public get isReleased(): boolean {
    return this._isReleased;
  }

  public get signal(): AbortSignal {
    return this._abortController.signal;
  }

  /**
   * Throws LockLostError if the lock lease has been lost or already released.
   */
  public checkLost(): void {
    if (this._isLost) {
      throw new LockLostError("Distributed lock lease was lost");
    }
    if (this._isReleased) {
      throw new LockLostError("Distributed lock was already released");
    }
  }

  /**
   * Registers a callback triggered if heartbeat renewal fails or the lease is lost.
   */
  public onLost(callback: () => void): () => void {
    this._lostListeners.push(callback);
    return () => {
      this._lostListeners = this._lostListeners.filter((cb) => cb !== callback);
    };
  }

  /**
   * Marks this lock as lost, aborting listeners and stopping renewals.
   */
  public markLost(reason?: string): void {
    if (this._isLost || this._isReleased) return;
    this._isLost = true;
    this.stopAutoRenew();
    this._abortController.abort(
      new LockLostError(reason || "Distributed lock lease was lost")
    );
    for (const cb of this._lostListeners) {
      try {
        cb();
      } catch {
        // Safe execution of listeners
      }
    }
  }

  /**
   * Starts periodic heartbeat renewal.
   */
  public startAutoRenew(ttlMs: number, customIntervalMs?: number): void {
    this.stopAutoRenew();
    const intervalMs =
      customIntervalMs ?? Math.max(50, Math.floor(ttlMs / 3));

    const schedule = () => {
      if (this._isLost || this._isReleased) return;
      this._renewTimer = setTimeout(async () => {
        if (this._isLost || this._isReleased) return;
        if (this._isRenewing) {
          // Prevent overlapping renewal attempts
          schedule();
          return;
        }
        this._isRenewing = true;
        try {
          const ok = await this._manager.extend(this, ttlMs);
          if (!ok) {
            this.markLost(
              "Lease renewal failed: quorum not reached or validity exhausted"
            );
            return;
          }
          schedule();
        } catch (err: any) {
          this.markLost(`Lease renewal error: ${err?.message || err}`);
        } finally {
          this._isRenewing = false;
        }
      }, intervalMs);

      if (this._renewTimer && typeof this._renewTimer.unref === "function") {
        this._renewTimer.unref();
      }
    };

    schedule();
  }

  /**
   * Stops active renewal timers.
   */
  public stopAutoRenew(): void {
    if (this._renewTimer) {
      clearTimeout(this._renewTimer);
      this._renewTimer = null;
    }
  }

  /**
   * Manually extends the lock lease by ttlMs.
   */
  public async extend(ttlMs?: number): Promise<boolean> {
    if (this._isLost || this._isReleased) return false;
    return await this._manager.extend(this, ttlMs);
  }

  /**
   * Safely releases this lock across all cluster nodes using the atomic Lua script.
   */
  public async release(): Promise<boolean> {
    this.stopAutoRenew();
    if (this._isReleased) return true;
    const ok = await this._manager.release(this);
    if (ok) {
      this._isReleased = true;
    }
    return ok;
  }
}

/**
 * Distributed Lock Manager implementing the Redlock algorithm across N independent Redis nodes.
 */
export class RedlockManager {
  public readonly clients: IRedisClient[];
  public readonly quorum: number;
  public readonly driftFactor: number;
  public readonly retryCount: number;
  public readonly retryDelayMs: number;
  public readonly retryJitterMs: number;
  public readonly defaultTtlMs: number;

  constructor(clients: IRedisClient[], options?: RedlockOptions) {
    if (!Array.isArray(clients) || clients.length < 3) {
      throw new Error(
        `Redlock requires at least 3 independent Redis nodes for fault-tolerant majority quorum (provided: ${
          clients?.length ?? 0
        }). Single-node locking fallback is strictly disallowed.`
      );
    }

    this.clients = clients;
    this.quorum = Math.floor(clients.length / 2) + 1;
    this.driftFactor = options?.driftFactor ?? 0.01;
    this.retryCount = options?.retryCount ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 200;
    this.retryJitterMs = options?.retryJitterMs ?? 100;
    this.defaultTtlMs = options?.defaultTtlMs ?? 5000;
  }

  public get nodeCount(): number {
    return this.clients.length;
  }

  /**
   * Generates a cryptographically secure, unique lock token.
   */
  private generateToken(): string {
    return `${crypto.randomUUID()}-${crypto.randomBytes(16).toString("hex")}`;
  }

  /**
   * Releases nodes matching key and token. Node errors are handled safely.
   */
  private async releaseNodes(key: string, token: string): Promise<number> {
    const results = await Promise.allSettled(
      this.clients.map(async (client) => {
        try {
          const res = await evalLua(client, REDLOCK_RELEASE_LUA, [key], [token]);
          return Number(res) === 1;
        } catch {
          return false;
        }
      })
    );

    return results.filter(
      (r) => r.status === "fulfilled" && r.value === true
    ).length;
  }

  /**
   * Acquires a distributed lock on the specified resource key.
   *
   * @param key Unique resource identifier
   * @param ttlMs Lock lease TTL in milliseconds
   * @param options Acquisition options (retries, auto-renew)
   * @returns DistributedLock if quorum reached and validity budget intact; null otherwise.
   */
  public async acquire(
    key: string,
    ttlMs?: number,
    options?: AcquireOptions
  ): Promise<DistributedLock | null> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const retryCount = options?.retryCount ?? this.retryCount;
    const retryDelayMs = options?.retryDelayMs ?? this.retryDelayMs;
    const retryJitterMs = options?.retryJitterMs ?? this.retryJitterMs;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      const token = this.generateToken();
      const startTime = performance.now();

      let successCount = 0;
      const fencingTokens: number[] = [];

      if (options?.withFencingToken) {
        const fenceKey = `${key}:fencing`;
        const results = await Promise.allSettled(
          this.clients.map(async (client) => {
            const res = await evalLua(
              client,
              REDLOCK_ACQUIRE_FENCING_LUA,
              [key, fenceKey],
              [token, ttl]
            );
            if (Array.isArray(res) && Number(res[0]) === 1) {
              return Number(res[1]);
            }
            return null;
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled" && typeof r.value === "number") {
            successCount++;
            fencingTokens.push(r.value);
          }
        }
      } else {
        // Attempt acquisition on all independent nodes in parallel
        const results = await Promise.allSettled(
          this.clients.map((client) => setNxPx(client, key, token, ttl))
        );
        successCount = results.filter(
          (r) => r.status === "fulfilled" && r.value === true
        ).length;
      }

      const elapsedMs = performance.now() - startTime;
      const driftMs = Math.round(ttl * this.driftFactor) + 2;
      const remainingValidityMs = ttl - elapsedMs - driftMs;

      // Quorum check and validity budget check
      if (successCount >= this.quorum && remainingValidityMs > 0) {
        const fencingToken =
          fencingTokens.length > 0 ? Math.max(...fencingTokens) : undefined;
        return new DistributedLock(this, key, token, remainingValidityMs, ttl, {
          autoRenew: options?.autoRenew,
          renewIntervalMs: options?.renewIntervalMs,
          fencingToken,
        });
      }

      // Quorum unavailable or validity budget exhausted:
      // Release all partially acquired locks across all nodes immediately
      await this.releaseNodes(key, token);

      if (attempt < retryCount) {
        const jitter = Math.floor(Math.random() * retryJitterMs);
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs + jitter)
        );
      }
    }

    return null;
  }

  /**
   * Extends an actively held distributed lock using atomic compare-and-extend.
   *
   * @param lock Active DistributedLock handle
   * @param ttlMs Extended lease duration in ms
   * @returns true if extended on majority quorum; false otherwise.
   */
  public async extend(lock: DistributedLock, ttlMs?: number): Promise<boolean> {
    if (lock.isLost || lock.isReleased) {
      return false;
    }
    const extensionTtl = ttlMs ?? this.defaultTtlMs;
    const { key, token } = lock;

    const startTime = performance.now();
    const results = await Promise.allSettled(
      this.clients.map(async (client) => {
        try {
          const res = await evalLua(
            client,
            REDLOCK_EXTEND_LUA,
            [key],
            [token, extensionTtl]
          );
          return Number(res) === 1;
        } catch {
          return false;
        }
      })
    );

    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value === true
    ).length;

    const elapsedMs = performance.now() - startTime;
    const driftMs = Math.round(extensionTtl * this.driftFactor) + 2;
    const remainingValidityMs = extensionTtl - elapsedMs - driftMs;

    if (successCount >= this.quorum && remainingValidityMs > 0) {
      lock.validity = remainingValidityMs;
      lock.expiresAt = performance.now() + remainingValidityMs;
      return true;
    }

    // Safety rollback: clean up partially extended nodes to avoid dangling locks
    await this.releaseNodes(key, token);

    return false;
  }

  /**
   * Releases a distributed lock across all nodes using the atomic Lua script.
   */
  public async release(
    lock: DistributedLock | { key: string; token: string }
  ): Promise<boolean> {
    const releasedCount = await this.releaseNodes(lock.key, lock.token);
    return releasedCount >= this.quorum;
  }

  /**
   * Helper pattern to execute a critical section within a distributed lock.
   */
  public async using<T>(
    key: string,
    ttlMs: number,
    routine: (lock: DistributedLock) => Promise<T>,
    options?: AcquireOptions
  ): Promise<T> {
    const lock = await this.acquire(key, ttlMs, options);
    if (!lock) {
      throw new Error(`Failed to acquire distributed lock for key "${key}"`);
    }
    try {
      lock.checkLost();
      const result = await routine(lock);
      lock.checkLost();
      return result;
    } finally {
      await lock.release();
    }
  }
}

let defaultRedlockManager: RedlockManager | null = null;

/**
 * Reuses existing Redis configuration or initializes Redlock across multi-node Redis clusters.
 *
 * Validates that at least 3 independent nodes are configured.
 * Returns null if not configured; never silently falls back to single-node locking.
 */
export function getRedlockManager(): RedlockManager | null {
  if (defaultRedlockManager) {
    return defaultRedlockManager;
  }

  const rawUrls =
    process.env.REDLOCK_REDIS_URLS || process.env.REDIS_CLUSTER_NODES;
  const rawTokens = process.env.REDLOCK_REDIS_TOKENS;

  const urls: string[] = [];
  const tokens: string[] = [];

  if (rawUrls) {
    urls.push(
      ...rawUrls
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
    );
    if (rawTokens) {
      tokens.push(
        ...rawTokens
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      );
    }
  }

  // Check if primary Upstash Redis exists and additional nodes are specified
  if (urls.length === 0 && process.env.UPSTASH_REDIS_REST_URL) {
    const additional =
      process.env.REDLOCK_ADDITIONAL_URLS?.split(",")
        .map((u) => u.trim())
        .filter(Boolean) || [];

    if (additional.length > 0) {
      urls.push(process.env.UPSTASH_REDIS_REST_URL, ...additional);
      tokens.push(process.env.UPSTASH_REDIS_REST_TOKEN || "");
      const additionalTokens =
        process.env.REDLOCK_ADDITIONAL_TOKENS?.split(",").map((t) =>
          t.trim()
        ) || [];
      tokens.push(...additionalTokens);
    }
  }

  if (urls.length === 0) {
    return null;
  }

  if (urls.length < 3) {
    throw new Error(
      `RedlockManager configuration error: At least 3 independent Redis nodes are required for distributed quorum (found ${urls.length}). Single-node locking fallback is strictly disallowed.`
    );
  }

  const clients: IRedisClient[] = urls.map((url, i) => {
    const token =
      tokens[i] || tokens[0] || process.env.UPSTASH_REDIS_REST_TOKEN || "";
    return new Redis({ url, token });
  });

  defaultRedlockManager = new RedlockManager(clients);
  return defaultRedlockManager;
}

/**
 * Overrides or resets the singleton RedlockManager (useful for testing).
 */
export function setRedlockManager(manager: RedlockManager | null): void {
  defaultRedlockManager = manager;
}

