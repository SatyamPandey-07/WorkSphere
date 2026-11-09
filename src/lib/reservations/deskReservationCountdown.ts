/**
 * Atomic Desk Reservation Countdown Engine with Redis Keyspace Notifications
 *
 * Implements distributed atomic desk holds, millisecond-precision countdown timer tracking,
 * and seamless integration with Redis keyspace notifications for instantaneous expiration events.
 */

import { getRedis } from "@/lib/redis";
import { keyspaceSubscriber } from "@/lib/reservations/redisKeyspaceSubscriber";
import { eventBus } from "@/core/events";
import { publishVenueAvailability } from "@/lib/reservations/event-bus";

export const DEFAULT_DESK_RESERVATION_TTL_SECONDS = 300; // 5 minutes default
export const MIN_DESK_TTL_SECONDS = 10;
export const MAX_DESK_TTL_SECONDS = 600; // 10 minutes maximum

export interface DeskReservationHold {
  venueId: string;
  deskId: string;
  userId: string;
  userName?: string;
  heldAt: number;
  expiresAt: number;
  ttlSeconds: number;
  version: number;
}

export interface DeskReservationCountdownResult {
  success: boolean;
  reservation?: DeskReservationHold;
  heldBy?: string;
  heldByName?: string;
  expiresAt?: number;
  remainingSeconds: number;
  remainingMs: number;
  reason?: "ALREADY_HELD" | "ERROR" | "EXPIRED" | "NOT_FOUND";
}

export interface DeskReservationTimerInfo {
  venueId: string;
  deskId: string;
  isHeld: boolean;
  isHeldByMe?: boolean;
  heldBy?: string;
  heldByName?: string;
  expiresAt?: number;
  remainingSeconds: number;
  remainingMs: number;
  totalDurationSeconds: number;
  progressPercentage: number;
  version?: number;
}

// In-memory fallback map for offline development or when Upstash Redis is unconfigured
const memoryDeskReservations = new Map<string, DeskReservationHold>();

/**
 * Atomic acquire / renew Lua script.
 * KEYS[1] = Redis key (desk:reservation:{venueId}:{deskId})
 * ARGV[1] = requesting userId
 * ARGV[2] = JSON payload
 * ARGV[3] = TTL in seconds
 */
export const DESK_RESERVATION_ACQUIRE_LUA = `
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
 * Atomic Compare-and-Delete (CAD) release Lua script.
 * KEYS[1] = Redis key
 * ARGV[1] = requesting userId
 */
export const DESK_RESERVATION_RELEASE_LUA = `
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
 * Atomic PTTL and Payload Inspection Lua script.
 * KEYS[1] = Redis key
 * Returns { pttl_in_ms, payload }
 */
export const DESK_RESERVATION_PTTL_LUA = `
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
  return { -1, nil }
end
local current = redis.call('GET', KEYS[1])
return { pttl, current }
`;

export function getDeskReservationKey(venueId: string, deskId: string): string {
  return `desk:reservation:${venueId}:${deskId}`;
}

function parseReservationPayload(raw: unknown): DeskReservationHold | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DeskReservationHold;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") {
    return raw as DeskReservationHold;
  }
  return null;
}

function pruneMemoryReservations(now: number = Date.now()): void {
  for (const [key, res] of memoryDeskReservations.entries()) {
    if (now >= res.expiresAt) {
      memoryDeskReservations.delete(key);
      keyspaceSubscriber.notifyExpiration(res.venueId, res.deskId);
    }
  }
}

/**
 * Atomically acquires or renews an exclusive reservation countdown hold on a desk.
 */
