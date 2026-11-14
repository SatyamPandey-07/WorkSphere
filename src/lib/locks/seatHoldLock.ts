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

export class QuorumFencingError extends Error {
  readonly code = "QUORUM_FENCING_ERROR";
  readonly achievedNodes: number;
  readonly requiredQuorum: number;

  constructor(message: string, achievedNodes: number, requiredQuorum: number) {
    super(message);
    this.name = "QuorumFencingError";
    this.achievedNodes = achievedNodes;
    this.requiredQuorum = requiredQuorum;
  }
}

export class StaleFencingTokenError extends Error {
  readonly code = "STALE_FENCING_TOKEN";
  readonly submittedToken: bigint;
  readonly lastSeenToken: bigint;

  constructor(message: string, submittedToken: bigint, lastSeenToken: bigint) {
    super(message);
    this.name = "StaleFencingTokenError";
    this.submittedToken = submittedToken;
    this.lastSeenToken = lastSeenToken;
  }
}

export interface RedlockRedisNode {
  id: string;
  incr: (key: string) => Promise<number | string | bigint>;
  get?: (key: string) => Promise<string | number | null>;
  set?: (
    key: string,
    value: string,
    options?: { ex?: number; nx?: boolean },
  ) => Promise<unknown>;
  eval?: (script: string, keys: string[], args: string[]) => Promise<unknown>;
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
const resourceLastSeenTokens = new Map<string, bigint>();
let registeredRedlockNodes: RedlockRedisNode[] | null = null;

/**
 * Configures independent Redis nodes for N/2+1 Redlock quorum consensus.
 */
export function configureRedlockNodes(nodes: RedlockRedisNode[] | null): void {
  registeredRedlockNodes = nodes;
}

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
  resourceLastSeenTokens.clear();
}

function getFencingSequenceKey(resourceKey: string): string {
  return `seat:fence:seq:${resourceKey}`;
}

/**
 * Issues a strictly monotonic fencing token using Redis INCR against a persistent
 * sequence key with majority quorum confirmation across N/2+1 independent Redis nodes.
 * Ensures that even across master-replica failovers or partitions, a promoted replica
 * with a lagging counter cannot issue a token <= an earlier partitioned master's token.
 */
export async function acquireQuorumFencingToken(
  resourceKey: string,
  nodes?: RedlockRedisNode[],
): Promise<{
  token: bigint;
  quorumAchieved: number;
  quorumRequired: number;
}> {
  const activeNodes =
    nodes && nodes.length > 0
      ? nodes
      : registeredRedlockNodes && registeredRedlockNodes.length > 0
        ? registeredRedlockNodes
        : null;

  if (!activeNodes) {
    const fallback = nextMonotonicFencingToken(
      resourceLastSeenTokens.get(resourceKey),
    );
    resourceLastSeenTokens.set(resourceKey, fallback);
    return { token: fallback, quorumAchieved: 1, quorumRequired: 1 };
  }

  const totalNodes = activeNodes.length;
  const requiredQuorum = Math.floor(totalNodes / 2) + 1;
  const seqKey = getFencingSequenceKey(resourceKey);

  const results = await Promise.allSettled(
    activeNodes.map(async (node) => {
      const rawVal = await node.incr(seqKey);
      return BigInt(rawVal);
    }),
  );

  const succeededTokens: bigint[] = [];
  for (const res of results) {
    if (res.status === "fulfilled") {
      succeededTokens.push(res.value);
    }
  }

  if (succeededTokens.length < requiredQuorum) {
    throw new QuorumFencingError(
      `Failed to achieve Redlock fencing quorum (${succeededTokens.length}/${requiredQuorum} nodes responded)`,
      succeededTokens.length,
      requiredQuorum,
    );
  }

  // Take the maximum INCR value across the responding quorum and enforce strict monotonicity
  // against any previously observed token for this resource so lagging replicas cannot regress.
  let quorumMax = succeededTokens[0];
  for (const val of succeededTokens) {
    if (val > quorumMax) {
      quorumMax = val;
    }
  }

  const lastSeen = resourceLastSeenTokens.get(resourceKey) ?? BigInt(0);
  const candidate = quorumMax > lastSeen ? quorumMax : lastSeen + BigInt(1);
  const finalToken = nextMonotonicFencingToken(candidate - BigInt(1));

  resourceLastSeenTokens.set(resourceKey, finalToken);

  // Best-effort bump on any lagging quorum nodes whose counter was behind finalToken
  await Promise.allSettled(
    activeNodes.map(async (node, idx) => {
      const res = results[idx];
      if (res.status === "fulfilled" && res.value < finalToken && node.set) {
        await node.set(seqKey, finalToken.toString());
      }
    }),
  );

  return {
    token: finalToken,
    quorumAchieved: succeededTokens.length,
    quorumRequired: requiredQuorum,
  };
}

