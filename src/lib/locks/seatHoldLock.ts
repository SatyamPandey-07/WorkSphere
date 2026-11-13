/**
 * Distributed Seat-Hold Lock (WebLocks / Redis / PartyKit Integration)
 *
 * Implements a distributed lock mechanism with a 5-minute TTL to prevent
 * double-booking race conditions during checkout (Issue #3522).
 */

import { getRedis } from "@/lib/redis";
import { getRedisKeyspaceManager } from "@/lib/redis/keyspaceNotifications";

export const DEFAULT_LOCK_TTL_SECONDS = 300; // 5 minutes
export const BASE_DRIFT_FACTOR = 0.01;
const NS_PER_MS = BigInt(1_000_000);

export class LockValidityError extends Error {
  readonly code = "LOCK_VALIDITY_ERROR";
  readonly fencingToken?: bigint;
  readonly validityRemainingMs: number;

  constructor(
    message: string,
    validityRemainingMs: number,
    fencingToken?: bigint,
  ) {
    super(message);
    this.name = "LockValidityError";
    this.validityRemainingMs = validityRemainingMs;
    this.fencingToken = fencingToken;
  }
}

/**
 * High-resolution monotonic nanosecond clock backed by process.hrtime.bigint().
 */
export function getMonotonicNowNs(): bigint {
  if (
    typeof process !== "undefined" &&
    typeof process.hrtime?.bigint === "function"
  ) {
    return process.hrtime.bigint();
  }
  const ms =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  return BigInt(Math.floor(ms * 1_000_000));
}

let monotonicFencingSeq: bigint = BigInt(0);

/**
 * Generates a strictly monotonic 64-bit BigInt fencing token immune to 32-bit wrap-around.
 */
export function nextMonotonicFencingToken(
  previousToken?: bigint | string | number,
): bigint {
  const prev =
    typeof previousToken === "bigint"
      ? previousToken
      : previousToken !== undefined && previousToken !== null
        ? BigInt(previousToken)
        : BigInt(0);
  const candidate = monotonicFencingSeq + BigInt(1);
  const next = candidate > prev ? candidate : prev + BigInt(1);
  monotonicFencingSeq = next;
  return next;
}

export function resetMonotonicFencingSequence(
  initial: bigint = BigInt(0),
): void {
  monotonicFencingSeq = initial;
}

/**
 * Computes dynamic clock drift allowance (ms) from monotonic acquisition duration
 * and observed inter-node clock skew so valid quorum locks are not falsely expired.
 */
export function computeDynamicClockDriftMs(
  ttlMs: number,
  elapsedMonotonicNs: bigint,
  observedSkewMs: number = 0,
): number {
  const elapsedMs =
    Number(elapsedMonotonicNs / NS_PER_MS) +
    Number(elapsedMonotonicNs % NS_PER_MS) / 1_000_000;
  const baseDrift = Math.ceil(ttlMs * BASE_DRIFT_FACTOR);
  const dynamicOverhead =
    Math.ceil(elapsedMs * 0.5) + Math.max(0, Math.ceil(observedSkewMs));
  return Math.max(baseDrift, dynamicOverhead) + 2;
}

export interface SeatLockData {
  venueId: string;
  seatId: string;
  userId: string;
  userName?: string;
  heldAt: number;
  expiresAt: number;
  version: number;
  fencingToken?: string;
  driftAllowanceMs?: number;
  acquiredMonotonicNs?: string;
}

export interface AcquireLockResult {
  success: boolean;
  lock?: SeatLockData;
  fencingToken?: bigint;
  driftAllowanceMs?: number;
  heldBy?: string;
  heldByName?: string;
  expiresAt?: number;
  remainingSeconds?: number;
  reason?: "ALREADY_HELD" | "ERROR";
}

/**
 * Validates remaining lease validity using monotonic elapsed time and dynamic drift compensation.
 * Throws LockValidityError if effective remaining validity is <= 0.
 */
