/**
 * Distributed Seat-Hold Lock (WebLocks / Redis / PartyKit Integration)
 *
 * Implements a distributed lock mechanism with a 5-minute TTL to prevent
 * double-booking race conditions during checkout (Issue #3522).
 */

import crypto from "crypto";
import type Redis from "ioredis";
import type { Pool } from "pg";
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

  constructor(
    message: string,
    submittedToken: bigint = BigInt(0),
    lastSeenToken: bigint = BigInt(0),
  ) {
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
  /** Optional client-specific reconnect hook (for Sentinel / cluster failover). */
  reconnect?: () => Promise<void>;
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

export const REDLOCK_NODE_TIMEOUT_MS = 1_000;
export const REDLOCK_NODE_BASE_BACKOFF_MS = 250;
export const REDLOCK_NODE_MAX_BACKOFF_MS = 5_000;

interface RedlockNodeHealthState {
  failureCount: number;
  retryAt: number;
  lastError?: string;
}

export interface RedlockNodeHealth {
  nodeId: string;
  failureCount: number;
  retryAt: number;
  lastError?: string;
  degraded: boolean;
}

const redlockNodeHealth = new Map<string, RedlockNodeHealthState>();

export function getRedlockNodeHealth(now = Date.now()): RedlockNodeHealth[] {
  return Array.from(redlockNodeHealth, ([nodeId, state]) => ({
    nodeId,
    failureCount: state.failureCount,
    retryAt: state.retryAt,
    lastError: state.lastError,
    degraded: state.retryAt > now,
  }));
}

export function resetRedlockNodeHealth(): void {
  redlockNodeHealth.clear();
}

function markRedlockNodeHealthy(nodeId: string): void {
  redlockNodeHealth.delete(nodeId);
}

function markRedlockNodeFailed(
  nodeId: string,
  error: unknown,
  now: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
): void {
  const failureCount = (redlockNodeHealth.get(nodeId)?.failureCount ?? 0) + 1;
  const backoffMs = Math.min(
    maxBackoffMs,
    baseBackoffMs * 2 ** Math.min(failureCount - 1, 20),
  );
  const message = error instanceof Error ? error.message : String(error);
  redlockNodeHealth.set(nodeId, {
    failureCount,
    retryAt: now + backoffMs,
    lastError: message.slice(0, 240),
  });
}

async function withRedlockNodeTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  nodeId: string,
  operationName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Redis node ${nodeId} ${operationName} timed out after ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  options: {
    timeoutMs?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    now?: () => number;
  } = {},
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

  const timeoutMs = Math.max(
    10,
    Math.floor(options.timeoutMs ?? REDLOCK_NODE_TIMEOUT_MS),
  );
  const baseBackoffMs = Math.max(
    1,
    Math.floor(options.baseBackoffMs ?? REDLOCK_NODE_BASE_BACKOFF_MS),
  );
  const maxBackoffMs = Math.max(
    baseBackoffMs,
    Math.floor(options.maxBackoffMs ?? REDLOCK_NODE_MAX_BACKOFF_MS),
  );
  const now = options.now ?? Date.now;
  const totalNodes = activeNodes.length;
  const requiredQuorum = Math.floor(totalNodes / 2) + 1;
  const seqKey = getFencingSequenceKey(resourceKey);
  const eligibleNodes = activeNodes.filter((node) => {
    const health = redlockNodeHealth.get(node.id);
    return !health || health.retryAt <= now();
  });

  const results = await Promise.allSettled(
    eligibleNodes.map(async (node) => {
      try {
        const health = redlockNodeHealth.get(node.id);
        if (health?.failureCount && node.reconnect) {
          await withRedlockNodeTimeout(
            node.reconnect(),
            timeoutMs,
            node.id,
            "reconnect",
          );
        }
        const rawVal = await withRedlockNodeTimeout(
          node.incr(seqKey),
          timeoutMs,
          node.id,
          "INCR",
        );
        const token = BigInt(rawVal);
        markRedlockNodeHealthy(node.id);
        return { node, token };
      } catch (error) {
        markRedlockNodeFailed(
          node.id,
          error,
          now(),
          baseBackoffMs,
          maxBackoffMs,
        );
        throw error;
      }
    }),
  );

  const succeeded = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (succeeded.length < requiredQuorum) {
    throw new QuorumFencingError(
      `Failed to achieve Redlock fencing quorum (${succeeded.length}/${requiredQuorum} nodes responded)`,
      succeeded.length,
      requiredQuorum,
    );
  }

  let quorumMax = succeeded[0].token;
  for (const result of succeeded) {
    if (result.token > quorumMax) quorumMax = result.token;
  }

  const lastSeen = resourceLastSeenTokens.get(resourceKey) ?? BigInt(0);
  const candidate = quorumMax > lastSeen ? quorumMax : lastSeen + BigInt(1);
  const finalToken = nextMonotonicFencingToken(candidate - BigInt(1));
  resourceLastSeenTokens.set(resourceKey, finalToken);

  // A failed repair does not invalidate an already obtained majority. It is
  // bounded and recorded so the next acquisition can retry that node later.
  await Promise.allSettled(
    succeeded.map(async ({ node, token }) => {
      if (token >= finalToken || !node.set) return;
      try {
        await withRedlockNodeTimeout(
          node.set(seqKey, finalToken.toString()),
          timeoutMs,
          node.id,
          "counter repair",
        );
      } catch (error) {
        markRedlockNodeFailed(
          node.id,
          error,
          now(),
          baseBackoffMs,
          maxBackoffMs,
        );
      }
    }),
  );

  return {
    token: finalToken,
    quorumAchieved: succeeded.length,
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
  /** True after the one permitted checkout-time extension has been consumed. */
  extensionUsed?: boolean;
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

export function getLockKey(venueId: string, seatId: string): string {
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
        extensionUsed: false,
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
    extensionUsed: false,
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
  resetRedlockNodeHealth();
  getRedisKeyspaceManager().reset();
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
    this.slots = Array.from(
      { length: this.wheelSize },
      () => new Map<string, TimingWheelTask>(),
    );
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
        console.error(
          `[HashedTimingWheel] Task ${id} immediate execution error:`,
          err,
        );
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
    const slotDistance =
      (slotIndex - this.currentSlot + this.wheelSize) % this.wheelSize;
    const remainingRotations = Math.floor(
      (ticksUntilTarget -
        (slotDistance === 0 ? this.wheelSize : slotDistance)) /
        this.wheelSize,
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
    if (
      this.timerHandle &&
      typeof (this.timerHandle as any).unref === "function"
    ) {
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

// ---------------------------------------------------------------------------
// Redlock Multi-Node Quorum & Monotonic Database Fencing Manager
// ---------------------------------------------------------------------------

export interface RedlockOptions {
  redisClients: Redis[];
  pgPool: Pool;
  retryCount?: number;
  retryDelayMin?: number;
  retryDelayMax?: number;
  driftFactor?: number;
}

export class SeatHoldLockManager {
  private redisClients: Redis[];
  private pgPool: Pool;
  private retryCount: number;
  private retryDelayMin: number;
  private retryDelayMax: number;
  private driftFactor: number;

  constructor(options: RedlockOptions) {
    if (!options.redisClients || options.redisClients.length === 0) {
      throw new Error("Redlock requires at least one Redis client/node.");
    }
    this.redisClients = options.redisClients;
    this.pgPool = options.pgPool;
    this.retryCount = options.retryCount ?? 3;
    this.retryDelayMin = options.retryDelayMin ?? 200;
    this.retryDelayMax = options.retryDelayMax ?? 400;
    this.driftFactor = options.driftFactor ?? 0.01;
  }

  getQuorum(): number {
    return Math.floor(this.redisClients.length / 2) + 1;
  }

  async acquireLock(
    resourceKey: string,
    ttlMs: number,
  ): Promise<{
    lockValue: string;
    validityTime: number;
    fencingToken: number;
  } | null> {
    const lockValue = crypto.randomBytes(16).toString("hex");
    const quorum = this.getQuorum();

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      const startTime = Date.now();

      const acquisitionPromises = this.redisClients.map(async (client) => {
        try {
          const res = await (client as any).set(
            resourceKey,
            lockValue,
            "PX",
            ttlMs,
            "NX",
          );
          return res === "OK";
        } catch {
          return false;
        }
      });

      const results = await Promise.all(acquisitionPromises);
      const successCount = results.filter(Boolean).length;

      const elapsedTime = Date.now() - startTime;
      const clockDrift = Math.floor(ttlMs * this.driftFactor) + 2;
      const validityTime = ttlMs - elapsedTime - clockDrift;

      if (successCount >= quorum && validityTime > 0) {
        const fencingToken =
          await this.incrementAndGetFencingToken(resourceKey);
        return { lockValue, validityTime, fencingToken };
      }

      await this.releaseLock(resourceKey, lockValue);
      const delay =
        Math.random() * (this.retryDelayMax - this.retryDelayMin) +
        this.retryDelayMin;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return null;
  }

  private async incrementAndGetFencingToken(
    resourceKey: string,
  ): Promise<number> {
    const client = await this.pgPool.connect();
    try {
      await client.query("BEGIN");
      const updateRes = await client.query(
        `INSERT INTO lock_fencing_counters (resource_key, fencing_token, updated_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (resource_key)
         DO UPDATE SET fencing_token = lock_fencing_counters.fencing_token + 1, updated_at = NOW()
         RETURNING fencing_token`,
        [resourceKey],
      );
      const token = updateRes.rows[0].fencing_token;
      await client.query("COMMIT");
      return token;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async executeWithFencingToken(
    seatId: string,
    fencingToken: number,
    seatData: any,
  ): Promise<boolean> {
    const client = await this.pgPool.connect();
    try {
      const res = await client.query(
        `UPDATE seat_allocations
         SET status = $1, fencing_token = $2, updated_at = NOW()
         WHERE seat_id = $3 AND (fencing_token IS NULL OR $2 > fencing_token)`,
        [seatData.status, fencingToken, seatId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new StaleFencingTokenError(
          `Stale fencing token ${fencingToken} rejected for seat ${seatId}`,
        );
      }
      return true;
    } finally {
      client.release();
    }
  }

  async releaseLock(resourceKey: string, lockValue: string): Promise<void> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await Promise.all(
      this.redisClients.map(async (client) => {
        try {
          await (client as any).eval(luaScript, 1, resourceKey, lockValue);
        } catch {
          // Ignore release errors on unreachable nodes
        }
      }),
    );
  }
}
