/**
 * SpotPricingAuctioneer.ts
 * Dynamic multi-tier spot instance pricing auctioneer and preemption coordinator.
 * Implements market-clearing equilibrium pricing, uniform-price auctions,
 * exponential volatility dampening with circuit breakers, and tiered preemption signaling.
 */

export type ResourceTier = 'BASIC_DESK' | 'FOCUS_POD' | 'GPU_EDGE_NODE' | 'CONFERENCE_SUITE';

export type InterruptionTolerance = 'PREEMPTIBLE' | 'CHECKPOINTABLE' | 'NON_PREEMPTIBLE';

export type BidAllocationStatus =
  | 'PENDING'
  | 'ALLOCATED'
  | 'PREEMPTION_WARNING'
  | 'EVICTED'
  | 'TERMINATED';

export interface SpotPool {
  poolId: string;
  resourceTier: ResourceTier;
  totalCapacityUnits: number;
  allocatedUnits: number;
  reservePriceFloor: number;
  ceilingPrice: number;
  currentSpotPrice: number;
  volatilityExponent: number; // gamma >= 1.0
  smoothingFactorAlpha: number; // 0 < alpha <= 1.0 (EMA)
  lastPriceUpdateTimestamp: number;
}

export interface SpotBid {
  bidId: string;
  bidderId: string;
  poolId: string;
  maxBidPrice: number;
  requestedUnits: number;
  tolerance: InterruptionTolerance;
  timestamp: number;
  allocationStatus: BidAllocationStatus;
  preemptionWarningTimestamp?: number;
}

export interface AllocationRecord {
  bidId: string;
  bidderId: string;
  poolId: string;
  units: number;
  effectivePrice: number;
  allocatedAt: number;
}

export interface MarketRebalanceResult {
  poolId: string;
  clearingPrice: number;
  preemptedBidIds: string[];
  evictedBidIds: string[];
  allocatedBidIds: string[];
  totalAllocatedUnits: number;
  utilizationRatio: number;
}

export class SpotPricingAuctioneer {
  private pools = new Map<string, SpotPool>();
  private bids = new Map<string, SpotBid>();
  private preemptionGracePeriodMs: number;
  private maxPriceVolatilitySwingRatio: number; // Circuit breaker limit, e.g. 0.50 (50%)

  constructor(options?: {
    preemptionGracePeriodMs?: number;
    maxPriceVolatilitySwingRatio?: number;
  }) {
    this.preemptionGracePeriodMs = options?.preemptionGracePeriodMs ?? 120000; // 2 minutes grace
    this.maxPriceVolatilitySwingRatio = options?.maxPriceVolatilitySwingRatio ?? 0.5; // Max 50% jump per step
  }

  public createPool(
    poolConfig: Omit<SpotPool, 'allocatedUnits' | 'currentSpotPrice' | 'lastPriceUpdateTimestamp'>
  ): SpotPool {
    const now = Date.now();
    const pool: SpotPool = {
      ...poolConfig,
      allocatedUnits: 0,
      currentSpotPrice: poolConfig.reservePriceFloor,
      lastPriceUpdateTimestamp: now,
      volatilityExponent: poolConfig.volatilityExponent ?? 1.8,
      smoothingFactorAlpha: poolConfig.smoothingFactorAlpha ?? 0.35,
    };

    this.pools.set(pool.poolId, pool);
    return { ...pool };
  }

  public getPool(poolId: string): SpotPool | undefined {
    const p = this.pools.get(poolId);
    return p ? { ...p } : undefined;
  }

  public getBid(bidId: string): SpotBid | undefined {
    const b = this.bids.get(bidId);
    return b ? { ...b } : undefined;
  }

  public getAllPools(): SpotPool[] {
    return Array.from(this.pools.values()).map((p) => ({ ...p }));
  }