export function assertLockLeaseValid(
  lock: SeatLockData,
  options?: {
    observedSkewMs?: number;
    nowMonotonicNs?: bigint;
    nowWallMs?: number;
  },
): { valid: true; remainingValidityMs: number; fencingToken: bigint } {
  const fencingToken = lock.fencingToken
    ? BigInt(lock.fencingToken)
    : BigInt(lock.version || 1);
  const ttlMs = Math.max(0, lock.expiresAt - lock.heldAt);
  const driftAllowanceMs =
    lock.driftAllowanceMs ??
    computeDynamicClockDriftMs(ttlMs, BigInt(0), options?.observedSkewMs ?? 0);

  let elapsedMs: number;
  if (lock.acquiredMonotonicNs) {
    const startNs = BigInt(lock.acquiredMonotonicNs);
    const nowNs = options?.nowMonotonicNs ?? getMonotonicNowNs();
    const deltaNs = nowNs >= startNs ? nowNs - startNs : BigInt(0);
    elapsedMs =
      Number(deltaNs / NS_PER_MS) + Number(deltaNs % NS_PER_MS) / 1_000_000;
  } else {
    const nowWall = options?.nowWallMs ?? Date.now();
    elapsedMs = Math.max(0, nowWall - lock.heldAt);
  }

  const skew = Math.max(0, options?.observedSkewMs ?? 0);
  const effectiveDrift = Math.max(0, skew - driftAllowanceMs);
  const remainingValidityMs = ttlMs - elapsedMs - effectiveDrift;

  if (remainingValidityMs <= 0) {
    throw new LockValidityError(
      `Seat lock lease expired or exceeded dynamic clock drift tolerance (${remainingValidityMs.toFixed(2)}ms)`,
      remainingValidityMs,
      fencingToken,
    );
  }

  return { valid: true, remainingValidityMs, fencingToken };
}

// In-memory fallback for local development or when Upstash Redis is unconfigured
const memoryLocks = new Map<string, SeatLockData>();

/**
 * Atomic acquire / renew.
 *
 * KEYS[1] = lock key
 * ARGV[1] = requesting userId
 * ARGV[2] = JSON payload for a brand-new lock
 * ARGV[3] = TTL in seconds
 *
 * Returns { 1, payload } when the caller now holds the lock (fresh acquire or
 * renewal by the same user) and { 0, currentPayload } when someone else holds it.
 *
 * Doing the existence check, the ownership check and the write inside one
 * script is what makes this a real lock: with separate SET NX / GET / SET round
 * trips the key can expire (and be taken by another user) between the calls, and
 * the renewing user then silently overwrites the new owner's lock.
 */
export const SEAT_LOCK_ACQUIRE_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return { 1, ARGV[2] }
end
local ok, decoded = pcall(cjson.decode, current)
if ok and type(decoded) == 'table' and decoded.userId == ARGV[1] then
  local renewed = cjson.decode(ARGV[2])
  renewed.version = (tonumber(decoded.version) or 1) + 1
  if decoded.heldAt then renewed.heldAt = decoded.heldAt end
  local encoded = cjson.encode(renewed)
  redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[3]))
  return { 1, encoded }
