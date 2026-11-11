/**
 * Distributed Redlock mutex for multi-region seat-hold concurrency (#7388).
 *
 * Implements the Redlock algorithm across N independent Redis masters:
 *  - a lock is only granted when a majority (floor(N / 2) + 1) of nodes agree
 *  - clock-drift tolerance is subtracted from the requested TTL
 *  - partial acquisitions are unwound on every node when quorum fails
 *
 * When fewer than three nodes are configured (local dev / single-instance /
 * tests) the module degrades to an in-process lock map with identical TTL
 * semantics.
 */

import crypto from "crypto";
import { Redis } from "@upstash/redis";

export const MIN_REDLOCK_NODES = 3;
export const DEFAULT_DRIFT_FACTOR = 0.01;
export const DEFAULT_RETRY_COUNT = 0;
export const DEFAULT_RETRY_DELAY_MS = 50;

const REDLOCK_KEY_PREFIX = "worksphere:redlock";

export const REDLOCK_RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

export interface RedlockNode {
  set(
    key: string,
    value: string,
    options: { nx: true; px: number },
  ): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export interface RedlockAcquireOptions {
  nodes?: RedlockNode[];
  driftFactor?: number;
  retryCount?: number;
  retryDelayMs?: number;
  nodeTimeoutMs?: number;
}

export interface RedlockReleaseOptions {
  nodes?: RedlockNode[];
  nodeTimeoutMs?: number;
}

export type RedlockFailureReason =
  | "INVALID_ARGUMENT"
  | "QUORUM_NOT_REACHED"
  | "ALREADY_HELD"
  | "ERROR";

export interface DistributedLockResult {
  success: boolean;
  resourceKey: string;
  lockValue?: string;
  ttlMs: number;
  quorum: number;
  nodeCount: number;
  acquiredNodes: number;
  driftMs: number;
  elapsedMs: number;
  validUntil?: number;
  usedFallback: boolean;
  reason?: RedlockFailureReason;
}

interface MemoryLockEntry {
  value: string;
  expiresAt: number;
}

interface RedlockRuntimeConfig {
  nodes: RedlockNode[] | null;
  driftFactor: number;
  retryCount: number;
  retryDelayMs: number;
}

const runtime: RedlockRuntimeConfig = {
  nodes: null,
  driftFactor: DEFAULT_DRIFT_FACTOR,
  retryCount: DEFAULT_RETRY_COUNT,
  retryDelayMs: DEFAULT_RETRY_DELAY_MS,
};

const memoryLocks = new Map<string, MemoryLockEntry>();

let envNodesCache: RedlockNode[] | null = null;

function quorumFor(nodeCount: number): number {
  return Math.floor(nodeCount / 2) + 1;
}

function redlockKey(resourceKey: string): string {
  return `${REDLOCK_KEY_PREFIX}:${resourceKey}`;
}

function generateLockValue(): string {
  return crypto.randomBytes(16).toString("hex");
}

function monotonicNow(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("REDLOCK_NODE_TIMEOUT")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function pruneMemoryLocks(now: number = Date.now()): void {
  for (const [key, entry] of memoryLocks.entries()) {
    if (now >= entry.expiresAt) {
      memoryLocks.delete(key);
    }
  }
}

function isLockAcquired(raw: unknown): boolean {
  return raw === "OK" || raw === true || raw === 1;
}

async function tryAcquireOnNode(
  node: RedlockNode,
  key: string,
  lockValue: string,
  ttlMs: number,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const result = await withTimeout(
      Promise.resolve(node.set(key, lockValue, { nx: true, px: ttlMs })),
      timeoutMs,
    );
    return isLockAcquired(result);
  } catch {
    return false;
  }
}

async function tryReleaseOnNode(
  node: RedlockNode,
  key: string,
  lockValue: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const result = await withTimeout(
      Promise.resolve(
        node.eval(REDLOCK_RELEASE_LUA, [key], [lockValue]),
      ),
      timeoutMs,
    );
    return Number(result) === 1;
  } catch {
    return false;
  }
}

