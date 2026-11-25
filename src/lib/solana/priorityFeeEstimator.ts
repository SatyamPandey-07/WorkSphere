/**
 * Dynamic Priority Fee Estimation for Solana Escrow Transactions (#7848).
 *
 * Implements 75th-percentile prioritization fee estimation using
 * `connection.getRecentPrioritizationFees(...)`, safe clamping bounds,
 * fallback fees, and a short-lived cache to avoid redundant RPC queries.
 */

import { Connection, PublicKey } from "@solana/web3.js";

export const DEFAULT_PRIORITY_FEE_PERCENTILE = 75;
export const DEFAULT_MIN_PRIORITY_FEE_MICRO_LAMPORTS = 1_000;
export const DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS = 1_000_000;
export const DEFAULT_FALLBACK_PRIORITY_FEE_MICRO_LAMPORTS = 5_000;
export const DEFAULT_PRIORITY_FEE_CACHE_TTL_MS = 10_000;
export const DEFAULT_PRIORITY_FEE_SLOT_WINDOW = 150;

export interface PriorityFeeConfig {
  /** Target percentile to extract from sorted fee samples (default: 75). */
  percentile?: number;
  /** Minimum fee bound in micro-lamports (default: 1,000). */
  minMicroLamports?: number;
  /** Maximum fee bound in micro-lamports (default: 1,000,000). */
  maxMicroLamports?: number;
  /** Default fallback fee in micro-lamports when RPC has no usable samples (default: 5,000). */
  fallbackMicroLamports?: number;
  /** In-memory cache duration in milliseconds (default: 10,000ms). 0 disables caching. */
  cacheDurationMs?: number;
  /** Maximum recent slot samples to consider for estimation (default: 150). */
  slotWindow?: number;
}

export type PriorityFeeSource = "rpc" | "cache" | "fallback";

export interface PriorityFeeEstimate {
  microLamports: number;
  percentile: number;
  sampleCount: number;
  source: PriorityFeeSource;
  timestamp: number;
}

interface CacheEntry {
  estimate: PriorityFeeEstimate;
  fetchedAt: number;
}

export class PriorityFeeEstimator {
  private readonly config: Required<PriorityFeeConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  private pendingRequests: Map<string, Promise<PriorityFeeEstimate>> = new Map();

  constructor(config: PriorityFeeConfig = {}) {
    const min =
      typeof config.minMicroLamports === "number" && !isNaN(config.minMicroLamports)
        ? Math.max(0, Math.floor(config.minMicroLamports))
        : DEFAULT_MIN_PRIORITY_FEE_MICRO_LAMPORTS;

    const max =
      typeof config.maxMicroLamports === "number" && !isNaN(config.maxMicroLamports)
        ? Math.max(min, Math.floor(config.maxMicroLamports))
        : DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS;

    const fallback =
      typeof config.fallbackMicroLamports === "number" && !isNaN(config.fallbackMicroLamports)
        ? Math.max(min, Math.min(max, Math.floor(config.fallbackMicroLamports)))
        : Math.max(min, Math.min(max, DEFAULT_FALLBACK_PRIORITY_FEE_MICRO_LAMPORTS));

    const percentile =
      typeof config.percentile === "number" && !isNaN(config.percentile)
        ? Math.max(0, Math.min(100, config.percentile))
        : DEFAULT_PRIORITY_FEE_PERCENTILE;

    const cacheDurationMs =
      typeof config.cacheDurationMs === "number" && !isNaN(config.cacheDurationMs)
        ? Math.max(0, config.cacheDurationMs)
        : DEFAULT_PRIORITY_FEE_CACHE_TTL_MS;

    const slotWindow =
      typeof config.slotWindow === "number" && !isNaN(config.slotWindow)
        ? Math.max(1, Math.floor(config.slotWindow))
        : DEFAULT_PRIORITY_FEE_SLOT_WINDOW;

    this.config = {
      percentile,
      minMicroLamports: min,
      maxMicroLamports: max,
      fallbackMicroLamports: fallback,
      cacheDurationMs,
      slotWindow,
    };
  }

  public getConfig(): Required<PriorityFeeConfig> {
    return { ...this.config };
  }