  /**
   * Submits a spot resource bid into the auction engine
   */
  public submitBid(
    bidInput: Omit<SpotBid, 'allocationStatus' | 'timestamp'>,
    currentTime: number = Date.now()
  ): {
    accepted: boolean;
    bidId: string;
    status: BidAllocationStatus;
    currentSpotPrice: number;
    message: string;
  } {
    const pool = this.pools.get(bidInput.poolId);
    if (!pool) {
      throw new Error(`Spot pool ${bidInput.poolId} not found`);
    }

    if (bidInput.requestedUnits <= 0) {
      throw new Error('Requested units must be positive');
    }

    if (bidInput.maxBidPrice < pool.reservePriceFloor) {
      return {
        accepted: false,
        bidId: bidInput.bidId,
        status: 'TERMINATED',
        currentSpotPrice: pool.currentSpotPrice,
        message: `Bid price ${bidInput.maxBidPrice} is below statutory reserve floor ${pool.reservePriceFloor}`,
      };
    }

    const bid: SpotBid = {
      ...bidInput,
      timestamp: currentTime,
      allocationStatus: 'PENDING',
    };

    this.bids.set(bid.bidId, bid);

    // Trigger immediate market clearing rebalance
    this.rebalanceMarket(pool.poolId, currentTime);

    const updatedBid = this.bids.get(bid.bidId)!;
    const isAllocated = updatedBid.allocationStatus === 'ALLOCATED';

    return {
      accepted: isAllocated,
      bidId: bid.bidId,
      status: updatedBid.allocationStatus,
      currentSpotPrice: pool.currentSpotPrice,
      message: isAllocated
        ? `Allocated ${bid.requestedUnits} units at uniform clearing rate ${pool.currentSpotPrice}`
        : `Bid queued as PENDING or unable to secure capacity at current spot rate ${pool.currentSpotPrice}`,
    };
  }

  /**
   * Releases an allocated bid and triggers market price recalibration
   */
  public releaseAllocation(bidId: string, currentTime: number = Date.now()): boolean {
    const bid = this.bids.get(bidId);
    if (!bid) return false;

    bid.allocationStatus = 'TERMINATED';
    this.rebalanceMarket(bid.poolId, currentTime);
    return true;
  }

