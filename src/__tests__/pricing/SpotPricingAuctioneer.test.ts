import {
  SpotPricingAuctioneer,
  SpotPool,
  SpotBid,
} from '../../core/pricing/SpotPricingAuctioneer';

describe('SpotPricingAuctioneer', () => {
  let auctioneer: SpotPricingAuctioneer;

  const poolConfig = {
    poolId: 'pool-gpu-1',
    resourceTier: 'GPU_EDGE_NODE' as const,
    totalCapacityUnits: 10,
    reservePriceFloor: 5.0,
    ceilingPrice: 50.0,
    volatilityExponent: 1.5,
    smoothingFactorAlpha: 0.5,
  };

  beforeEach(() => {
    auctioneer = new SpotPricingAuctioneer({
      preemptionGracePeriodMs: 60000, // 60s grace
      maxPriceVolatilitySwingRatio: 0.5,
    });
    auctioneer.createPool(poolConfig);
  });

  describe('Pool Creation & Bid Admission', () => {
    it('creates pool with reserve price floor as starting spot rate', () => {
      const pool = auctioneer.getPool('pool-gpu-1');
      expect(pool).toBeDefined();
      expect(pool?.currentSpotPrice).toBe(5.0);
      expect(pool?.allocatedUnits).toBe(0);
    });

    it('rejects bids submitted below reserve floor price', () => {
      const result = auctioneer.submitBid({
        bidId: 'bid-low-1',
        bidderId: 'user-cheap',
        poolId: 'pool-gpu-1',
        maxBidPrice: 3.5, // Below 5.0
        requestedUnits: 2,
        tolerance: 'PREEMPTIBLE',
      });

      expect(result.accepted).toBe(false);
      expect(result.status).toBe('TERMINATED');
      expect(result.message).toContain('below statutory reserve floor');
    });

    it('admits and allocates valid bids when capacity is open', () => {
      const result = auctioneer.submitBid({
        bidId: 'bid-valid-1',
        bidderId: 'user-alice',
        poolId: 'pool-gpu-1',
        maxBidPrice: 15.0,
        requestedUnits: 4,
        tolerance: 'CHECKPOINTABLE',
      });

      expect(result.accepted).toBe(true);
      expect(result.status).toBe('ALLOCATED');

      const pool = auctioneer.getPool('pool-gpu-1');
      expect(pool?.allocatedUnits).toBe(4);
    });
  });

  describe('Uniform Pricing & Market Equilibrium', () => {
    it('enforces uniform pricing across all active allocations', () => {
      auctioneer.submitBid({
        bidId: 'bid-1',
        bidderId: 'user-1',
        poolId: 'pool-gpu-1',
        maxBidPrice: 20.0,
        requestedUnits: 3,
        tolerance: 'PREEMPTIBLE',
      });

      auctioneer.submitBid({
        bidId: 'bid-2',
        bidderId: 'user-2',
        poolId: 'pool-gpu-1',
        maxBidPrice: 35.0,
        requestedUnits: 3,
        tolerance: 'NON_PREEMPTIBLE',
      });

      const allocations = auctioneer.getActiveAllocations('pool-gpu-1');
      expect(allocations.length).toBe(2);

      // Both allocations must pay the identical current market clearing price
      const pool = auctioneer.getPool('pool-gpu-1');
      expect(allocations[0].effectivePrice).toBe(pool?.currentSpotPrice);
      expect(allocations[1].effectivePrice).toBe(pool?.currentSpotPrice);
    });

    it('escalates market clearing price as demand saturates capacity', () => {
      const initialPrice = auctioneer.getPool('pool-gpu-1')?.currentSpotPrice ?? 5.0;

      // Fill 9 out of 10 units (>80% triggers congestion curve)
      auctioneer.submitBid({
        bidId: 'heavy-bid-1',
        bidderId: 'corp-ai',
        poolId: 'pool-gpu-1',
        maxBidPrice: 40.0,
        requestedUnits: 9,
        tolerance: 'PREEMPTIBLE',
      });

      const updatedPrice = auctioneer.getPool('pool-gpu-1')?.currentSpotPrice ?? 0;
      expect(updatedPrice).toBeGreaterThan(initialPrice);
    });
  });

  describe('Preemption & Grace Period Eviction', () => {
    it('issues PREEMPTION_WARNING when price outbids preemptible workload', () => {
      const now = 100000;

      // Allocate low-bid workload
      auctioneer.submitBid(
        {
          bidId: 'cheap-bid',
          bidderId: 'user-student',
          poolId: 'pool-gpu-1',
          maxBidPrice: 7.0,
          requestedUnits: 5,
          tolerance: 'PREEMPTIBLE',
        },
        now
      );

      expect(auctioneer.getBid('cheap-bid')?.allocationStatus).toBe('ALLOCATED');

      // Heavy whale bid drives spot price up past 7.0 and takes remaining capacity
      auctioneer.submitBid(
        {
          bidId: 'whale-bid',
          bidderId: 'user-enterprise',
          poolId: 'pool-gpu-1',
          maxBidPrice: 45.0,
          requestedUnits: 8,
          tolerance: 'NON_PREEMPTIBLE',
        },
        now
      );

      const cheapBid = auctioneer.getBid('cheap-bid');
      expect(cheapBid?.allocationStatus).toBe('PREEMPTION_WARNING');
    });

    it('evicts preempted workload after grace period expires', () => {
      const t0 = 100000;
      auctioneer.submitBid(
        {
          bidId: 'cheap-bid',
          bidderId: 'user-student',
          poolId: 'pool-gpu-1',
          maxBidPrice: 7.0,
          requestedUnits: 6,
          tolerance: 'PREEMPTIBLE',
        },
        t0
      );

      // Demand surge
      auctioneer.submitBid(
        {
          bidId: 'whale-bid',
          bidderId: 'user-enterprise',
          poolId: 'pool-gpu-1',
          maxBidPrice: 45.0,
          requestedUnits: 8,
          tolerance: 'NON_PREEMPTIBLE',
        },
        t0
      );

      // Warning issued
      expect(auctioneer.getBid('cheap-bid')?.allocationStatus).toBe('PREEMPTION_WARNING');

      // Time passes beyond 60s grace period (t0 + 70,000ms)
      const t1 = t0 + 70000;
      const rebalance2 = auctioneer.rebalanceMarket('pool-gpu-1', t1);

      expect(auctioneer.getBid('cheap-bid')?.allocationStatus).toBe('EVICTED');
      expect(rebalance2.evictedBidIds).toContain('cheap-bid');
    });
  });

  describe('Capacity Release & Price Recovery', () => {
    it('relieves market pressure and lowers spot price upon allocation release', () => {
      auctioneer.submitBid({
        bidId: 'temp-bid',
        bidderId: 'user-job',
        poolId: 'pool-gpu-1',
        maxBidPrice: 30.0,
        requestedUnits: 8,
        tolerance: 'CHECKPOINTABLE',
      });

      const highPrice = auctioneer.getPool('pool-gpu-1')?.currentSpotPrice ?? 0;

      // Release workload
      auctioneer.releaseAllocation('temp-bid');
      const recoveredPrice = auctioneer.getPool('pool-gpu-1')?.currentSpotPrice ?? 0;

      expect(recoveredPrice).toBeLessThan(highPrice);
      expect(auctioneer.getPool('pool-gpu-1')?.allocatedUnits).toBe(0);
    });
  });
});