export async function acquireDeskReservation(
  venueId: string,
  deskId: string,
  userId: string,
  userName?: string,
  ttlSeconds: number = DEFAULT_DESK_RESERVATION_TTL_SECONDS,
): Promise<DeskReservationCountdownResult> {
  const key = getDeskReservationKey(venueId, deskId);
  const now = Date.now();
  const validTtl = Number.isFinite(ttlSeconds) ? ttlSeconds : DEFAULT_DESK_RESERVATION_TTL_SECONDS;
  const clampedTtl = Math.min(Math.max(validTtl, MIN_DESK_TTL_SECONDS), MAX_DESK_TTL_SECONDS);
  const expiresAt = now + clampedTtl * 1000;

  const redis = getRedis();

  if (redis) {
    try {
      const payload: DeskReservationHold = {
        venueId,
        deskId,
        userId,
        userName,
        heldAt: now,
        expiresAt,
        ttlSeconds: clampedTtl,
        version: 1,
      };

      const rawResult = await redis.eval(
        DESK_RESERVATION_ACQUIRE_LUA,
        [key],
        [userId, JSON.stringify(payload), String(clampedTtl)],
      );

      const [flag, rawPayload] = Array.isArray(rawResult) ? rawResult : [0, null];
      const currentHold = parseReservationPayload(rawPayload);

      if (Number(flag) === 1 && currentHold) {
        // Register fallback timer in case keyspace events are in polling/REST mode
        keyspaceSubscriber.registerFallbackTimer(venueId, deskId, currentHold.expiresAt);

        // Emit typed internal event
        eventBus.emit("desk:reservation:held", {
          venueId,
          deskId,
          userId,
          userName,
          expiresAt: currentHold.expiresAt,
          ttlSeconds: clampedTtl,
        });

        // Broadcast to SSE clients
        publishVenueAvailability(venueId, {
          type: "desk_reservation_held",
          deskId,
          seatId: deskId,
          userId,
          userName,
          expiresAt: currentHold.expiresAt,
          remainingSeconds: clampedTtl,
          timestamp: now,
        });

        return {
          success: true,
          reservation: currentHold,
          expiresAt: currentHold.expiresAt,
          remainingSeconds: clampedTtl,
          remainingMs: clampedTtl * 1000,
        };
      }

      const remainingMs = currentHold ? Math.max(0, currentHold.expiresAt - now) : clampedTtl * 1000;
      const remainingSec = Math.ceil(remainingMs / 1000);

      return {
        success: false,
        reason: "ALREADY_HELD",
        heldBy: currentHold?.userId ?? "another_user",
        heldByName: currentHold?.userName,
        expiresAt: currentHold?.expiresAt,
        remainingSeconds: remainingSec,
        remainingMs,
      };
    } catch (err) {
      console.warn("[DeskReservation] Redis acquisition failed, falling back to memory:", err);
    }
  }

  // Fallback: In-memory distributed lock simulation
  pruneMemoryReservations(now);
  const existing = memoryDeskReservations.get(key);

  if (existing && now < existing.expiresAt && existing.userId !== userId) {
    const remainingMs = Math.max(0, existing.expiresAt - now);
    return {
      success: false,
      reason: "ALREADY_HELD",
      heldBy: existing.userId,
      heldByName: existing.userName,
      expiresAt: existing.expiresAt,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      remainingMs,
    };
  }

  const payload: DeskReservationHold = {
    venueId,
    deskId,
    userId,
    userName,
    heldAt: existing?.heldAt ?? now,
    expiresAt,
    ttlSeconds: clampedTtl,
    version: (existing?.version ?? 0) + 1,
  };

  memoryDeskReservations.set(key, payload);
  keyspaceSubscriber.registerFallbackTimer(venueId, deskId, expiresAt);

  eventBus.emit("desk:reservation:held", {
    venueId,
    deskId,
    userId,
    userName,
    expiresAt,
    ttlSeconds: clampedTtl,
  });

  publishVenueAvailability(venueId, {
    type: "desk_reservation_held",
    deskId,
    seatId: deskId,
    userId,
    userName,
    expiresAt,
    remainingSeconds: clampedTtl,
    timestamp: now,
  });

  return {
    success: true,
    reservation: payload,
    expiresAt,
    remainingSeconds: clampedTtl,
    remainingMs: clampedTtl * 1000,
  };
}

/**
 * Renews an active desk reservation countdown timer.
 */
export async function renewDeskReservation(
  venueId: string,
  deskId: string,
  userId: string,
  ttlSeconds: number = DEFAULT_DESK_RESERVATION_TTL_SECONDS,
): Promise<DeskReservationCountdownResult> {
  return acquireDeskReservation(venueId, deskId, userId, undefined, ttlSeconds);
}

/**
 * Atomically releases a desk reservation hold owned by the designated user.
 */
export async function releaseDeskReservation(
  venueId: string,
  deskId: string,
  userId: string,
): Promise<boolean> {
  const key = getDeskReservationKey(venueId, deskId);
  const redis = getRedis();

  if (redis) {
    try {
      const released = await redis.eval(DESK_RESERVATION_RELEASE_LUA, [key], [userId]);
      if (Number(released) === 1) {
        keyspaceSubscriber.cancelFallbackTimer(venueId, deskId);

        eventBus.emit("desk:reservation:released", {
          venueId,
          deskId,
          userId,
          releasedAt: Date.now(),
        });

        publishVenueAvailability(venueId, {
          type: "desk_reservation_released",
          deskId,
          seatId: deskId,
          userId,
          reason: "USER_RELEASED",
          timestamp: Date.now(),
        });

        return true;
      }
      return false;
    } catch (err) {
      console.warn("[DeskReservation] Redis release failed, checking memory:", err);
    }
  }

  // In-memory fallback
  const existing = memoryDeskReservations.get(key);
  if (existing && existing.userId === userId) {
    memoryDeskReservations.delete(key);
    keyspaceSubscriber.cancelFallbackTimer(venueId, deskId);

    eventBus.emit("desk:reservation:released", {
      venueId,
      deskId,
      userId,
      releasedAt: Date.now(),
    });

    publishVenueAvailability(venueId, {
      type: "desk_reservation_released",
      deskId,
      seatId: deskId,
      userId,
      reason: "USER_RELEASED",
      timestamp: Date.now(),
    });

    return true;
  }
  return false;
}