async function releaseOnAllNodes(
  nodes: RedlockNode[],
  key: string,
  lockValue: string,
  timeoutMs: number,
): Promise<number> {
  const results = await Promise.all(
    nodes.map((node) =>
      tryReleaseOnNode(node, key, lockValue, timeoutMs),
    ),
  );
  return results.filter(Boolean).length;
}

function loadEnvNodes(): RedlockNode[] {
  const raw = process.env.REDLOCK_REDIS_NODES;
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is { url: string; token: string } =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as { url?: unknown }).url === "string" &&
          typeof (entry as { token?: unknown }).token === "string",
      )
      .map(
        (entry) =>
          new Redis({
            url: entry.url,
            token: entry.token,
          }) as unknown as RedlockNode,
      );
  } catch {
    return [];
  }
}

function resolveNodes(explicit?: RedlockNode[]): RedlockNode[] {
  if (explicit) return explicit;
  if (runtime.nodes !== null) return runtime.nodes;
  if (envNodesCache === null) {
    envNodesCache = loadEnvNodes();
  }
  return envNodesCache;
}

function defaultNodeTimeoutMs(ttlMs: number): number {
  return Math.max(5, Math.min(50, Math.floor(ttlMs / 20)));
}

function acquireMemoryLock(
  resourceKey: string,
  ttlMs: number,
  base: Omit<DistributedLockResult, "success" | "acquiredNodes">,
): DistributedLockResult {
  const now = Date.now();
  pruneMemoryLocks(now);

  const existing = memoryLocks.get(resourceKey);
  if (existing && now < existing.expiresAt) {
    return {
      ...base,
      success: false,
      acquiredNodes: 0,
      quorum: 1,
      usedFallback: true,
      reason: "ALREADY_HELD",
    };
  }

  const lockValue = generateLockValue();
  memoryLocks.set(resourceKey, {
    value: lockValue,
    expiresAt: now + ttlMs,
  });

  return {
    ...base,
    success: true,
    lockValue,
    acquiredNodes: 1,
    quorum: 1,
    usedFallback: true,
    validUntil: now + ttlMs,
  };
}

function releaseMemoryLock(resourceKey: string, lockValue: string): boolean {
  pruneMemoryLocks();
  const existing = memoryLocks.get(resourceKey);
  if (!existing) return false;
  if (existing.value !== lockValue) return false;
  memoryLocks.delete(resourceKey);
  return true;
}

/**
 * Override the Redis node list (useful for tests and multi-region setup).
 * Pass null to fall back to `REDLOCK_REDIS_NODES` / in-memory mode.
 */
export function setRedlockNodes(nodes: RedlockNode[] | null): void {
  runtime.nodes = nodes;
}

/**
 * Configure the default Redlock runtime used by the acquire/release helpers.
 */
export function configureRedlock(options: RedlockAcquireOptions): void {
  if (options.nodes !== undefined) {
    runtime.nodes = options.nodes;
  }
  if (typeof options.driftFactor === "number") {
    runtime.driftFactor = options.driftFactor;
  }
  if (typeof options.retryCount === "number") {
    runtime.retryCount = options.retryCount;
  }
  if (typeof options.retryDelayMs === "number") {
    runtime.retryDelayMs = options.retryDelayMs;
  }
}

export function getRedlockNodes(): RedlockNode[] {
  return resolveNodes();
}

/**
 * Reset all overrides, cached env clients, and in-memory locks (test isolation).
 */
export function resetRedlock(): void {
  runtime.nodes = null;
  runtime.driftFactor = DEFAULT_DRIFT_FACTOR;
  runtime.retryCount = DEFAULT_RETRY_COUNT;
  runtime.retryDelayMs = DEFAULT_RETRY_DELAY_MS;
  envNodesCache = null;
  memoryLocks.clear();
}