end
return { 0, current }
`;

/**
 * Atomic compare-and-delete.
 *
 * KEYS[1] = lock key, ARGV[1] = userId that wants to release.
 * Only deletes the key if it is still owned by that user, so a holder whose
 * lock already expired can never delete the lock of whoever acquired it next.
 */
export const SEAT_LOCK_RELEASE_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, decoded = pcall(cjson.decode, current)
if ok and type(decoded) == 'table' and decoded.userId == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

function parseLockValue(raw: unknown): SeatLockData | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as SeatLockData;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") {
    return raw as SeatLockData;
  }
  return null;
}

function getLockKey(venueId: string, seatId: string): string {
  return `seat:hold:${venueId}:${seatId}`;
}

function pruneMemoryLocks(now: number = Date.now()) {
  for (const [key, lock] of memoryLocks.entries()) {
    if (now >= lock.expiresAt) {
      memoryLocks.delete(key);
    }
  }
}

/**
 * Attempts to acquire an exclusive 5-minute lock on a seat.
 * Returns success: true if acquired, or success: false with hold details if already locked.
 */
export async function acquireSeatWebLock(
  venueId: string,
  seatId: string,
  userId: string,
  userName?: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
): Promise<AcquireLockResult> {
  const key = getLockKey(venueId, seatId);
  const acquireStartNs = getMonotonicNowNs();
  const now = Date.now();
  const validTtl = Number.isFinite(ttlSeconds)
    ? ttlSeconds
    : DEFAULT_LOCK_TTL_SECONDS;
  const clampedTtl = Math.min(Math.max(validTtl, 10), 600);
  const ttlMs = clampedTtl * 1000;
  const expiresAt = now + ttlMs;
  const initialToken = nextMonotonicFencingToken();

  const redis = getRedis();

  if (redis) {
    try {
      const lockPayload: SeatLockData = {
        venueId,
        seatId,
        userId,
        userName,
        heldAt: now,
        expiresAt,
        version: 1,
        fencingToken: initialToken.toString(),
        acquiredMonotonicNs: acquireStartNs.toString(),
      };

      // Single atomic round trip: acquire if free, renew if we already own it,
      // otherwise report the current holder.
      const rawResult = await redis.eval(
        SEAT_LOCK_ACQUIRE_LUA,
        [key],
        [userId, JSON.stringify(lockPayload), String(clampedTtl)],
      );

      const acquireEndNs = getMonotonicNowNs();
      const elapsedNs =
        acquireEndNs >= acquireStartNs
          ? acquireEndNs - acquireStartNs
          : BigInt(0);
      const driftAllowanceMs = computeDynamicClockDriftMs(ttlMs, elapsedNs);

      const [flag, rawLock] = Array.isArray(rawResult) ? rawResult : [0, null];
      const currentLock = parseLockValue(rawLock);

      if (Number(flag) === 1) {
 fix/redlock-monotonic-fencing-drift
        const resolvedLock: SeatLockData = {
          ...(currentLock ?? lockPayload),
          driftAllowanceMs,
          acquiredMonotonicNs: acquireEndNs.toString(),
        };
        const resolvedToken = resolvedLock.fencingToken
          ? BigInt(resolvedLock.fencingToken)
          : initialToken;
        return {
          success: true,
          lock: resolvedLock,
          fencingToken: resolvedToken,
          driftAllowanceMs,
        };

        const finalLock = currentLock ?? lockPayload;
        getRedisKeyspaceManager().registerDeskTimer(
          venueId,
          seatId,
          finalLock.expiresAt,
        );
        return { success: true, lock: finalLock };
 main
      }

      const remainingSec = currentLock
        ? Math.max(0, Math.ceil((currentLock.expiresAt - now) / 1000))
        : clampedTtl;

      return {
        success: false,
        reason: "ALREADY_HELD",
        heldBy: currentLock?.userId ?? "another_user",
        heldByName: currentLock?.userName,
        expiresAt: currentLock?.expiresAt,
        remainingSeconds: remainingSec,
      };
    } catch (err) {
      console.warn(
        "[SeatLock] Redis lock acquisition failed, falling back to memory:",
        err,
      );
    }
  }

  // Fallback: In-memory distributed lock simulation
  pruneMemoryLocks(now);
  const existing = memoryLocks.get(key);

  if (existing && now < existing.expiresAt && existing.userId !== userId) {
    return {
      success: false,
      reason: "ALREADY_HELD",
      heldBy: existing.userId,
      heldByName: existing.userName,
      expiresAt: existing.expiresAt,
      remainingSeconds: Math.max(
        0,
        Math.ceil((existing.expiresAt - now) / 1000),
      ),
    };
  }

  const acquireEndNs = getMonotonicNowNs();
  const elapsedNs =
    acquireEndNs >= acquireStartNs ? acquireEndNs - acquireStartNs : BigInt(0);
  const driftAllowanceMs = computeDynamicClockDriftMs(ttlMs, elapsedNs);
  const token = nextMonotonicFencingToken(existing?.fencingToken);

  const lockPayload: SeatLockData = {
    venueId,
    seatId,
    userId,
    userName,
    heldAt: now,
    expiresAt,
    version: (existing?.version ?? 0) + 1,
    fencingToken: token.toString(),
    driftAllowanceMs,
    acquiredMonotonicNs: acquireEndNs.toString(),
  };

  memoryLocks.set(key, lockPayload);
 fix/redlock-monotonic-fencing-drift
  return {
    success: true,
    lock: lockPayload,
    fencingToken: token,
    driftAllowanceMs,
  };
  getRedisKeyspaceManager().registerDeskTimer(
    venueId,
    seatId,
    lockPayload.expiresAt,
  );
  return { success: true, lock: lockPayload };
 main
}

/**
 * Releases a seat lock held by the designated user.
 */
export async function releaseSeatWebLock(
  venueId: string,
  seatId: string,
  userId: string,
): Promise<boolean> {
  const key = getLockKey(venueId, seatId);
  const redis = getRedis();

  getRedisKeyspaceManager().unregisterDeskTimer(venueId, seatId);

  if (redis) {
    try {
      // Atomic compare-and-delete: never removes a lock owned by someone else.
      const released = await redis.eval(SEAT_LOCK_RELEASE_LUA, [key], [userId]);
      return Number(released) === 1;
    } catch (err) {
      console.warn(
        "[SeatLock] Redis release failed, falling back to memory:",
        err,
      );
    }
  }

  // Memory fallback
  const existing = memoryLocks.get(key);
  if (existing && existing.userId === userId) {
    memoryLocks.delete(key);
    return true;
  }
  return false;
}

/**
 * Retrieves the active lock state for a seat, if any.
 */
export async function getSeatWebLock(
  venueId: string,
  seatId: string,
): Promise<SeatLockData | null> {
  const key = getLockKey(venueId, seatId);
  const now = Date.now();
  const redis = getRedis();

  if (redis) {
    try {
      const raw = await redis.get<string | SeatLockData>(key);
      if (!raw) return null;
      let lock: SeatLockData | null = null;
      if (typeof raw === "string") {
        try {
          lock = JSON.parse(raw);
        } catch {
          return null;
        }
      } else if (raw && typeof raw === "object") {
        lock = raw as SeatLockData;
      }
      if (lock && typeof lock.expiresAt === "number" && now < lock.expiresAt) {
        return lock;
      }
      return null;
    } catch (err) {
      console.warn("[SeatLock] Redis get failed, checking memory:", err);
    }
  }

  pruneMemoryLocks(now);
  const existing = memoryLocks.get(key);
  if (existing && now < existing.expiresAt) {
    return { ...existing };
  }
  return null;
}

/**
 * Renews a seat hold lock held by the designated user.
 * Atomically updates TTL, increments version, and preserves heldAt timestamp.
 */
export async function renewSeatWebLock(
  venueId: string,
  seatId: string,
  userId: string,
  userName?: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
): Promise<AcquireLockResult> {
  return acquireSeatWebLock(venueId, seatId, userId, userName, ttlSeconds);
}

export interface SeatLockHeartbeatOptions {
  venueId: string;
  seatId: string;
  userId: string;
  userName?: string;
  ttlSeconds?: number;
  intervalMs?: number;
  onRenewSuccess?: (lock: SeatLockData) => void;
  onRenewFailed?: (reason: string) => void;
}

export interface ActiveHeartbeatInfo {
  venueId: string;
  seatId: string;
  userId: string;
  intervalMs: number;
  startedAt: number;
  lastRenewedAt?: number;
}

interface HeartbeatEntry {
  timer: ReturnType<typeof setInterval>;
  options: SeatLockHeartbeatOptions;
  startedAt: number;
  lastRenewedAt?: number;
}

const activeHeartbeats = new Map<string, HeartbeatEntry>();

function getHeartbeatKey(
  venueId: string,
  seatId: string,
  userId?: string,
): string {
  return userId ? `${venueId}:${seatId}:${userId}` : `${venueId}:${seatId}`;
}

/**
 * Starts an automatic background heartbeat to renew an acquired seat lock.
 * Fires periodically at half the TTL interval (or specified intervalMs).
 * Automatically cancels if renewal fails (e.g., lock expired and taken by another user).
 */
export function startSeatLockRenewalHeartbeat(
  options: SeatLockHeartbeatOptions,
): () => void {
  const {
    venueId,
    seatId,
    userId,
    userName,
    ttlSeconds = DEFAULT_LOCK_TTL_SECONDS,
    intervalMs = Math.max(5000, Math.floor((ttlSeconds * 1000) / 2)),
    onRenewSuccess,
    onRenewFailed,
  } = options;

  const key = getHeartbeatKey(venueId, seatId, userId);

  // Stop any existing heartbeat for this seat & user
  stopSeatLockRenewalHeartbeat(venueId, seatId, userId);

  const heartbeatFn = async () => {
    // If heartbeat was cancelled or stopped, abort immediately
    if (!activeHeartbeats.has(key)) return;

    try {
      const result = await renewSeatWebLock(
        venueId,
        seatId,
        userId,
        userName,
        ttlSeconds,
      );

      // Re-verify heartbeat was not cancelled during async renewal roundtrip
      if (!activeHeartbeats.has(key)) return;

      if (result.success && result.lock) {
        const entry = activeHeartbeats.get(key);
        if (entry) {
          entry.lastRenewedAt = Date.now();
        }
        onRenewSuccess?.(result.lock);
      } else {
        // Renewal failed - stop the heartbeat before invoking callback
        stopSeatLockRenewalHeartbeat(venueId, seatId, userId);
        onRenewFailed?.(result.reason || "RENEWAL_REJECTED");
      }
    } catch (err: any) {
      console.warn(
        `[SeatLock Heartbeat] Renewal failed for ${venueId}:${seatId}:`,
        err,
      );
      stopSeatLockRenewalHeartbeat(venueId, seatId, userId);
      onRenewFailed?.(err?.message || "HEARTBEAT_ERROR");
    }
  };

  const timer = setInterval(heartbeatFn, intervalMs);

  activeHeartbeats.set(key, {
    timer,
    options,
    startedAt: Date.now(),
  });

  return () => {
    stopSeatLockRenewalHeartbeat(venueId, seatId, userId);
  };
}

/**
 * Stops an active lock renewal heartbeat for a seat hold.
 */
export function stopSeatLockRenewalHeartbeat(
  venueId: string,
  seatId: string,
  userId?: string,
): boolean {
  if (userId) {
    const key = getHeartbeatKey(venueId, seatId, userId);
    const entry = activeHeartbeats.get(key);
    if (entry) {
      clearInterval(entry.timer);
      activeHeartbeats.delete(key);
      return true;
    }
    return false;
  }

  // If no userId provided, match all heartbeats for venueId & seatId
  let stopped = false;
  const prefix = `${venueId}:${seatId}:`;
  for (const [k, entry] of activeHeartbeats.entries()) {
    if (k.startsWith(prefix) || k === `${venueId}:${seatId}`) {
      clearInterval(entry.timer);
      activeHeartbeats.delete(k);
      stopped = true;
    }
  }
  return stopped;
}

/**
 * Stops all currently active seat lock renewal heartbeats.
 */
export function stopAllSeatLockRenewalHeartbeats(): void {
  for (const entry of activeHeartbeats.values()) {
    clearInterval(entry.timer);
  }
  activeHeartbeats.clear();
}

/**
 * Returns a list of all currently active heartbeat sessions.
 */
export function getActiveSeatLockHeartbeats(): ActiveHeartbeatInfo[] {
  const list: ActiveHeartbeatInfo[] = [];
  for (const entry of activeHeartbeats.values()) {
    list.push({
      venueId: entry.options.venueId,
      seatId: entry.options.seatId,
      userId: entry.options.userId,
      intervalMs: entry.options.intervalMs || DEFAULT_LOCK_TTL_SECONDS * 500,
      startedAt: entry.startedAt,
      lastRenewedAt: entry.lastRenewedAt,
    });
  }
  return list;
}

/**
 * Singleton service wrapper for seat hold lock renewal heartbeats.
 */
export const SeatHoldHeartbeatService = {
  start: startSeatLockRenewalHeartbeat,
  stop: stopSeatLockRenewalHeartbeat,
  stopAll: stopAllSeatLockRenewalHeartbeats,
  getActive: getActiveSeatLockHeartbeats,
  renew: renewSeatWebLock,
};

/**
 * Resets all in-memory locks and heartbeats (used strictly for test isolation).
 */
export function resetMemorySeatLocks(): void {
  stopAllSeatLockRenewalHeartbeats();
  memoryLocks.clear();
 fix/redlock-monotonic-fencing-drift
  resetMonotonicFencingSequence();

  getRedisKeyspaceManager().reset();
 main
}

export interface SeatWebLockOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Client-side Web Locks helper using Navigator.locks API.
 * Holds an exclusive lock named `seat-hold:${venueId}:${seatId}` for as long as the seat is held,
 * ensuring that if the tab or worker terminates unexpectedly, the lock is released immediately (#5489).
 * Includes timeout fallback and AbortController cancellation to prevent indefinite hangs (#4921).
 */
export async function withSeatWebLock<T>(
  venueId: string,
  seatId: string,
  callback: (releaseWebLock: () => void) => Promise<T>,
  options?: SeatWebLockOptions | number,
): Promise<T> {
  const timeoutMs =
    typeof options === "number"
      ? options
      : typeof options?.timeoutMs === "number"
        ? options.timeoutMs
        : 5000;

  const lockName = `seat-hold:${venueId}:${seatId}`;

  if (
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    navigator.locks?.request
  ) {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    // Link caller's abort signal if supplied
    if (typeof options === "object" && options?.signal) {
      if (options.signal.aborted) {
        throw new Error(`Lock request for ${lockName} aborted`);
      }
      options.signal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    const lockPromise = new Promise<T>((resolve, reject) => {
      const lockOptions: { mode: "exclusive"; signal?: AbortSignal } = {
        mode: "exclusive",
      };

      if (typeof AbortController !== "undefined") {
        lockOptions.signal = controller.signal;
      }

      navigator.locks
        .request(lockName, lockOptions, async () => {
          if (timedOut) {
            return;
          }
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          let releaseLockFn: () => void = () => {};
          const releasePromise = new Promise<void>((res) => {
            releaseLockFn = res;
          });

          try {
            const result = await callback(releaseLockFn);
            resolve(result);
          } catch (err) {
            releaseLockFn();
            reject(err);
          }

          await releasePromise;
        })
        .catch((err) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          if (timedOut) {
            return;
          }
          reject(err);
        });
    });

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(
          new Error(
            `Web Lock acquisition timed out after ${timeoutMs}ms for ${lockName}`,
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([lockPromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  // Fallback when Web Locks API is unavailable
  return callback(() => {});
}