/**
 * Retrieves the atomic countdown timer state for a desk directly from Redis TTL/PTTL.
 */
export async function getDeskReservationTimer(
  venueId: string,
  deskId: string,
  currentUserId?: string,
): Promise<DeskReservationTimerInfo> {
  const key = getDeskReservationKey(venueId, deskId);
  const now = Date.now();
  const redis = getRedis();

  if (redis) {
    try {
      const rawResult = await redis.eval(DESK_RESERVATION_PTTL_LUA, [key], []);
      const [pttl, rawPayload] = Array.isArray(rawResult) ? rawResult : [-1, null];
      const pttlMs = Number(pttl);

      if (pttlMs > 0 && rawPayload) {
        const hold = parseReservationPayload(rawPayload);
        if (hold) {
          const remainingMs = pttlMs;
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          const totalDuration = hold.ttlSeconds || DEFAULT_DESK_RESERVATION_TTL_SECONDS;
          const progress = Math.min(100, Math.max(0, (remainingSeconds / totalDuration) * 100));

          return {
            venueId,
            deskId,
            isHeld: true,
            isHeldByMe: currentUserId ? hold.userId === currentUserId : undefined,
            heldBy: hold.userId,
            heldByName: hold.userName,
            expiresAt: now + remainingMs,
            remainingSeconds,
            remainingMs,
            totalDurationSeconds: totalDuration,
            progressPercentage: Math.round(progress),
            version: hold.version,
          };
        }
      }
    } catch (err) {
      console.warn("[DeskReservation] Redis timer fetch failed, falling back to memory:", err);
    }
  }

  // Memory fallback
  pruneMemoryReservations(now);
  const existing = memoryDeskReservations.get(key);

  if (existing && now < existing.expiresAt) {
    const remainingMs = Math.max(0, existing.expiresAt - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const totalDuration = existing.ttlSeconds || DEFAULT_DESK_RESERVATION_TTL_SECONDS;
    const progress = Math.min(100, Math.max(0, (remainingSeconds / totalDuration) * 100));

    return {
      venueId,
      deskId,
      isHeld: true,
      isHeldByMe: currentUserId ? existing.userId === currentUserId : undefined,
      heldBy: existing.userId,
      heldByName: existing.userName,
      expiresAt: existing.expiresAt,
      remainingSeconds,
      remainingMs,
      totalDurationSeconds: totalDuration,
      progressPercentage: Math.round(progress),
      version: existing.version,
    };
  }

  return {
    venueId,
    deskId,
    isHeld: false,
    remainingSeconds: 0,
    remainingMs: 0,
    totalDurationSeconds: DEFAULT_DESK_RESERVATION_TTL_SECONDS,
    progressPercentage: 0,
  };
}

/**
 * Returns all active desk reservation timers for a given venue.
 */
export async function getAllActiveDeskTimers(
  venueId: string,
): Promise<DeskReservationTimerInfo[]> {
  const now = Date.now();
  const timers: DeskReservationTimerInfo[] = [];

  pruneMemoryReservations(now);
  for (const [key, hold] of memoryDeskReservations.entries()) {
    if (hold.venueId === venueId && now < hold.expiresAt) {
      const remainingMs = Math.max(0, hold.expiresAt - now);
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const totalDuration = hold.ttlSeconds || DEFAULT_DESK_RESERVATION_TTL_SECONDS;
      const progress = Math.min(100, Math.max(0, (remainingSeconds / totalDuration) * 100));

      timers.push({
        venueId,
        deskId: hold.deskId,
        isHeld: true,
        heldBy: hold.userId,
        heldByName: hold.userName,
        expiresAt: hold.expiresAt,
        remainingSeconds,
        remainingMs,
        totalDurationSeconds: totalDuration,
        progressPercentage: Math.round(progress),
        version: hold.version,
      });
    }
  }

  return timers;
}

/**
 * Resets all desk reservations and fallback timers (used for test isolation).
 */
export function resetDeskReservationState(): void {
  memoryDeskReservations.clear();
  keyspaceSubscriber.reset();
}
