/**
 * Client-side IndexedDB cache for generated zk-SNARK proofs (#3358).
 *
 * snarkjs proving takes 1–3 s. The membership circuit's only public signal is
 * the Poseidon commitment, so a proof stays valid for the same credential
 * until the circuit's keys change. Reusing it makes repeat checks a fast
 * IndexedDB read instead of a full re-prove.
 *
 * Safety rules:
 *  - The raw identity token is never stored. Entries are keyed by the
 *    commitment, which is already public (it is what the server checks).
 *  - Entries are bound to an epoch: a fingerprint of the circuit's
 *    verification key. Rebuilding the circuit/zkey changes the epoch, so
 *    every cached proof is invalidated automatically.
 *  - A cached proof is a bearer credential at rest, so it has a hard
 *    expiry. Fresh entries are served directly; stale ones are served while a
 *    replacement is generated in the background; expired ones are deleted.
 *  - Storing a proof for a new credential evicts the previous credential's
 *    proof in the same scope, and server rejections evict the entry.
 *  - Enforces a configurable byte budget (default 50MB) with LRU eviction.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface CachedProof {
  proof: unknown;
  publicSignals: string[];
}

export interface ProofCacheEntry extends CachedProof {
  /** `${scope}:${commit}` */
  key: string;
  scope: string;
  commit: string;
  epoch: string;
  createdAt: number;
  /** After this, the entry is stale: still served, but regenerated in the background. */
  refreshAt: number;
  /** After this, the entry is never served. */
  expiresAt: number;
  /** Approximate serialized memory/storage byte size */
  byteSize: number;
  /** Timestamp of most recent read/write for LRU tracking */
  lastAccessedAt: number;
}

export type ProofSource = "cache" | "stale-cache" | "generated";

export interface ProofCacheOptions {
  /** Served without regeneration for this long. Default 12 h. */
  freshMs?: number;
  /** Hard limit on how long a proof may sit in storage. Default 24 h. */
  maxAgeMs?: number;
  /** Maximum aggregate byte size allowed in the proof cache before LRU eviction. Default 50 MB. */
  maxByteSize?: number;
}

export const DEFAULT_FRESH_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB

const DB_NAME = "worksphere-zkp-proofs";
const STORE = "proofs";
const VERIFICATION_KEY_URL = "/zkp/verification_key.json";

interface ProofCacheDB extends DBSchema {
  proofs: {
    key: string;
    value: ProofCacheEntry;
    indexes: { scope: string };
  };
}

let dbPromise: Promise<IDBPDatabase<ProofCacheDB>> | null = null;
let epochPromise: Promise<string | null> | null = null;
const inFlight = new Map<string, Promise<CachedProof>>();

function getDb(): Promise<IDBPDatabase<ProofCacheDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ProofCacheDB>(DB_NAME, 1, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("scope", "scope");
      },
    });
  }
  return dbPromise;
}

export function isProofCacheAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Recursively converts any BigInt values inside an object, array, or primitive into decimal strings.
 */
export function serializeBigInts<T>(value: T): T {
  if (typeof value === "bigint") {
    return (value as bigint).toString() as unknown as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInts(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = serializeBigInts(v);
  }
  return result as unknown as T;
}

/**
 * Safely serializes an object to JSON without throwing TypeError on BigInt values.
 */
export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  } catch {
    return "{}";
  }
}

/**
 * Normalizes a proof and its public signals, converting any BigInt witness outputs into strings.
 */
export function sanitizeProofForStorage(proof: CachedProof): CachedProof {
  return {
    proof: serializeBigInts(proof.proof),
    publicSignals: Array.isArray(proof.publicSignals)
      ? proof.publicSignals.map((s) =>
          typeof s === "bigint" ? (s as bigint).toString() : String(s),
        )
      : [],
  };
}

/**
 * Calculates the approximate serialized memory footprint of a cached proof in bytes.
 * Safely handles BigInt values in witness outputs.
 */
