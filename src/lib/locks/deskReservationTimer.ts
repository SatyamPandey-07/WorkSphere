/**
 * Atomic Desk Reservation Countdown Timer with Redis Keyspace Notifications
 *
 * Provides atomic desk reservation locking, millisecond-precision countdown timers,
 * re-entrant lease extension, compare-and-delete safe release, and automatic integration
 * with Redis keyspace notifications (`__keyevent@*__:expired`) to notify clients
 * as soon as a countdown reaches zero.
 */

import { getRedis } from "@/lib/redis";
import {
  getRedisKeyspaceManager,
  type DeskReservationExpiredEvent,
} from "@/lib/redis/keyspaceNotifications";

export const DEFAULT_DESK_TIMER_SECONDS = 300; // 5 minutes default
export const MIN_DESK_TIMER_SECONDS = 10;
export const MAX_DESK_TIMER_SECONDS = 600; // 10 minutes maximum

export interface DeskReservationTimerData {
  venueId: string;
  deskId: string;
  seatId: string;
  userId: string;
  userName?: string;
  heldAt: number;
  expiresAt: number;
  durationSeconds: number;
  version: number;
}

export interface DeskReservationTimerResult {
  success: boolean;
  timer?: DeskReservationTimerData;
  heldBy?: string;
  heldByName?: string;
  expiresAt?: number;
  remainingSeconds?: number;
  remainingMs?: number;
  reason?: "ALREADY_HELD" | "NOT_FOUND" | "UNAUTHORIZED" | "ERROR";
}

export interface DeskTimerStatus {
  isLocked: boolean;
  timer: DeskReservationTimerData | null;
  remainingSeconds: number;
  remainingMs: number;
  expiresAt: number | null;
  isSelf: boolean;
  heldBy: string | null;
  heldByName: string | null;
}

// In-memory fallback for local dev or offline mode
const memoryDeskTimers = new Map<string, DeskReservationTimerData>();

/**
 * Atomic acquire or renewal Lua script.
 * KEYS[1] = lock key (`seat:hold:${venueId}:${deskId}`)
 * ARGV[1] = requesting userId
 * ARGV[2] = JSON payload
 * ARGV[3] = TTL in seconds
 */
export const DESK_TIMER_ACQUIRE_LUA = `
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
 * Atomic extend countdown timer Lua script.
 * KEYS[1] = lock key
 * ARGV[1] = requesting userId
 * ARGV[2] = additional seconds to add
 * ARGV[3] = maximum allowed TTL ceiling (e.g. 600s)
 */
export const DESK_TIMER_EXTEND_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then
  return { 0, 'NOT_FOUND' }
end
local ok, decoded = pcall(cjson.decode, current)
if not (ok and type(decoded) == 'table' and decoded.userId == ARGV[1]) then
  return { 0, 'UNAUTHORIZED', current }
end
local currentPttl = redis.call('PTTL', KEYS[1])
if currentPttl <= 0 then
  return { 0, 'EXPIRED' }
end
local currentRemainingSec = math.ceil(currentPttl / 1000)
local addSec = tonumber(ARGV[2]) or 120
local maxTtl = tonumber(ARGV[3]) or 600
local newTtl = math.min(currentRemainingSec + addSec, maxTtl)
decoded.version = (tonumber(decoded.version) or 1) + 1
decoded.durationSeconds = newTtl
local nowMs = tonumber(ARGV[4]) or 0
if nowMs > 0 then
  decoded.expiresAt = nowMs + (newTtl * 1000)
end
local encoded = cjson.encode(decoded)
redis.call('SET', KEYS[1], encoded, 'EX', newTtl)
return { 1, encoded, newTtl }
`;

/**
 * Atomic compare-and-delete release script.
 * KEYS[1] = lock key, ARGV[1] = requesting userId
 */
export const DESK_TIMER_RELEASE_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, decoded = pcall(cjson.decode, current)
if ok and type(decoded) == 'table' and decoded.userId == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

/**
 * Atomic get payload + millisecond PTTL script to prevent clock skew.
 * KEYS[1] = lock key
 */
export const DESK_TIMER_GET_PTTL_LUA = `
local current = redis.call('GET', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
return { current, pttl }
`;

function getDeskTimerKey(venueId: string, deskId: string): string {
  return `seat:hold:${venueId}:${deskId}`;
}

function parseTimerPayload(raw: unknown): DeskReservationTimerData | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DeskReservationTimerData;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") {
    return raw as DeskReservationTimerData;
  }
  return null;
}

function pruneMemoryDeskTimers(now: number = Date.now()) {
  for (const [key, timer] of memoryDeskTimers.entries()) {
    if (now >= timer.expiresAt) {
      memoryDeskTimers.delete(key);
    }
  }
}

/**
 * Atomically acquires or extends a desk reservation countdown timer.
 */