export interface FencingTokenStore {
  getLastSeenToken: (
    resourceKey: string,
  ) => Promise<bigint | string | number | null | undefined>;
  saveLastSeenToken: (resourceKey: string, token: bigint) => Promise<void>;
}

/**
 * Verifies inside a database transaction that a submitted fencing token satisfies
 * `token > last_seen_token` before recording the new high-water mark.
 * Rejects stale/overlapping tokens (e.g., from a partitioned master or lagging replica)
 * with StaleFencingTokenError to preserve strict serializability.
 */
export async function verifyAndAdvanceDbFencingToken(
  resourceKey: string,
  submittedToken: bigint | string | number,
  store?: FencingTokenStore,
): Promise<{ accepted: true; token: bigint; previousToken: bigint }> {
  const token =
    typeof submittedToken === "bigint"
      ? submittedToken
      : BigInt(submittedToken);

  const rawLastSeen = store
    ? await store.getLastSeenToken(resourceKey)
    : resourceLastSeenTokens.get(resourceKey);

  const lastSeenToken =
    rawLastSeen !== undefined && rawLastSeen !== null
      ? BigInt(rawLastSeen)
      : BigInt(0);

  if (token <= lastSeenToken) {
    throw new StaleFencingTokenError(
      `Rejected stale fencing token ${token.toString()} <= last_seen_token ${lastSeenToken.toString()} for ${resourceKey}`,
      token,
      lastSeenToken,
    );
  }

  if (store) {
    await store.saveLastSeenToken(resourceKey, token);
  }
  resourceLastSeenTokens.set(resourceKey, token);

  return {
    accepted: true,
    token,
    previousToken: lastSeenToken,
  };
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
  reason?: "ALREADY_HELD" | "QUORUM_FAILED" | "ERROR";
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
 * Attempts to acquire an exclusive 5-minute lock on a seat using Redlock quorum
 * fencing token generation when a multi-node cluster is configured.
 */
export async function acquireSeatWebLock(
  venueId: string,
  seatId: string,
  userId: string,
  userName?: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
  redlockNodes?: RedlockRedisNode[],
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

  let initialToken: bigint;
  try {
    const quorum = await acquireQuorumFencingToken(
      `${venueId}:${seatId}`,
      redlockNodes,
    );
    initialToken = quorum.token;
  } catch (err) {
    if (err instanceof QuorumFencingError) {
      return {
        success: false,
        reason: "QUORUM_FAILED",
      };
    }
    throw err;
  }

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
        getRedisKeyspaceManager().registerDeskTimer(
          venueId,
          seatId,
          resolvedLock.expiresAt,
        );
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
  const prevExisting = existing?.fencingToken
    ? BigInt(existing.fencingToken)
    : BigInt(0);
  const token =
    initialToken > prevExisting
      ? initialToken
      : nextMonotonicFencingToken(prevExisting);
  resourceLastSeenTokens.set(`${venueId}:${seatId}`, token);

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
  getRedisKeyspaceManager().registerDeskTimer(
    venueId,
    seatId,
    lockPayload.expiresAt,
  );
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

  getRedisKeyspaceManager().unregisterDeskTimer(venueId, seatId);

  if (redis) {
    try {
      const released = await redis.eval(SEAT_LOCK_RELEASE_LUA, [key], [userId]);
      return Number(released) === 1;
    } catch (err) {
      console.warn(
        "[SeatLock] Redis release failed, falling back to memory:",
        err,
      );
    }
  }

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

  stopSeatLockRenewalHeartbeat(venueId, seatId, userId);

  const heartbeatFn = async () => {
    if (!activeHeartbeats.has(key)) return;

    try {
      const result = await renewSeatWebLock(
        venueId,
        seatId,
        userId,
        userName,
        ttlSeconds,
      );

      if (!activeHeartbeats.has(key)) return;

      if (result.success && result.lock) {
        const entry = activeHeartbeats.get(key);
        if (entry) {
          entry.lastRenewedAt = Date.now();
        }
        onRenewSuccess?.(result.lock);
      } else {
        stopSeatLockRenewalHeartbeat(venueId, seatId, userId);
        onRenewFailed?.(result.reason || "RENEWAL_REJECTED");
      }
    } catch (err: unknown) {
      console.warn(
        `[SeatLock Heartbeat] Renewal failed for ${venueId}:${seatId}:`,
        err,
      );
      stopSeatLockRenewalHeartbeat(venueId, seatId, userId);
      const msg = err instanceof Error ? err.message : "HEARTBEAT_ERROR";
      onRenewFailed?.(msg);
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

export function stopAllSeatLockRenewalHeartbeats(): void {
  for (const entry of activeHeartbeats.values()) {
    clearInterval(entry.timer);
  }
  activeHeartbeats.clear();
}

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
  registeredRedlockNodes = null;
  getRedisKeyspaceManager().reset();
}

export interface SeatWebLockOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

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

  return callback(() => {});
}
