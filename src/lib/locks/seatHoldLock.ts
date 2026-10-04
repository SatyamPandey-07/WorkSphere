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
  const clampedTtl = Math.min(Math.max(ttlSeconds, 10), 600);
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

      // Atomic SET IF NOT EXISTS with TTL
      const acquired = await redis.set(key, JSON.stringify(lockPayload), {
        nx: true,
        ex: clampedTtl,
      });

      if (acquired === "OK") {
        return { success: true, lock: lockPayload };
      }

      // Lock is held by someone else, or by the same user renewing lease
      const rawCurrent = await redis.get<string | SeatLockData>(key);
      let currentLock: SeatLockData | null = null;
      if (typeof rawCurrent === "string") {
        try {
          currentLock = JSON.parse(rawCurrent);
        } catch {
          currentLock = null;
        }
      } else if (rawCurrent && typeof rawCurrent === "object") {
        currentLock = rawCurrent as SeatLockData;
      }

      if (currentLock && currentLock.userId === userId) {
        // Same user renewing hold
        lockPayload.version = (currentLock.version || 1) + 1;
        await redis.set(key, JSON.stringify(lockPayload), { ex: clampedTtl });
        return { success: true, lock: lockPayload };
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
      const rawCurrent = await redis.get<string | SeatLockData>(key);
      let currentLock: SeatLockData | null = null;
      if (typeof rawCurrent === "string") {
        try {
          currentLock = JSON.parse(rawCurrent);
        } catch {
          currentLock = null;
        }
      } else if (rawCurrent && typeof rawCurrent === "object") {
        currentLock = rawCurrent as SeatLockData;
      }

      if (currentLock && currentLock.userId === userId) {
        await redis.del(key);
        return true;
      }
      return false;
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
      let lock: SeatLockData;
      if (typeof raw === "string") {
        lock = JSON.parse(raw);
      } else {
        lock = raw as SeatLockData;
      }
      if (now < lock.expiresAt) {
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
 * Resets all in-memory locks (used strictly for test isolation).
 */
export function resetMemorySeatLocks(): void {
  memoryLocks.clear();
}
