/**
 * Client-Side SnarkJS Proof Verification Cache in IndexedDB (#9500)
 *
 * Implements a secure client-side IndexedDB cache for successfully verified
 * Groth16 zero-knowledge proofs. Avoids repeated expensive pairing operations
 * for identical, previously validated proofs while guaranteeing that tampered
 * proofs, altered public signals, or different verification contexts always
 * trigger fresh cryptographic verification.
 *
 * Security Guarantees:
 * 1. Security > Cache Performance: A cache hit must NEVER allow an invalid
 *    or tampered proof to bypass verification.
 * 2. Deterministic Canonical Hashing: All proof inputs, public signals, Merkle
 *    roots, circuit identifiers, and verification key fingerprints are canonicalized
 *    and cryptographically hashed with SHA-256 via Web Crypto API.
 * 3. Never Cache Failures: Only proofs whose SnarkJS verification evaluates to
 *    `true` are stored. Failed or thrown verifications are never cached.
 * 4. Verification Context Isolation: Proofs verified under one circuit or vKey
 *    cannot be reused for another circuit or vKey.
 * 5. Configurable Expiration & Bounded Storage: Default 24h TTL, LRU eviction,
 *    and automatic background expiration purging during idle intervals.
 */

import { openDB, type IDBPDatabase } from "idb";

export const ZKP_VERIFIED_PROOFS_DB_NAME = "worksphere_zkp_verification_db";
export const ZKP_VERIFIED_PROOFS_STORE_NAME = "zkp_verified_proofs";
export const ZKP_VERIFIED_PROOFS_INDEX_HASH = "proofHash";
export const DEFAULT_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_MAX_VERIFIED_ENTRIES = 500;

export interface VerifiedProofEntry {
  cacheKey: string;
  proofHash: string;
  publicSignals: string[];
  merkleRoot?: string;
  circuitId?: string;
  vKeyFingerprint?: string;
  verifiedAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  /** Optional metadata / context */
  metadata?: Record<string, unknown>;
}

export interface VerificationCacheOptions {
  dbName?: string;
  storeName?: string;
  ttlMs?: number;
  maxEntries?: number;
  circuitId?: string;
  vKeyFingerprint?: string;
  merkleRoot?: string;
}

export interface VerificationInput {
  proof: unknown;
  publicSignals: (string | number | bigint)[];
  merkleRoot?: string;
  circuitId?: string;
  vKey?: unknown;
  vKeyFingerprint?: string;
}

export interface CacheCheckResult {
  hit: boolean;
  entry?: VerifiedProofEntry;
  reason?: "miss" | "expired" | "mismatch" | "storage_disabled" | "error";
}

let dbInstancePromise: Promise<IDBPDatabase<any>> | null = null;
let scheduledCleanupTimeout: any = null;

/**
 * Checks whether IndexedDB and Web Crypto subtle are available.
 */
export function isVerificationCacheAvailable(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined"
  );
}

/**
 * Recursively canonicalizes any JS value:
 * - Sorts object keys alphabetically
 * - Converts BigInt to string
 * - Normalizes numbers and primitives
 */
export function canonicalizeValue(val: unknown): unknown {
  if (val === null || typeof val !== "object") {
    if (typeof val === "bigint") {
      return (val as bigint).toString();
    }
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => canonicalizeValue(item));
  }

  const sortedObj: Record<string, unknown> = {};
  const keys = Object.keys(val as Record<string, unknown>).sort();
  for (const k of keys) {
    sortedObj[k] = canonicalizeValue((val as Record<string, unknown>)[k]);
  }
  return sortedObj;
}

/**
 * Computes deterministic SHA-256 hex string using Web Crypto API.
 */
