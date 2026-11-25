import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePrivateAuctionBatchProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePrivateAuctionBatchProver';

describe('ZeroKnowledgePrivateAuctionBatchProver', () => {
  const auction = new ZeroKnowledgePrivateAuctionBatchProver();

  it('settles sealed-bid second-price Vickrey auctions without disclosing winning or losing bids', () => {
    const bids = [
      auction.createSealedBid('bidder-alice', 450n, 12),
      auction.createSealedBid('bidder-bob', 1200n, 12),
      auction.createSealedBid('bidder-carol', 875n, 12),
      auction.createSealedBid('bidder-dave', 300n, 12),
    ];

    const settlement = auction.settleVickreyAuction('spectrum-lot-7', bids, 12);
    expect(settlement.winnerId).toBe('bidder-bob');
    expect(settlement.runnerUpId).toBe('bidder-carol');
    expect(settlement.clearingPrice).toBe(875n);
    expect(auction.verifySettlement(settlement)).toBe(true);

    // Tied top bids edge case (surplus == 0)
    const tied = [
      auction.createSealedBid('b1', 500n, 12),
      auction.createSealedBid('b2', 500n, 12),
      auction.createSealedBid('b3', 100n, 12),
    ];
    const tiedSettle = auction.settleVickreyAuction('tied-lot', tied, 12);
    expect(tiedSettle.clearingPrice).toBe(500n);
    expect(auction.verifySettlement(tiedSettle)).toBe(true);

    // Tampering with clearing price, winner, or losing proof must fail
    expect(auction.verifySettlement({ ...settlement, clearingPrice: 876n })).toBe(false);
    expect(auction.verifySettlement({ ...settlement, winnerId: 'bidder-alice' })).toBe(false);
    expect(
      auction.verifySettlement({
        ...settlement,
        clearingPriceOpening: {
          ...settlement.clearingPriceOpening,
          responseBlinding: (settlement.clearingPriceOpening.responseBlinding + 1n) % SUBGROUP_Q,
        },
      }),
    ).toBe(false);
    expect(auction.verifySettlement({ ...settlement, loserGapProofs: {} })).toBe(false);

    expect(() => auction.settleVickreyAuction('too-small', [bids[0]], 12)).toThrow();
    expect(() => auction.createSealedBid('neg', -1n, 12)).toThrow();

    const json = JSON.parse(auction.serializeSettlement(settlement)) as { winnerId: string; clearingPrice: string };
    expect(json.winnerId).toBe('bidder-bob');
    expect(json.clearingPrice).toBe('875');
  });
});