export async function acquireDeskReservationTimer(params: {
  venueId: string;
  deskId: string;
  userId: string;
  userName?: string;
  durationSeconds?: number;
}): Promise<DeskReservationTimerResult> {
  const {
    venueId,
    deskId,
    userId,
    userName,
    durationSeconds = DEFAULT_DESK_TIMER_SECONDS,
  } = params;

  const key = getDeskTimerKey(venueId, deskId);
  const now = Date.now();
  const validDuration = Number.isFinite(durationSeconds)
    ? durationSeconds
    : DEFAULT_DESK_TIMER_SECONDS;
  const clampedTtl = Math.min(
    Math.max(validDuration, MIN_DESK_TIMER_SECONDS),
    MAX_DESK_TIMER_SECONDS,
  );
  const expiresAt = now + clampedTtl * 1000;

  const timerPayload: DeskReservationTimerData = {
    venueId,
    deskId,
    seatId: deskId,
    userId,
    userName,
    heldAt: now,
    expiresAt,
    durationSeconds: clampedTtl,
    version: 1,
  };

  const redis = getRedis();

  if (redis) {
    try {
      const rawResult = await redis.eval(
        DESK_TIMER_ACQUIRE_LUA,
        [key],
        [userId, JSON.stringify(timerPayload), String(clampedTtl)],
      );

      const [flag, rawLock] = Array.isArray(rawResult)
        ? rawResult
        : [0, null];
      const currentLock = parseTimerPayload(rawLock);

      if (Number(flag) === 1) {
        const finalTimer = currentLock ?? timerPayload;

        // Register with Redis keyspace manager for synchronized countdown expiration
        getRedisKeyspaceManager().registerDeskTimer(
          venueId,
          deskId,
          finalTimer.expiresAt,
        );

        return {
          success: true,
          timer: finalTimer,
          remainingSeconds: clampedTtl,
          remainingMs: clampedTtl * 1000,
          expiresAt: finalTimer.expiresAt,
        };
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
        remainingMs: remainingSec * 1000,
      };
    } catch (err) {
      console.warn("[DeskTimer] Redis acquire failed, falling back to memory:", err);
    }
  }

  // Memory fallback
  pruneMemoryDeskTimers(now);
  const existing = memoryDeskTimers.get(key);

  if (existing && now < existing.expiresAt && existing.userId !== userId) {
    return {
      success: false,
      reason: "ALREADY_HELD",
      heldBy: existing.userId,
      heldByName: existing.userName,
      expiresAt: existing.expiresAt,
      remainingSeconds: Math.max(0, Math.ceil((existing.expiresAt - now) / 1000)),
      remainingMs: Math.max(0, existing.expiresAt - now),
    };
  }

  const finalTimer: DeskReservationTimerData = {
    ...timerPayload,
    version: (existing?.version ?? 0) + 1,
    heldAt: existing?.heldAt ?? now,
  };

  memoryDeskTimers.set(key, finalTimer);

  getRedisKeyspaceManager().registerDeskTimer(
    venueId,
    deskId,
    finalTimer.expiresAt,
  );

  return {
    success: true,
    timer: finalTimer,
    remainingSeconds: clampedTtl,
    remainingMs: clampedTtl * 1000,
    expiresAt: finalTimer.expiresAt,
  };
}

/**
 * Atomically inspects current desk reservation countdown timer status with exact millisecond PTTL.
 */