export async function sha256Hex(data: string): Promise<string> {
  const enc = new TextEncoder();
  const bytes = enc.encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Deterministically computes a SHA-256 hash of a Groth16 proof object alone.
 */
export async function computeProofHash(proof: unknown): Promise<string> {
  const canonicalProof = canonicalizeValue(proof);
  const json = JSON.stringify(canonicalProof);
  return sha256Hex(json);
}

/**
 * Deterministically computes a SHA-256 fingerprint for a verification key.
 */
export async function computeVKeyFingerprint(vKey: unknown): Promise<string> {
  if (!vKey) return "none";
  const canonicalVKey = canonicalizeValue(vKey);
  const json = JSON.stringify(canonicalVKey);
  return sha256Hex(json);
}

/**
 * Computes a composite deterministic cache key incorporating:
 * 1. Proof hash
 * 2. Public signals (normalized to strings in order)
 * 3. Merkle root (if applicable)
 * 4. Circuit identity / name
 * 5. Verification key fingerprint
 */
export async function computeVerificationCacheKey(
  input: VerificationInput,
): Promise<{ cacheKey: string; proofHash: string; vKeyFingerprint: string }> {
  const proofHash = await computeProofHash(input.proof);

  let vKeyFingerprint = input.vKeyFingerprint || "none";
  if (!input.vKeyFingerprint && input.vKey) {
    vKeyFingerprint = await computeVKeyFingerprint(input.vKey);
  }

  const normalizedSignals = (input.publicSignals || []).map((s) =>
    typeof s === "bigint" ? s.toString() : String(s),
  );

  const payload = {
    proofHash,
    publicSignals: normalizedSignals,
    merkleRoot: input.merkleRoot ? String(input.merkleRoot) : "",
    circuitId: input.circuitId ? String(input.circuitId) : "default",
    vKeyFingerprint,
  };

  const canonicalJson = JSON.stringify(canonicalizeValue(payload));
  const cacheKey = await sha256Hex(canonicalJson);

  return { cacheKey, proofHash, vKeyFingerprint };
}

/**
 * Opens or retrieves the shared IndexedDB connection with upgrade handling.
 */
export async function getVerificationCacheDb(
  dbName = ZKP_VERIFIED_PROOFS_DB_NAME,
  storeName = ZKP_VERIFIED_PROOFS_STORE_NAME,
): Promise<IDBPDatabase<any>> {
  if (!dbInstancePromise) {
    dbInstancePromise = openDB(dbName, 1, {
      upgrade(db, oldVersion, newVersion, tx) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "cacheKey" });
          store.createIndex(ZKP_VERIFIED_PROOFS_INDEX_HASH, "proofHash", {
            unique: false,
          });
          store.createIndex("expiresAt", "expiresAt", { unique: false });
        }
      },
      blocked() {
        console.warn("[ZKP VerificationCache] Database open request blocked by older connection.");
      },
      blocking() {
        console.warn("[ZKP VerificationCache] Database upgrade blocking; closing connection.");
        if (dbInstancePromise) {
          void dbInstancePromise.then((db) => db.close()).catch(() => {});
          dbInstancePromise = null;
        }
      },
      terminated() {
        dbInstancePromise = null;
      },
    });
  }
  return dbInstancePromise;
}

/**
 * Checks IndexedDB for a previously verified proof matching the input.
 * Strict cryptographic matching:
 * - Checks cacheKey existence
 * - Checks expiration timestamp
 * - Validates stored proofHash, publicSignals, merkleRoot, circuitId, vKeyFingerprint
 */