  /**
   * Rebalances market clearing price, admits bids, and handles preemption
   */
  public rebalanceMarket(poolId: string, currentTime: number = Date.now()): MarketRebalanceResult {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Spot pool ${poolId} not found`);
    }

    const poolBids = Array.from(this.bids.values()).filter(
      (b) => b.poolId === poolId && b.allocationStatus !== 'TERMINATED' && b.allocationStatus !== 'EVICTED'
    );

    // 1. Sort active bids by price descending (priority: NON_PREEMPTIBLE > CHECKPOINTABLE > PREEMPTIBLE on tie)
    const tolerancePriority: Record<InterruptionTolerance, number> = {
      NON_PREEMPTIBLE: 3,
      CHECKPOINTABLE: 2,
      PREEMPTIBLE: 1,
    };

    poolBids.sort((a, b) => {
      if (b.maxBidPrice !== a.maxBidPrice) {
        return b.maxBidPrice - a.maxBidPrice;
      }
      const tolDiff = tolerancePriority[b.tolerance] - tolerancePriority[a.tolerance];
      if (tolDiff !== 0) return tolDiff;
      return a.timestamp - b.timestamp; // FIFO on equal bids
    });

    // 2. Calculate aggregate demand
    const aggregateDemandUnits = poolBids.reduce((acc, b) => acc + b.requestedUnits, 0);
    const demandRatio = pool.totalCapacityUnits > 0
      ? aggregateDemandUnits / pool.totalCapacityUnits
      : 1.0;

    // 3. Compute raw clearing price: stays near floor when capacity is abundant (<= 80%),
    // and surges non-linearly when demand reaches or exceeds capacity (congestion pricing).
    const priceDelta = pool.ceilingPrice - pool.reservePriceFloor;
    let rawPrice = pool.reservePriceFloor;
    if (demandRatio > 0.8) {
      const congestionFactor = (demandRatio - 0.8) / 0.2;
      rawPrice = pool.reservePriceFloor + priceDelta * Math.pow(Math.min(2.0, congestionFactor), pool.volatilityExponent);
    }

    // 4. Apply Circuit Breaker to prevent runaway flash volatility
    const maxAllowedIncrease = pool.currentSpotPrice * (1.0 + this.maxPriceVolatilitySwingRatio);
    const maxAllowedDecrease = pool.currentSpotPrice * (1.0 - this.maxPriceVolatilitySwingRatio);
    let constrainedRawPrice = Math.max(pool.reservePriceFloor, Math.min(pool.ceilingPrice, rawPrice));

    if (pool.allocatedUnits > 0) {
      constrainedRawPrice = Math.min(maxAllowedIncrease, Math.max(maxAllowedDecrease, constrainedRawPrice));
    }

    // 5. Exponential Moving Average (EMA) smoothing: P(t) = alpha * raw + (1 - alpha) * P(t-1)
    const smoothedPrice =
      pool.smoothingFactorAlpha * constrainedRawPrice +
      (1.0 - pool.smoothingFactorAlpha) * pool.currentSpotPrice;

    pool.currentSpotPrice = parseFloat(smoothedPrice.toFixed(2));
    pool.lastPriceUpdateTimestamp = currentTime;

    // 6. Allocate capacity up to totalCapacityUnits to bids that satisfy bid.maxBidPrice >= currentSpotPrice
    let remainingCapacity = pool.totalCapacityUnits;
    const allocatedBidIds: string[] = [];
    const preemptedBidIds: string[] = [];
    const evictedBidIds: string[] = [];
    let newlyAllocatedUnits = 0;

    for (const bid of poolBids) {
      const canAfford = bid.maxBidPrice >= pool.currentSpotPrice;
      const capacityAvailable = remainingCapacity >= bid.requestedUnits;

      if (canAfford && capacityAvailable) {
        // Can be comfortably allocated
        remainingCapacity -= bid.requestedUnits;
        newlyAllocatedUnits += bid.requestedUnits;
        bid.allocationStatus = 'ALLOCATED';
        bid.preemptionWarningTimestamp = undefined;
        allocatedBidIds.push(bid.bidId);
      } else if (bid.allocationStatus === 'ALLOCATED' || bid.allocationStatus === 'PREEMPTION_WARNING') {
        // Was previously allocated, but now underfunded or capacity squeezed!
        if (bid.tolerance === 'NON_PREEMPTIBLE' && remainingCapacity >= bid.requestedUnits) {
          // Shield non-preemptible workloads
          remainingCapacity -= bid.requestedUnits;
          newlyAllocatedUnits += bid.requestedUnits;
          allocatedBidIds.push(bid.bidId);
          continue;
        }

        // Issue preemption warning or execute eviction
        if (!bid.preemptionWarningTimestamp) {
          bid.preemptionWarningTimestamp = currentTime;
          bid.allocationStatus = 'PREEMPTION_WARNING';
          preemptedBidIds.push(bid.bidId);
        } else if (currentTime - bid.preemptionWarningTimestamp >= this.preemptionGracePeriodMs) {
          // Grace period elapsed -> Evict!
          bid.allocationStatus = 'EVICTED';
          evictedBidIds.push(bid.bidId);
        } else {
          // Still in warning grace window
          preemptedBidIds.push(bid.bidId);
        }
      } else {
        // New or pending bid unable to acquire capacity
        bid.allocationStatus = 'PENDING';
      }
    }

    pool.allocatedUnits = newlyAllocatedUnits;

    return {
      poolId: pool.poolId,
      clearingPrice: pool.currentSpotPrice,
      preemptedBidIds,
      evictedBidIds,
      allocatedBidIds,
      totalAllocatedUnits: pool.allocatedUnits,
      utilizationRatio: parseFloat((pool.allocatedUnits / Math.max(1, pool.totalCapacityUnits)).toFixed(3)),
    };
  }

  /**
   * Retrieves active running allocations paying the uniform spot price
   */
  public getActiveAllocations(poolId: string): AllocationRecord[] {
    const pool = this.pools.get(poolId);
    if (!pool) return [];

    return Array.from(this.bids.values())
      .filter((b) => b.poolId === poolId && (b.allocationStatus === 'ALLOCATED' || b.allocationStatus === 'PREEMPTION_WARNING'))
      .map((b) => ({
        bidId: b.bidId,
        bidderId: b.bidderId,
        poolId: b.poolId,
        units: b.requestedUnits,
        effectivePrice: pool.currentSpotPrice,
        allocatedAt: b.timestamp,
      }));
  }
}
