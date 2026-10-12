/**
 * Distributed Seat-Hold Lock (WebLocks / Redis / PartyKit Integration)
 *
 * Implements a distributed lock mechanism with a 5-minute TTL to prevent
 * double-booking race conditions during checkout (Issue #3522).
 */

import { getRedis } from "@/lib/redis";

export const DEFAULT_LOCK_TTL_SECONDS = 300; // 5 minutes

export interface SeatLockData {
  venueId: string;
  seatId: string;
  userId: string;
  userName?: string;
  heldAt: number;
  expiresAt: number;
  version: number;
}

export interface AcquireLockResult {
  success: boolean;
  lock?: SeatLockData;
  heldBy?: string;
  heldByName?: string;
  expiresAt?: number;
  remainingSeconds?: number;
  reason?: "ALREADY_HELD" | "ERROR";
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
  const now = Date.now();
  const validTtl = Number.isFinite(ttlSeconds)
    ? ttlSeconds
    : DEFAULT_LOCK_TTL_SECONDS;
  const clampedTtl = Math.min(Math.max(validTtl, 10), 600);
  const expiresAt = now + clampedTtl * 1000;

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
      };

      // Single atomic round trip: acquire if free, renew if we already own it,
      // otherwise report the current holder.
      const rawResult = await redis.eval(
        SEAT_LOCK_ACQUIRE_LUA,
        [key],
        [userId, JSON.stringify(lockPayload), String(clampedTtl)],
      );

      const [flag, rawLock] = Array.isArray(rawResult)
        ? rawResult
        : [0, null];
      const currentLock = parseLockValue(rawLock);

      if (Number(flag) === 1) {
        return { success: true, lock: currentLock ?? lockPayload };
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
      console.warn("[SeatLock] Redis lock acquisition failed, falling back to memory:", err);
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
      remainingSeconds: Math.max(0, Math.ceil((existing.expiresAt - now) / 1000)),
    };
  }

  const lockPayload: SeatLockData = {
    venueId,
    seatId,
    userId,
    userName,
    heldAt: now,
    expiresAt,
    version: (existing?.version ?? 0) + 1,
  };

  memoryLocks.set(key, lockPayload);
  return { success: true, lock: lockPayload };
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

  if (redis) {
    try {
      // Atomic compare-and-delete: never removes a lock owned by someone else.
      const released = await redis.eval(SEAT_LOCK_RELEASE_LUA, [key], [userId]);
      return Number(released) === 1;
    } catch (err) {
      console.warn("[SeatLock] Redis release failed, falling back to memory:", err);
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

function getHeartbeatKey(venueId: string, seatId: string, userId?: string): string {
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
      console.warn(`[SeatLock Heartbeat] Renewal failed for ${venueId}:${seatId}:`, err);
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
}

/**
 * Client-side Web Locks helper using Navigator.locks API.
 * Holds an exclusive lock named `seat-hold:${venueId}:${seatId}` for as long as the seat is held,
 * ensuring that if the tab or worker terminates unexpectedly, the lock is released immediately (#5489).
 */
export async function withSeatWebLock<T>(
  venueId: string,
  seatId: string,
  callback: (releaseWebLock: () => void) => Promise<T>,
): Promise<T> {
  const lockName = `seat-hold:${venueId}:${seatId}`;
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks?.request) {
    return new Promise<T>((resolve, reject) => {
      navigator.locks.request(lockName, { mode: "exclusive" }, async () => {
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
      }).catch(reject);
    });
  }

  // Fallback when Web Locks API is unavailable
  return callback(() => {});
}