export async function getCachedVerification(
  input: VerificationInput,
  options: VerificationCacheOptions = {},
): Promise<CacheCheckResult> {
  if (!isVerificationCacheAvailable()) {
    return { hit: false, reason: "storage_disabled" };
  }

  try {
    const { cacheKey, proofHash, vKeyFingerprint } =
      await computeVerificationCacheKey(input);

    const db = await getVerificationCacheDb(
      options.dbName,
      options.storeName,
    );
    const store = options.storeName || ZKP_VERIFIED_PROOFS_STORE_NAME;

    const entry: VerifiedProofEntry | undefined = await db.get(store, cacheKey);

    if (!entry) {
      return { hit: false, reason: "miss" };
    }

    const now = Date.now();
    if (entry.expiresAt <= now) {
      // Expired entry - asynchronously delete and treat as miss
      void db.delete(store, cacheKey).catch(() => {});
      return { hit: false, reason: "expired" };
    }

    // Cryptographic validation of stored properties
    if (entry.proofHash !== proofHash) {
      void db.delete(store, cacheKey).catch(() => {});
      return { hit: false, reason: "mismatch" };
    }

    const inputSignals = (input.publicSignals || []).map((s) =>
      typeof s === "bigint" ? s.toString() : String(s),
    );
    if (
      !Array.isArray(entry.publicSignals) ||
      entry.publicSignals.length !== inputSignals.length ||
      !entry.publicSignals.every((val, idx) => val === inputSignals[idx])
    ) {
      void db.delete(store, cacheKey).catch(() => {});
      return { hit: false, reason: "mismatch" };
    }

    if (
      input.merkleRoot &&
      entry.merkleRoot &&
      String(input.merkleRoot) !== entry.merkleRoot
    ) {
      void db.delete(store, cacheKey).catch(() => {});
      return { hit: false, reason: "mismatch" };
    }

    if (
      input.circuitId &&
      entry.circuitId &&
      input.circuitId !== entry.circuitId
    ) {
      void db.delete(store, cacheKey).catch(() => {});
      return { hit: false, reason: "mismatch" };
    }

    if (
      vKeyFingerprint !== "none" &&
      entry.vKeyFingerprint &&
      entry.vKeyFingerprint !== "none" &&
      entry.vKeyFingerprint !== vKeyFingerprint
    ) {
      void db.delete(store, cacheKey).catch(() => {});
      return { hit: false, reason: "mismatch" };
    }

    // Refresh lastAccessedAt asynchronously for LRU without blocking
    entry.lastAccessedAt = now;
    void db.put(store, entry).catch(() => {});

    return { hit: true, entry };
  } catch (err) {
    // Treat any error as a cache miss to safely fallback to cryptographic verification
    return { hit: false, reason: "error" };
  }
}

/**
 * Stores a successfully verified proof in IndexedDB.
 * Enforces TTL, maximum storage bounds, and LRU eviction.
 */
export async function cacheVerifiedProof(
  input: VerificationInput,
  options: VerificationCacheOptions = {},
): Promise<boolean> {
  if (!isVerificationCacheAvailable()) return false;

  try {
    const { cacheKey, proofHash, vKeyFingerprint } =
      await computeVerificationCacheKey(input);

    const db = await getVerificationCacheDb(
      options.dbName,
      options.storeName,
    );
    const storeName = options.storeName || ZKP_VERIFIED_PROOFS_STORE_NAME;
    const ttlMs = options.ttlMs ?? DEFAULT_VERIFICATION_TTL_MS;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_VERIFIED_ENTRIES;
    const now = Date.now();

    const normalizedSignals = (input.publicSignals || []).map((s) =>
      typeof s === "bigint" ? s.toString() : String(s),
    );

    const entry: VerifiedProofEntry = {
      cacheKey,
      proofHash,
      publicSignals: normalizedSignals,
      merkleRoot: input.merkleRoot ? String(input.merkleRoot) : undefined,
      circuitId: input.circuitId || options.circuitId || "default",
      vKeyFingerprint,
      verifiedAt: now,
      expiresAt: now + ttlMs,
      lastAccessedAt: now,
    };

    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);

    // Eviction and bound enforcement:
    const allEntries: VerifiedProofEntry[] = await store.getAll();

    // 1. Evict expired entries
    for (const e of allEntries) {
      if (e.expiresAt <= now) {
        await store.delete(e.cacheKey);
      }
    }

    const liveEntries = allEntries.filter((e) => e.expiresAt > now);

    // 2. If capacity exceeded, evict least recently used/verified
    if (liveEntries.length >= maxEntries) {
      // Sort ascending by lastAccessedAt
      const sorted = liveEntries
        .filter((e) => e.cacheKey !== cacheKey)
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

      const itemsToRemove = liveEntries.length - maxEntries + 1;
      for (let i = 0; i < itemsToRemove && i < sorted.length; i++) {
        await store.delete(sorted[i].cacheKey);
      }
    }

    await store.put(entry);
    await tx.done;

    // Trigger scheduled background idle cleanup
    scheduleIdleCleanup(options);

    return true;
  } catch (err) {
    // Quota or storage write failure: best effort, never fail verification
    return false;
  }
}

