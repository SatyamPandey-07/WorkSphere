/**
 * @fileoverview Concurrency-Safe Seat Hold Lock backed by an $O(1)$ Hashed Timing-Wheel Scheduler.
 *
 * ## Timing-Wheel Expiration Architecture
 *
 * 1. **Circular Bucket Ring & Power-of-Two Bitmasking:**
 *    Uses $N = 2^k$ slots (`wheelSize`, default `512`) advancing by `tickMs` (default `100ms`).
 *    Bucket indices map in $O(1)$ via bitwise AND (`totalTicks & (wheelSize - 1)`).
 *
 * 2. **Round Counters (`remainingRounds`) for Multi-Revolution Leases:**
 *    Maps any TTL $\Delta t$ to `ticksAhead = max(1, ceil(ttlMs / tickMs))` with
 *    `remainingRounds = floor((ticksAhead - 1) / wheelSize)`, firing in FIFO order at round 0.
 *
 * Doing the existence check, the ownership check and the write inside one
 * script is what makes this a real lock: with separate SET NX / GET / SET round
 * trips the key can expire (and be taken by another user) between the calls, and
 * the renewing user then silently overwrites the new owner's lock.
 */
import { getRedisKeyspaceManager } from "@/lib/redis/keyspaceNotifications";

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
        const resolvedLock: SeatLockData = {
          ...(currentLock ?? lockPayload),
          driftAllowanceMs,
          acquiredMonotonicNs: acquireEndNs.toString(),
        };
        const resolvedToken = resolvedLock.fencingToken
          ? BigInt(resolvedLock.fencingToken)
          : initialToken;
        scheduleSeatHoldExpiration(venueId, seatId, resolvedLock.expiresAt);
        return {
          success: true,
          lock: resolvedLock,
          fencingToken: resolvedToken,
          driftAllowanceMs,
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
  scheduleSeatHoldExpiration(venueId, seatId, lockPayload.expiresAt);
  return {
    success: true,
    lock: lockPayload,
    fencingToken: token,
    driftAllowanceMs,
  };
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
      if (Number(released) === 1) {
        cancelSeatHoldExpiration(venueId, seatId);
        return true;
      }
      return false;
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
    cancelSeatHoldExpiration(venueId, seatId);
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
  resetMonotonicFencingSequence();
  getRedisKeyspaceManager().reset();
  seatHoldTimingWheel.reset();
}