  public clearCache(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Calculates the specified percentile value from a collection of prioritization fee entries.
   * Method:
   * 1. Filters non-numeric, NaN, infinite, or negative values.
   * 2. Sorts valid values ascending.
   * 3. Calculates 1-based nearest-rank percentile: index = ceil((p / 100) * N) - 1.
   */
  public calculatePercentile(
    fees: Array<number | { prioritizationFee: number }>,
    targetPercentile: number = this.config.percentile,
  ): { value: number; sampleCount: number } {
    if (!fees || !Array.isArray(fees) || fees.length === 0) {
      return { value: 0, sampleCount: 0 };
    }

    const validFees: number[] = [];
    for (const item of fees) {
      const raw = typeof item === "number" ? item : item?.prioritizationFee;
      if (typeof raw === "number" && Number.isFinite(raw) && !isNaN(raw) && raw >= 0) {
        validFees.push(Math.floor(raw));
      }
    }

    if (validFees.length === 0) {
      return { value: 0, sampleCount: 0 };
    }

    validFees.sort((a, b) => a - b);

    const p = Math.max(0, Math.min(100, targetPercentile));
    if (p === 0) {
      return { value: validFees[0], sampleCount: validFees.length };
    }
    if (p === 100) {
      return { value: validFees[validFees.length - 1], sampleCount: validFees.length };
    }

    // Nearest rank index (0-indexed)
    const rankIndex = Math.max(
      0,
      Math.min(validFees.length - 1, Math.ceil((p / 100) * validFees.length) - 1),
    );

    return { value: validFees[rankIndex], sampleCount: validFees.length };
  }

  /**
   * Clamps a raw priority fee within the configured min and max micro-lamport bounds.
   */
  public clamp(fee: number): number {
    if (!Number.isFinite(fee) || isNaN(fee) || fee < this.config.minMicroLamports) {
      return this.config.minMicroLamports;
    }
    if (fee > this.config.maxMicroLamports) {
      return this.config.maxMicroLamports;
    }
    return Math.floor(fee);
  }

  /**
   * Fetches or computes a dynamic priority fee estimate for the given connection and accounts.
   */
  public async estimatePriorityFee(
    connection: Connection,
    accounts?: Array<PublicKey | string>,
    options?: Partial<PriorityFeeConfig>,
  ): Promise<PriorityFeeEstimate> {
    const min = options?.minMicroLamports ?? this.config.minMicroLamports;
    const max = options?.maxMicroLamports ?? this.config.maxMicroLamports;
    const fallback = options?.fallbackMicroLamports ?? this.config.fallbackMicroLamports;
    const percentile = options?.percentile ?? this.config.percentile;
    const ttlMs = options?.cacheDurationMs ?? this.config.cacheDurationMs;
    const slotWindow = options?.slotWindow ?? this.config.slotWindow;

    const cacheKey = this.getCacheKey(connection, accounts);
    const now = Date.now();

    // Check cache
    if (ttlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && now - cached.fetchedAt < ttlMs) {
        return {
          ...cached.estimate,
          source: "cache",
        };
      }
    }

    // Coalesce in-flight requests for the same cache key
    const inFlight = this.pendingRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = (async (): Promise<PriorityFeeEstimate> => {
      try {
        let lockedAccounts: PublicKey[] | undefined;
        if (accounts && accounts.length > 0) {
          lockedAccounts = accounts.map((acc) =>
            typeof acc === "string" ? new PublicKey(acc) : acc,
          );
        }

        const rawSamples = await connection.getRecentPrioritizationFees(
          lockedAccounts && lockedAccounts.length > 0
            ? { lockedWritableAccounts: lockedAccounts }
            : undefined,
        );

        // Filter and limit to the most recent slot window (default: 150 slots)
        let sampledFees = rawSamples;
        if (Array.isArray(rawSamples) && rawSamples.length > 0) {
          // If samples carry slot numbers, sort descending by slot to get the latest slots
          const hasSlotInfo = rawSamples.some(
            (s) =>
              typeof s === "object" &&
              s !== null &&
              typeof (s as any).slot === "number",
          );
          if (hasSlotInfo) {
            const sortedBySlot = [...rawSamples].sort(
              (a: any, b: any) => (b.slot ?? 0) - (a.slot ?? 0),
            );
            sampledFees = sortedBySlot.slice(0, slotWindow);
          } else {
            sampledFees = rawSamples.slice(-slotWindow);
          }
        }

        const { value, sampleCount } = this.calculatePercentile(sampledFees, percentile);

        if (sampleCount === 0 || value === 0) {
          // Use safe fallback when RPC returns empty or all-zero
          const clampedFallback = Math.max(min, Math.min(max, fallback));
          const result: PriorityFeeEstimate = {
            microLamports: clampedFallback,
            percentile,
            sampleCount,
            source: "fallback",
            timestamp: Date.now(),
          };
          this.setCache(cacheKey, result);
          return result;
        }

        const clampedFee = Math.max(min, Math.min(max, Math.floor(value)));
        const result: PriorityFeeEstimate = {
          microLamports: clampedFee,
          percentile,
          sampleCount,
          source: "rpc",
          timestamp: Date.now(),
        };
        this.setCache(cacheKey, result);
        return result;
      } catch (err) {
        console.warn(
          "[PriorityFeeEstimator] Failed to fetch recent prioritization fees from RPC, using fallback:",
          err,
        );
        const clampedFallback = Math.max(min, Math.min(max, fallback));
        const result: PriorityFeeEstimate = {
          microLamports: clampedFallback,
          percentile,
          sampleCount: 0,
          source: "fallback",
          timestamp: Date.now(),
        };
        // Don't cache hard failures for full TTL; cache briefly (1s) to prevent spamming
        this.setCache(cacheKey, result, Math.min(1000, ttlMs));
        return result;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  private setCache(key: string, estimate: PriorityFeeEstimate, customTtl?: number): void {
    const ttl = customTtl ?? this.config.cacheDurationMs;
    if (ttl > 0) {
      this.cache.set(key, {
        estimate,
        fetchedAt: Date.now(),
      });
    }
  }

  private getCacheKey(
    connection: Connection,
    accounts?: Array<PublicKey | string>,
  ): string {
    const endpoint = (connection as any)?.rpcEndpoint || (connection as any)?._rpcEndpoint || "default";
    if (!accounts || accounts.length === 0) {
      return `${endpoint}:global`;
    }
    const accKeys = accounts
      .map((acc) => (typeof acc === "string" ? acc : acc.toBase58()))
      .sort()
      .join(",");
    return `${endpoint}:${accKeys}`;
  }
}

// Global default singleton instance
let defaultEstimator: PriorityFeeEstimator | null = null;

export function getPriorityFeeEstimator(
  config?: PriorityFeeConfig,
): PriorityFeeEstimator {
  if (!defaultEstimator || config) {
    defaultEstimator = new PriorityFeeEstimator(config);
  }
  return defaultEstimator;
}

export function resetPriorityFeeEstimator(): void {
  defaultEstimator = null;
}