/**
 * Purges expired verification records from IndexedDB.
 */
export async function purgeExpiredVerifications(
  options: VerificationCacheOptions = {},
): Promise<number> {
  if (!isVerificationCacheAvailable()) return 0;
  try {
    const db = await getVerificationCacheDb(
      options.dbName,
      options.storeName,
    );
    const storeName = options.storeName || ZKP_VERIFIED_PROOFS_STORE_NAME;
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const allEntries: VerifiedProofEntry[] = await store.getAll();
    const now = Date.now();
    let deletedCount = 0;

    for (const entry of allEntries) {
      if (entry.expiresAt <= now) {
        await store.delete(entry.cacheKey);
        deletedCount++;
      }
    }
    await tx.done;
    return deletedCount;
  } catch {
    return 0;
  }
}

/**
 * Schedules background cleanup during idle period or via setTimeout fallback.
 */
export function scheduleIdleCleanup(options: VerificationCacheOptions = {}): void {
  if (scheduledCleanupTimeout) return;

  const runCleanup = () => {
    scheduledCleanupTimeout = null;
    void purgeExpiredVerifications(options).catch(() => {});
  };

  if (
    typeof window !== "undefined" &&
    typeof (window as any).requestIdleCallback === "function"
  ) {
    (window as any).requestIdleCallback(runCleanup, { timeout: 5000 });
  } else {
    scheduledCleanupTimeout = setTimeout(runCleanup, 3000);
  }
}

/**
 * Clears the verification cache completely.
 */
export async function clearVerificationCache(
  options: VerificationCacheOptions = {},
): Promise<void> {
  if (!isVerificationCacheAvailable()) return;
  try {
    const db = await getVerificationCacheDb(
      options.dbName,
      options.storeName,
    );
    const storeName = options.storeName || ZKP_VERIFIED_PROOFS_STORE_NAME;
    await db.clear(storeName);
  } catch {
    // ignore
  }
}

/**
 * Closes the active database connection and resets internal cache state.
 * For test teardown and connection cleanup.
 */
export async function _resetVerificationCacheForTesting(): Promise<void> {
  if (scheduledCleanupTimeout) {
    clearTimeout(scheduledCleanupTimeout);
    scheduledCleanupTimeout = null;
  }
  if (dbInstancePromise) {
    try {
      const db = await dbInstancePromise;
      db.close();
    } catch {
      // ignore
    }
    dbInstancePromise = null;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible exports from previous proofCache.ts (for existing callers)
// ---------------------------------------------------------------------------
export {
  getCachedProof,
  storeProof,
  invalidateProof,
  purgeExpiredProofs,
  clearProofCache,
  getOrCreateProof,
  isProofCacheAvailable,
  serializeBigInts,
  safeJsonStringify,
  sanitizeProofForStorage,
  calculateProofEntryBytes,
  getCircuitEpoch,
  _resetProofCacheForTesting,
  type CachedProof,
  type ProofCacheEntry,
  type ProofSource,
  type ProofCacheOptions,
  DEFAULT_FRESH_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_CACHE_BYTES,
} from "./proofCacheLegacy";