/**
 * Acquire a distributed lock for `resourceKey`.
 *
 * Succeeds only when a majority of configured nodes grant the lock and the
 * remaining validity (TTL - elapsed - clock drift) is positive. On failure,
 * every partially acquired node is released before returning.
 */
export async function acquireDistributedLock(
  resourceKey: string,
  ttlMs: number,
  options: RedlockAcquireOptions = {},
): Promise<DistributedLockResult> {
  const nodes = resolveNodes(options.nodes);
  const nodeCount = nodes.length;
  const quorum = quorumFor(nodeCount);
  const driftFactor = options.driftFactor ?? runtime.driftFactor;
  const driftMs = ttlMs * driftFactor + 2;

  const base: Omit<DistributedLockResult, "success" | "acquiredNodes"> = {
    resourceKey,
    ttlMs,
    quorum,
    nodeCount,
    driftMs,
    elapsedMs: 0,
    usedFallback: false,
  };

  if (
    typeof resourceKey !== "string" ||
    resourceKey.trim() === "" ||
    !Number.isFinite(ttlMs) ||
    ttlMs <= 0
  ) {
    return {
      ...base,
      success: false,
      acquiredNodes: 0,
      reason: "INVALID_ARGUMENT",
    };
  }

  if (nodeCount < MIN_REDLOCK_NODES) {
    return acquireMemoryLock(resourceKey, ttlMs, base);
  }

  const retryCount = Math.max(
    0,
    options.retryCount ?? runtime.retryCount,
  );
  const retryDelayMs = Math.max(
    0,
    options.retryDelayMs ?? runtime.retryDelayMs,
  );
  const nodeTimeoutMs =
    options.nodeTimeoutMs ?? defaultNodeTimeoutMs(ttlMs);
  const key = redlockKey(resourceKey);

  let lastAcquired = 0;
  let lastElapsed = 0;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const lockValue = generateLockValue();
    const startedAt = monotonicNow();

    const results = await Promise.all(
      nodes.map((node) =>
        tryAcquireOnNode(node, key, lockValue, ttlMs, nodeTimeoutMs),
      ),
    );

    const acquiredNodes = results.filter(Boolean).length;
    const elapsedMs = Math.max(0, monotonicNow() - startedAt);
    const validityMs = ttlMs - elapsedMs - driftMs;

    lastAcquired = acquiredNodes;
    lastElapsed = elapsedMs;

    if (acquiredNodes >= quorum && validityMs > 0) {
      return {
        ...base,
        success: true,
        lockValue,
        acquiredNodes,
        elapsedMs,
        validUntil: Date.now() + validityMs,
      };
    }

    // Quorum or validity failed — unwind partial acquisitions on every node.
    await releaseOnAllNodes(nodes, key, lockValue, nodeTimeoutMs);

    if (attempt < retryCount && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
  }

  return {
    ...base,
    success: false,
    acquiredNodes: lastAcquired,
    elapsedMs: lastElapsed,
    reason: "QUORUM_NOT_REACHED",
  };
}

/**
 * Release a previously acquired lock. The compare-and-delete Lua script only
 * removes the key when it still holds `lockValue`, so an expired holder can
 * never release a newer owner's lock.
 *
 * Returns true when at least one node confirmed the release.
 */
export async function releaseDistributedLock(
  resourceKey: string,
  lockValue: string,
  options: RedlockReleaseOptions = {},
): Promise<boolean> {
  if (
    typeof resourceKey !== "string" ||
    resourceKey.trim() === "" ||
    typeof lockValue !== "string" ||
    lockValue === ""
  ) {
    return false;
  }

  const nodes = resolveNodes(options.nodes);
  if (nodes.length < MIN_REDLOCK_NODES) {
    return releaseMemoryLock(resourceKey, lockValue);
  }

  const nodeTimeoutMs = options.nodeTimeoutMs ?? 1000;
  const released = await releaseOnAllNodes(
    nodes,
    redlockKey(resourceKey),
    lockValue,
    nodeTimeoutMs,
  );

  return released > 0;
}
