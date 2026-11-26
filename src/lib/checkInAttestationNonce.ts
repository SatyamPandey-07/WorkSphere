/**
 * Batch Check-in Attestation Nonce Manager & Replay Protection
 *
 * Implements replay protection for batch check-in attestation nonces
 * with a configurable time-to-live (TTL) window to accommodate
 * venue clock-skew tolerances.
 *
 * (Issue #10609)
 */

export const DEFAULT_BATCH_ATTESTATION_NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes (default safe window)
export const MIN_BATCH_ATTESTATION_NONCE_TTL_MS = 1_000; // 1 second
export const MAX_BATCH_ATTESTATION_NONCE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (maximum safe window)

export interface BatchAttestationNonceConfig {
  /**
   * Replay window time-to-live in milliseconds.
   * Nonces older than this window are considered expired and ineligible for replay protection checks.
   */
  replayWindowTtlMs?: number;
}

export interface ConsumedBatchNonceEntry {
  nonce: string;
  consumedAt: number;
  venueId?: string;
  userId?: string;
  idempotencyKey?: string;
  expiresAt: number;
}

export type NonceVerificationResult =
  | {
      status: "ACCEPTED";
      nonce: string;
      consumedAt: number;
      expiresAt: number;
    }
  | {
      status: "REPLAYED";
      nonce: string;
      consumedAt: number;
      expiresAt: number;
      reason: "NONCE_ALREADY_CONSUMED";
    }
  | {
      status: "EXPIRED";
      nonce: string;
      consumedAt: number;
      reason: "NONCE_EXPIRED";
    };

/**
 * Validates that the provided replay window TTL is a positive integer bounded by safe limits.
 *
 * Throws a TypeError or RangeError if the value is invalid.
 */
export function validateReplayWindowTtl(ttlMs: number | undefined | null): number {
  if (ttlMs === undefined || ttlMs === null) {
    return DEFAULT_BATCH_ATTESTATION_NONCE_TTL_MS;
  }

  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) {
    throw new TypeError(`Replay window TTL must be a finite number. Received: ${String(ttlMs)}`);
  }

  if (!Number.isInteger(ttlMs)) {
    throw new TypeError(`Replay window TTL must be an integer. Received: ${ttlMs}`);
  }

  if (ttlMs < MIN_BATCH_ATTESTATION_NONCE_TTL_MS) {
    throw new RangeError(
      `Replay window TTL must be at least ${MIN_BATCH_ATTESTATION_NONCE_TTL_MS}ms. Received: ${ttlMs}ms`
    );
  }

  if (ttlMs > MAX_BATCH_ATTESTATION_NONCE_TTL_MS) {
    throw new RangeError(
      `Replay window TTL cannot exceed ${MAX_BATCH_ATTESTATION_NONCE_TTL_MS}ms (24h). Received: ${ttlMs}ms`
    );
  }

  return ttlMs;
}

export class BatchAttestationNonceManager {
  private replayWindowTtlMs: number;
  private readonly nonces = new Map<string, ConsumedBatchNonceEntry>();

  constructor(config?: BatchAttestationNonceConfig) {
    this.replayWindowTtlMs = validateReplayWindowTtl(config?.replayWindowTtlMs);
  }

  /**
   * Returns the currently configured replay window TTL in milliseconds.
   */
  public getReplayWindowTtl(): number {
    return this.replayWindowTtlMs;
  }

  /**
   * Updates the replay window TTL, strictly validating positive and upper bounds.
   */
  public setReplayWindowTtl(ttlMs: number): void {
    this.replayWindowTtlMs = validateReplayWindowTtl(ttlMs);
  }

  /**
   * Builds the lookup key for the given nonce, scoping by venueId if provided.
   */
  private buildNonceKey(nonce: string, venueId?: string): string {
    return venueId ? `${venueId}:${nonce}` : nonce;
  }

  /**
   * Prunes all nonces whose active replay window has expired relative to `nowMs`.
   */
  public pruneExpired(nowMs: number = Date.now()): number {
    let prunedCount = 0;
    for (const [key, entry] of this.nonces.entries()) {
      if (nowMs >= entry.expiresAt) {
        this.nonces.delete(key);
        prunedCount++;
      }
    }
    return prunedCount;
  }

  /**
   * Checks whether a nonce is currently active in the replay protection window.
   * If the nonce existed but its replay window has expired, it is no longer considered active.
   */
  public isNonceActive(
    nonce: string,
    venueId?: string,
    nowMs: number = Date.now()
  ): boolean {
    const key = this.buildNonceKey(nonce, venueId);
    const existing = this.nonces.get(key);
    if (!existing) {
      return false;
    }

    if (nowMs >= existing.expiresAt) {
      // Lazy cleanup of expired entry
      this.nonces.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Consumes an attestation nonce and records it in the active replay protection window.
   *
   * If the nonce has already been consumed and its window is still active, rejects with `status: "REPLAYED"`.
   * If the nonce was previously consumed but has expired, it is treated as expired / clean and re-accepted.
   */
  public consumeNonce(
    nonce: string,
    options?: {
      venueId?: string;
      userId?: string;
      idempotencyKey?: string;
      nowMs?: number;
      customTtlMs?: number;
    }
  ): NonceVerificationResult {
    const cleanNonce = String(nonce ?? "").trim();
    if (!cleanNonce) {
      throw new Error("Nonce must not be empty");
    }

    const now = options?.nowMs ?? Date.now();
    const effectiveTtl = options?.customTtlMs !== undefined
      ? validateReplayWindowTtl(options.customTtlMs)
      : this.replayWindowTtlMs;

    const key = this.buildNonceKey(cleanNonce, options?.venueId);
    const existing = this.nonces.get(key);

    if (existing) {
      if (now < existing.expiresAt) {
        // Nonce is active: replay detected!
        return {
          status: "REPLAYED",
          nonce: cleanNonce,
          consumedAt: existing.consumedAt,
          expiresAt: existing.expiresAt,
          reason: "NONCE_ALREADY_CONSUMED",
        };
      }
      // Nonce expired; remove stale entry
      this.nonces.delete(key);
    }

    const expiresAt = now + effectiveTtl;
    const entry: ConsumedBatchNonceEntry = {
      nonce: cleanNonce,
      consumedAt: now,
      expiresAt,
      venueId: options?.venueId,
      userId: options?.userId,
      idempotencyKey: options?.idempotencyKey,
    };

    this.nonces.set(key, entry);

    return {
      status: "ACCEPTED",
      nonce: cleanNonce,
      consumedAt: now,
      expiresAt,
    };
  }

  /**
   * Clears all stored nonces (used for test isolation).
   */
  public clear(): void {
    this.nonces.clear();
  }

  /**
   * Returns current count of stored nonces (including potentially un-pruned ones).
   */
  public size(): number {
    return this.nonces.size;
  }
}

// Global default singleton instance for batch check-in attestation nonce validation
let globalNonceManager: BatchAttestationNonceManager | null = null;

export function getBatchAttestationNonceManager(): BatchAttestationNonceManager {
  if (!globalNonceManager) {
    globalNonceManager = new BatchAttestationNonceManager();
  }
  return globalNonceManager;
}

export function resetBatchAttestationNonceManager(
  config?: BatchAttestationNonceConfig
): BatchAttestationNonceManager {
  globalNonceManager = new BatchAttestationNonceManager(config);
  return globalNonceManager;
}