export function calculateProofEntryBytes(
  proof: CachedProof | ProofCacheEntry | unknown,
): number {
  try {
    const json = safeJsonStringify(proof);
    return typeof Buffer !== "undefined"
      ? Buffer.byteLength(json, "utf8")
      : new TextEncoder().encode(json).length;
  } catch {
    return 1024;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fingerprint of the circuit's verification key. Changes whenever the
 * circuit or trusted setup is rebuilt. Null when it can't be fetched, in
 * which case nothing is cached (proofs would be unverifiable anyway).
 */
export function getCircuitEpoch(): Promise<string | null> {
  if (!epochPromise) {
    epochPromise = (async () => {
      try {
        const res = await fetch(VERIFICATION_KEY_URL, { cache: "no-cache" });
        if (!res.ok) return null;
        return (await sha256Hex(await res.text())).slice(0, 32);
      } catch {
        return null;
      }
    })();
    // Retry on a later call if this one failed.
    void epochPromise.then((epoch) => {
      if (epoch === null) epochPromise = null;
    });
  }
  return epochPromise;
}

const entryKey = (scope: string, commit: string) => `${scope}:${commit}`;

function isUsable(entry: ProofCacheEntry | undefined, commit: string, epoch: string, now: number): boolean {
  return (
    !!entry &&
    entry.epoch === epoch &&
    entry.expiresAt > now &&
    Array.isArray(entry.publicSignals) &&
    // Integrity: the proof must be for this credential's commitment.
    entry.publicSignals[0] === commit &&
    typeof entry.proof === "object" &&
    entry.proof !== null
  );
}

/** Read a usable cached proof, deleting it if it is expired or from another epoch. */
export async function getCachedProof(scope: string, commit: string): Promise<ProofCacheEntry | null> {
  if (!isProofCacheAvailable()) return null;
  const epoch = await getCircuitEpoch();
  if (!epoch) return null;
  try {
    const db = await getDb();
    const entry = await db.get(STORE, entryKey(scope, commit));
    if (entry && isUsable(entry, commit, epoch, Date.now())) {
      // Refresh lastAccessedAt for LRU accuracy
      entry.lastAccessedAt = Date.now();
      void db.put(STORE, entry).catch(() => {});
      return entry;
    }
    if (entry) {
      await db.delete(STORE, entry.key);
      void purgeExpiredProofs().catch(() => {});
    }
  } catch {
    // IndexedDB blocked (private mode, quota): behave as a miss
  }
  return null;
}

/**
 * Store a proof for `commit`, replacing any other credential's proof in the
 * same scope (one active identity per scope) and enforcing byte budget LRU eviction.
 */
export async function storeProof(
  scope: string,
  commit: string,
  proof: CachedProof,
  options: ProofCacheOptions = {},
): Promise<void> {
  const sanitizedProof = sanitizeProofForStorage(proof);
  const normalizedCommit =
    typeof commit === "bigint" ? (commit as bigint).toString() : String(commit);

  if (!isProofCacheAvailable() || sanitizedProof.publicSignals[0] !== normalizedCommit) return;
  const epoch = await getCircuitEpoch();
  if (!epoch) return;

  const now = Date.now();
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const fresh = Math.min(options.freshMs ?? DEFAULT_FRESH_MS, maxAge);
  const maxByteSize = options.maxByteSize ?? DEFAULT_MAX_CACHE_BYTES;
  const entryBytes = calculateProofEntryBytes(sanitizedProof);

  const entry: ProofCacheEntry = {
    key: entryKey(scope, normalizedCommit),
    scope,
    commit: normalizedCommit,
    epoch,
    proof: sanitizedProof.proof,
    publicSignals: sanitizedProof.publicSignals,
    createdAt: now,
    refreshAt: now + fresh,
    expiresAt: now + maxAge,
    byteSize: entryBytes,
    lastAccessedAt: now,
  };

  const attemptWrite = async (database: any) => {
    const tx = database.transaction(STORE, "readwrite");
    const others = await tx.store.index("scope").getAllKeys(scope);
    await Promise.all(others.filter((k: string) => k !== entry.key).map((k: string) => tx.store.delete(k)));

    // Purge expired entries in transaction
    const allEntries: ProofCacheEntry[] = await tx.store.getAll();
    const now = Date.now();
    for (const e of allEntries) {
      if (e.expiresAt <= now) {
        await tx.store.delete(e.key);
      }
    }

    const validEntries = allEntries.filter((e) => e.expiresAt > now);
    let totalBytes = validEntries.reduce((acc, e) => acc + (e.byteSize || calculateProofEntryBytes(e)), 0);

    // Evict oldest (least recently accessed) entries until new entry fits within maxByteSize
    if (totalBytes + entryBytes > maxByteSize) {
      const sorted = validEntries
        .filter((e) => e.key !== entry.key)
        .sort((a, b) => (a.lastAccessedAt || a.createdAt) - (b.lastAccessedAt || b.createdAt));

      for (const oldest of sorted) {
        if (totalBytes + entryBytes <= maxByteSize) break;
        await tx.store.delete(oldest.key);
        totalBytes -= oldest.byteSize || calculateProofEntryBytes(oldest);
      }
    }

    await tx.store.put(entry);
    await tx.done;
  };

  try {
    const db = await getDb();
    await attemptWrite(db);
  } catch (err) {
    const { isQuotaExceededError, dispatchStorageQuotaWarning } = await import(
      "@/lib/cache/storageQuota"
    );

    if (isQuotaExceededError(err)) {
      console.warn("[ProofCache] Storage quota exceeded; clearing proof cache and retrying.");
      dispatchStorageQuotaWarning("proofCache", err);

      try {
        const db = await getDb();
        await db.clear(STORE);
        await attemptWrite(db);
      } catch (retryErr) {
        console.warn("[ProofCache] Retrying storeProof after cache clear failed:", retryErr);
      }
    }
    // Caching is best-effort - never bubble unhandled rejection
  }
}

/** Drop one credential's proof, e.g. after the server rejects it. */
export async function invalidateProof(scope: string, commit: string): Promise<void> {
  if (!isProofCacheAvailable() || !scope || !commit) return;
  try {
    await (await getDb()).delete(STORE, entryKey(scope, commit));
  } catch {
    // ignore
  }
}

/**
 * Automatically purges all expired proof entries and cross-epoch entries from IndexedDB.
 * Returns the count of deleted entries.
 */
export async function purgeExpiredProofs(): Promise<number> {
  if (!isProofCacheAvailable()) return 0;
  const epoch = await getCircuitEpoch();
  try {
    const db = await getDb();
    const tx = db.transaction(STORE, "readwrite");
    const allEntries: ProofCacheEntry[] = await tx.store.getAll();
    const now = Date.now();
    let purgedCount = 0;

    for (const entry of allEntries) {
      if (entry.expiresAt <= now || (epoch && entry.epoch !== epoch)) {
        await tx.store.delete(entry.key);
        purgedCount++;
      }
    }
    await tx.done;
    return purgedCount;
  } catch {
    return 0;
  }
}

/** Drop every cached proof (call on sign-out or account switch). */
export async function clearProofCache(): Promise<void> {
  if (!isProofCacheAvailable()) return;
  try {
    await (await getDb()).clear(STORE);
  } catch {
    // ignore
  }
}

function generateOnce(
  scope: string,
  commit: string,
  generate: () => Promise<CachedProof>,
  options: ProofCacheOptions,
): Promise<CachedProof> {
  const key = entryKey(scope, commit);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async () => {
    const proof = await generate();
    await storeProof(scope, commit, proof, options);
    return proof;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/**
 * Return a proof for `commit`: from cache when fresh, from cache plus a
 * background refresh when stale, otherwise by calling `generate`.
 * Concurrent calls for the same credential share one proving run.
 */
export async function getOrCreateProof(input: {
  scope: string;
  commit: string;
  generate: () => Promise<CachedProof>;
  options?: ProofCacheOptions;
  /** Called when a background refresh fails (the stale proof was already served). */
  onBackgroundError?: (error: unknown) => void;
}): Promise<CachedProof & { source: ProofSource }> {
  const { scope, commit, generate, options = {}, onBackgroundError } = input;

  const cached = await getCachedProof(scope, commit);
  if (cached) {
    const result = { proof: cached.proof, publicSignals: cached.publicSignals };
    if (Date.now() < cached.refreshAt) return { ...result, source: "cache" };

    void generateOnce(scope, commit, generate, options).catch((err) => onBackgroundError?.(err));
    return { ...result, source: "stale-cache" };
  }

  const proof = await generateOnce(scope, commit, generate, options);
  return { ...proof, source: "generated" };
}

/** Reset module state. Exported for tests only. @internal */
export async function _resetProofCacheForTesting(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      // ignore
    }
  }
  dbPromise = null;
  epochPromise = null;
  inFlight.clear();
}