export async function getDeskReservationTimer(
  venueId: string,
  deskId: string,
  userId?: string,
): Promise<DeskTimerStatus> {
  const key = getDeskTimerKey(venueId, deskId);
  const now = Date.now();
  const redis = getRedis();

  if (redis) {
    try {
      const rawResult = await redis.eval(DESK_TIMER_GET_PTTL_LUA, [key], []);
      const [rawPayload, rawPttl] = Array.isArray(rawResult)
        ? rawResult
        : [null, -2];

      const pttl = typeof rawPttl === "number" ? rawPttl : Number(rawPttl) || -2;
      const timer = parseTimerPayload(rawPayload);

      if (timer && pttl > 0) {
        const remainingSeconds = Math.ceil(pttl / 1000);
        return {
          isLocked: true,
          timer,
          remainingSeconds,
          remainingMs: pttl,
          expiresAt: timer.expiresAt || now + pttl,
          isSelf: !!userId && timer.userId === userId,
          heldBy: timer.userId,
          heldByName: timer.userName || null,
        };
      }

      return {
        isLocked: false,
        timer: null,
        remainingSeconds: 0,
        remainingMs: 0,
        expiresAt: null,
        isSelf: false,
        heldBy: null,
        heldByName: null,
      };
    } catch (err) {
      console.warn("[DeskTimer] Redis PTTL check failed, checking memory:", err);
    }
  }

  // Memory fallback
  pruneMemoryDeskTimers(now);
  const existing = memoryDeskTimers.get(key);

  if (existing && now < existing.expiresAt) {
    const remainingMs = Math.max(0, existing.expiresAt - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    return {
      isLocked: true,
      timer: { ...existing },
      remainingSeconds,
      remainingMs,
      expiresAt: existing.expiresAt,
      isSelf: !!userId && existing.userId === userId,
      heldBy: existing.userId,
      heldByName: existing.userName || null,
    };
  }

  return {
    isLocked: false,
    timer: null,
    remainingSeconds: 0,
    remainingMs: 0,
    expiresAt: null,
    isSelf: false,
    heldBy: null,
    heldByName: null,
  };
}

/**
 * Atomically extends the countdown timer for an active desk reservation.
 */
export async function extendDeskReservationTimer(
  venueId: string,
  deskId: string,
  userId: string,
  additionalSeconds: number = 120, // default +2 minutes
): Promise<DeskReservationTimerResult> {
  const key = getDeskTimerKey(venueId, deskId);
  const now = Date.now();
  const redis = getRedis();

  if (redis) {
    try {
      const rawResult = await redis.eval(
        DESK_TIMER_EXTEND_LUA,
        [key],
        [
          userId,
          String(additionalSeconds),
          String(MAX_DESK_TIMER_SECONDS),
          String(now),
        ],
      );

      const [flag, rawPayload, newTtl] = Array.isArray(rawResult)
        ? rawResult
        : [0, null, 0];

      if (Number(flag) === 1) {
        const updatedTimer = parseTimerPayload(rawPayload);
        if (updatedTimer) {
          getRedisKeyspaceManager().registerDeskTimer(
            venueId,
            deskId,
            updatedTimer.expiresAt,
          );

          return {
            success: true,
            timer: updatedTimer,
            expiresAt: updatedTimer.expiresAt,
            remainingSeconds: Number(newTtl) || Math.ceil((updatedTimer.expiresAt - now) / 1000),
            remainingMs: (Number(newTtl) || Math.ceil((updatedTimer.expiresAt - now) / 1000)) * 1000,
          };
        }
      }

      if (rawPayload === "UNAUTHORIZED") {
        return { success: false, reason: "UNAUTHORIZED" };
      }
      return { success: false, reason: "NOT_FOUND" };
    } catch (err) {
      console.warn("[DeskTimer] Redis extend failed, falling back to memory:", err);
    }
  }

  // Memory fallback
  pruneMemoryDeskTimers(now);
  const existing = memoryDeskTimers.get(key);

  if (!existing || now >= existing.expiresAt) {
    return { success: false, reason: "NOT_FOUND" };
  }

  if (existing.userId !== userId) {
    return { success: false, reason: "UNAUTHORIZED" };
  }

  const currentRemaining = Math.max(0, Math.ceil((existing.expiresAt - now) / 1000));
  const newRemaining = Math.min(
    currentRemaining + additionalSeconds,
    MAX_DESK_TIMER_SECONDS,
  );
  const newExpiresAt = now + newRemaining * 1000;

  const updated: DeskReservationTimerData = {
    ...existing,
    expiresAt: newExpiresAt,
    durationSeconds: newRemaining,
    version: existing.version + 1,
  };

  memoryDeskTimers.set(key, updated);
  getRedisKeyspaceManager().registerDeskTimer(venueId, deskId, newExpiresAt);

  return {
    success: true,
    timer: updated,
    expiresAt: newExpiresAt,
    remainingSeconds: newRemaining,
    remainingMs: newRemaining * 1000,
  };
}

/**
 * Atomically releases the desk reservation countdown timer.
 */
export async function releaseDeskReservationTimer(
  venueId: string,
  deskId: string,
  userId: string,
): Promise<boolean> {
  const key = getDeskTimerKey(venueId, deskId);
  const redis = getRedis();

  getRedisKeyspaceManager().unregisterDeskTimer(venueId, deskId);

  if (redis) {
    try {
      const released = await redis.eval(DESK_TIMER_RELEASE_LUA, [key], [userId]);
      return Number(released) === 1;
    } catch (err) {
      console.warn("[DeskTimer] Redis release failed, falling back to memory:", err);
    }
  }

  const existing = memoryDeskTimers.get(key);
  if (existing && existing.userId === userId) {
    memoryDeskTimers.delete(key);
    return true;
  }
  return false;
}

/**
 * Helper to subscribe to desk expiration events triggered by Redis keyspace notifications.
 */
export function onDeskCountdownExpired(
  callback: (event: DeskReservationExpiredEvent) => void,
): () => void {
  return getRedisKeyspaceManager().onDeskReservationExpired(callback);
}

/**
 * Resets memory timers (strictly for test isolation).
 */
export function resetDeskReservationTimers(): void {
  memoryDeskTimers.clear();
  getRedisKeyspaceManager().reset();
}