export interface SeatWebLockOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Hashed Timing Wheel for Seat Hold Expirations (#10441, #10455)
 *
 * Implements a circular hashed timing wheel to schedule seat hold expirations and lock renewals
 * efficiently without creating thousands of disparate Node/browser timer handles.
 *
 * Wrap-Around Fix (#10455):
 * - Problem: In a naive timing wheel, scheduling a task with delay `d > wheelSize` calculates
 *   `targetSlot = (currentSlot + ticks) % wheelSize`. If the wheel does not track remaining complete
 *   wheel rotations (`remainingRotations`), the task will be fired the first time the wheel's hand
 *   visits `targetSlot` during revolution 0, prematurely executing tasks that requested delays
 *   spanning multiple revolutions.
 * - Solution:
 *   1. Calculate total ticks: `ticks = Math.max(0, Math.floor(delayMs / tickDurationMs))`.
 *   2. Target slot: `slotIndex = (currentSlot + ticks) % wheelSize`.
 *   3. Complete revolutions: `rotations = Math.floor(ticks / wheelSize)`.
 *   4. Each wheel tick advances `currentSlot = (currentSlot + 1) % wheelSize`.
 *   5. For each task in the visited slot:
 *      - If `task.remainingRotations > 0`, decrement `remainingRotations--` and retain in the slot.
 *      - If `task.remainingRotations === 0`, remove from slot and execute callback.
 *   6. Supports cancellation, rescheduling, zero-delay execution, and arbitrary multi-revolution delays.
 * 7. Delayed timer callbacks coalesce elapsed ticks into one deadline-ordered batch.
 */

export interface TimingWheelTask {
  id: string;
  delayMs: number;
  remainingRotations: number;
  slotIndex: number;
  targetTick: number;
  callback: () => void | Promise<void>;
  cancelled: boolean;
  executed: boolean;
}

export interface HashedTimingWheelOptions {
  /** Number of circular slots in the wheel (default: 60) */
  wheelSize?: number;
  /** Granularity of each tick in milliseconds (default: 1000ms = 1s) */
  tickDurationMs?: number;
}

export class HashedTimingWheel {
  public readonly wheelSize: number;
  public readonly tickDurationMs: number;
  private slots: Array<Map<string, TimingWheelTask>>;
  private tasksById = new Map<string, TimingWheelTask>();
  private currentSlot: number = 0;
  private currentTick: number = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private lastTickAtMs: number | null = null;
  private scheduleVersion: number = 0;

  constructor(options?: HashedTimingWheelOptions) {
    this.wheelSize = Math.max(1, options?.wheelSize ?? 60);
    this.tickDurationMs = Math.max(1, options?.tickDurationMs ?? 1000);
    this.slots = Array.from({ length: this.wheelSize }, () => new Map<string, TimingWheelTask>());
  }

  /**
   * Schedules a task to run after delayMs milliseconds.
   * Correctly computes target slot and remaining rotations to prevent premature wrap-around execution.
   */
  public schedule(
    id: string,
    delayMs: number,
    callback: () => void | Promise<void>,
  ): TimingWheelTask {
    // If a task with this id already exists, cancel it first (rescheduling)
    if (this.tasksById.has(id)) {
      this.cancel(id);
    }

    const safeDelay = Math.max(0, delayMs);
    const ticks = Math.floor(safeDelay / this.tickDurationMs);

    // Immediate execution for zero-delay (0 ticks)
    if (ticks === 0 && safeDelay === 0) {
      const task: TimingWheelTask = {
        id,
        delayMs: 0,
        remainingRotations: 0,
        slotIndex: this.currentSlot,
        targetTick: this.currentTick,
        callback,
        cancelled: false,
        executed: true,
      };
      try {
        callback();
      } catch (err) {
        console.error(`[HashedTimingWheel] Task ${id} immediate execution error:`, err);
      }
      return task;
    }

    // Wrap-around calculation (#10455)
    // Ticks at which the task should fire in absolute time
    const targetTick = this.currentTick + Math.max(1, ticks);
    // Target slot in the circular wheel
    const slotIndex = targetTick % this.wheelSize;
    // Calculate how many full revolutions of the wheel before reaching targetTick
    // When the wheel visits slotIndex, targetTick may still be in a future revolution.
    const ticksUntilTarget = targetTick - this.currentTick;
    // Difference between target slot and current slot (modulo wheelSize)
    const slotDistance = (slotIndex - this.currentSlot + this.wheelSize) % this.wheelSize;
    const remainingRotations = Math.floor(
      (ticksUntilTarget - (slotDistance === 0 ? this.wheelSize : slotDistance)) / this.wheelSize,
    );

    const task: TimingWheelTask = {
      id,
      delayMs: safeDelay,
      remainingRotations: Math.max(0, remainingRotations),
      slotIndex,
      targetTick,
      callback,
      cancelled: false,
      executed: false,
    };

    this.slots[slotIndex].set(id, task);
    this.tasksById.set(id, task);
    this.scheduleVersion += 1;

    return task;
  }

  /**
   * Reschedules an existing task with a new delay.
   */
  public reschedule(
    id: string,
    newDelayMs: number,
    newCallback?: () => void | Promise<void>,
  ): TimingWheelTask | null {
    const existing = this.tasksById.get(id);
    const callback = newCallback || existing?.callback;
    if (!callback) return null;

    this.cancel(id);
    return this.schedule(id, newDelayMs, callback);
  }

  /**
   * Cancels a scheduled task by ID.
   */
  public cancel(id: string): boolean {
    const task = this.tasksById.get(id);
    if (!task) return false;

    task.cancelled = true;
    this.slots[task.slotIndex].delete(id);
    this.tasksById.delete(id);
    if (this.tasksById.size === 0) this.stop();
    return true;
  }

  /**
   * Advances the timing wheel by one tick and executes eligible tasks.
   */
  public advanceTick(): TimingWheelTask[] {
    return this.advanceTicks(1);
  }

  /**
   * Advances a coalesced window of ticks and executes every task due within it.
   * Tasks fire in target-tick order, preserving insertion order for simultaneous
   * expirations.
   */
  public advanceTicks(tickCount: number): TimingWheelTask[] {
    if (!Number.isFinite(tickCount) || tickCount <= 0) return [];
    const ticksToAdvance = Math.floor(tickCount);
    if (ticksToAdvance <= 0) return [];

    const targetTick = this.currentTick + ticksToAdvance;
    if (!Number.isSafeInteger(targetTick)) return [];

    if (ticksToAdvance === 1) {
      return this.advanceOneTick();
    }

    const executedTasks: TimingWheelTask[] = [];
    const queuedTasks = new Set<TimingWheelTask>();
    const dueTasks = Array.from(this.tasksById.values())
      .filter((task) => task.targetTick <= targetTick)
      .sort((a, b) => a.targetTick - b.targetTick);
    for (const task of dueTasks) queuedTasks.add(task);

    let taskIndex = 0;
    let observedScheduleVersion = this.scheduleVersion;
    while (taskIndex < dueTasks.length) {
      const nextTask = dueTasks[taskIndex];
      if (!nextTask) break;
      const dueTick = nextTask.targetTick;
      this.currentTick = Math.max(this.currentTick, dueTick);
      this.currentSlot = this.currentTick % this.wheelSize;

      while (
        taskIndex < dueTasks.length &&
        dueTasks[taskIndex]?.targetTick === dueTick
      ) {
        const task = dueTasks[taskIndex];
        taskIndex += 1;
        if (!task) continue;
        if (this.tasksById.get(task.id) !== task) continue;

        this.slots[task.slotIndex].delete(task.id);
        this.tasksById.delete(task.id);
        task.remainingRotations = 0;
        task.executed = true;
        executedTasks.push(task);

        try {
          task.callback();
        } catch (err) {
          console.error(
            `[HashedTimingWheel] Task ${task.id} execution error:`,
            err,
          );
        }
      }

      if (this.scheduleVersion !== observedScheduleVersion) {
        observedScheduleVersion = this.scheduleVersion;
        const newlyDueTasks = Array.from(this.tasksById.values()).filter(
          (task) =>
            task.targetTick > this.currentTick &&
            task.targetTick <= targetTick &&
            !queuedTasks.has(task),
        );
        for (const task of newlyDueTasks) {
          queuedTasks.add(task);
          dueTasks.push(task);
        }
        dueTasks
          .slice(taskIndex)
          .sort((a, b) => a.targetTick - b.targetTick)
          .forEach((task, index) => {
            dueTasks[taskIndex + index] = task;
          });
      }
    }

    this.currentTick = Math.max(this.currentTick, targetTick);
    this.currentSlot = this.currentTick % this.wheelSize;
    for (const task of this.tasksById.values()) {
      task.remainingRotations = Math.max(
        0,
        Math.floor((task.targetTick - this.currentTick - 1) / this.wheelSize),
      );
    }
    if (this.tasksById.size === 0) this.stop();

    return executedTasks;
  }

  private advanceOneTick(): TimingWheelTask[] {
    this.currentSlot = (this.currentSlot + 1) % this.wheelSize;
    this.currentTick += 1;

    const currentSlotTasks = this.slots[this.currentSlot];
    const executedTasks: TimingWheelTask[] = [];

    // Snapshot keys to allow safe mutation/deletion during iteration
    const taskIds = Array.from(currentSlotTasks.keys());

    for (const id of taskIds) {
      const task = currentSlotTasks.get(id);
      if (!task || task.cancelled || task.executed) {
        currentSlotTasks.delete(id);
        this.tasksById.delete(id);
        continue;
      }

      // Check remaining revolutions (#10455 wrap-around fix)
      if (task.remainingRotations > 0) {
        task.remainingRotations -= 1;
        // Retain in current slot for next revolution
        continue;
      }

      // Elapsed rotations completed: execute task
      currentSlotTasks.delete(id);
      this.tasksById.delete(id);
      task.executed = true;
      executedTasks.push(task);

      try {
        task.callback();
      } catch (err) {
        console.error(`[HashedTimingWheel] Task ${id} execution error:`, err);
      }
    }

    if (this.tasksById.size === 0) this.stop();
    return executedTasks;
  }

  /**
   * Starts the internal background timer.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTickAtMs = Date.now();
    this.timerHandle = setInterval(() => {
      const now = Date.now();
      if (this.lastTickAtMs === null) {
        this.lastTickAtMs = now;
        return;
      }

      const ticksElapsed = Math.floor(
        (now - this.lastTickAtMs) / this.tickDurationMs,
      );
      if (ticksElapsed <= 0) return;

      this.lastTickAtMs += ticksElapsed * this.tickDurationMs;
      this.advanceTicks(ticksElapsed);
    }, this.tickDurationMs);
    // Unref timer in Node environment so it doesn't block process exit
    if (this.timerHandle && typeof (this.timerHandle as any).unref === "function") {
      (this.timerHandle as any).unref();
    }
  }

  /**
   * Stops the internal background timer.
   */
  public stop(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.isRunning = false;
    this.lastTickAtMs = null;
  }

  /**
   * Clears all tasks and resets wheel position.
   */
  public reset(): void {
    this.stop();
    for (const slot of this.slots) {
      slot.clear();
    }
    this.tasksById.clear();
    this.currentSlot = 0;
    this.currentTick = 0;
    this.scheduleVersion = 0;
  }

  public getTask(id: string): TimingWheelTask | undefined {
    return this.tasksById.get(id);
  }

  public getCurrentSlot(): number {
    return this.currentSlot;
  }

  public getCurrentTick(): number {
    return this.currentTick;
  }

  public getTaskCount(): number {
    return this.tasksById.size;
  }
}

/** Global singleton seat hold timing wheel (60 slots @ 1s per tick = 60s per revolution) */
export const seatHoldTimingWheel = new HashedTimingWheel({
  wheelSize: 60,
  tickDurationMs: 1000,
});

function scheduleSeatHoldExpiration(
  venueId: string,
  seatId: string,
  expiresAt: number,
): void {
  const taskId = getLockKey(venueId, seatId);
  const schedule = () => {
    const delayMs = Math.max(0, expiresAt - Date.now());
    seatHoldTimingWheel.schedule(taskId, delayMs, () => {
      if (Date.now() < expiresAt) {
        schedule();
        return;
      }

      getRedisKeyspaceManager().dispatchExpiration({
        venueId,
        deskId: seatId,
        seatId,
        rawKey: taskId,
        timestamp: expiresAt,
        source: "in_memory_simulation",
      });
    });
  };

  schedule();
  if (seatHoldTimingWheel.getTaskCount() > 0) seatHoldTimingWheel.start();
}

function cancelSeatHoldExpiration(venueId: string, seatId: string): void {
  seatHoldTimingWheel.cancel(getLockKey(venueId, seatId));
  getRedisKeyspaceManager().unregisterDeskTimer(venueId, seatId);
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
