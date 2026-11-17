import { describe, it, expect, beforeEach } from 'vitest';
import {
  CombinatorialAuctionEngine,
  SCALE,
  AuctionPhase,
} from '../../core/auctions/CombinatorialAuctionEngine';

describe('CombinatorialAuctionEngine - Multi-Item Double Auction & VCG Pricing', () => {
  let auction: CombinatorialAuctionEngine;

  beforeEach(() => {
    auction = new CombinatorialAuctionEngine('auction-venue-101');
    // Register items with seller reserve prices
    auction.registerAsk('host-1', 'desk-A', 20n * SCALE); // $20 reserve
    auction.registerAsk('host-1', 'desk-B', 20n * SCALE); // $20 reserve
    auction.registerAsk('host-2', 'booth-1', 40n * SCALE); // $40 reserve
  });

  describe('Commit-Reveal Mechanism', () => {
    it('commits sealed bid and successfully reveals with matching salt', () => {
      const items = ['desk-A', 'booth-1'];
      const offer = 80n * SCALE;
      const salt = 'cryptographic_salt_123';

      const hash = auction.computeCommitmentHash(items, offer, salt);
      auction.commitBid('bid-alice', hash);

      auction.openRevealPhase();
      expect(auction.getPhase()).toBe(AuctionPhase.REVEAL_PHASE);

      const res = auction.revealBid({
        bidId: 'bid-alice',
        bidderId: 'user-alice',
        itemIds: items,
        maxOfferPrice: offer,
        salt,
      });

      expect(res).toBe(true);
    });

    it('rejects bid reveal if salt or parameters do not match commitment hash', () => {
      const hash = auction.computeCommitmentHash(['desk-A'], 50n * SCALE, 'salt-correct');
      auction.commitBid('bid-bob', hash);
      auction.openRevealPhase();

      expect(() => {
        auction.revealBid({
          bidId: 'bid-bob',
          bidderId: 'user-bob',
          itemIds: ['desk-A'],
          maxOfferPrice: 50n * SCALE,
          salt: 'salt-wrong',
        });
      }).toThrow('commitment hash mismatch');
    });
  });

  describe('Winner Determination Problem (WDP) & VCG Settlement', () => {
    it('selects optimal disjoint bundle combination that maximizes total welfare', () => {
      // Setup 3 competing bids:
      // Bid 1: [desk-A, booth-1] for $90
      // Bid 2: [desk-A] for $35
      // Bid 3: [booth-1] for $65
      // Bid 2 + Bid 3 = $100 > $90 -> Bid 2 and Bid 3 should win!
      const salt = 'common_salt';

      const h1 = auction.computeCommitmentHash(['desk-A', 'booth-1'], 90n * SCALE, salt);
      const h2 = auction.computeCommitmentHash(['desk-A'], 35n * SCALE, salt);
      const h3 = auction.computeCommitmentHash(['booth-1'], 65n * SCALE, salt);

      auction.commitBid('bid-1', h1);
      auction.commitBid('bid-2', h2);
      auction.commitBid('bid-3', h3);

      auction.openRevealPhase();

      auction.revealBid({
        bidId: 'bid-1',
        bidderId: 'user-1',
        itemIds: ['desk-A', 'booth-1'],
        maxOfferPrice: 90n * SCALE,
        salt,
      });

      auction.revealBid({
        bidId: 'bid-2',
        bidderId: 'user-2',
        itemIds: ['desk-A'],
        maxOfferPrice: 35n * SCALE,
        salt,
      });

      auction.revealBid({
        bidId: 'bid-3',
        bidderId: 'user-3',
        itemIds: ['booth-1'],
        maxOfferPrice: 65n * SCALE,
        salt,
      });

      const wdpRes = auction.solveWDP();
      expect(wdpRes.winningBidsCount).toBe(2);

      const settlement = auction.settleAuction();
      expect(settlement.totalWinningBids).toBe(2);
      expect(settlement.allocatedItems).toContain('desk-A');
      expect(settlement.allocatedItems).toContain('booth-1');

      const winningIds = settlement.winningAllocations.map((a) => a.bidId);
      expect(winningIds).toContain('bid-2');
      expect(winningIds).toContain('bid-3');
      expect(winningIds).not.toContain('bid-1');

      // Zero-overlap verification: items allocated must be distinct
      const allAllocated: string[] = [];
      for (const a of settlement.winningAllocations) {
        allAllocated.push(...a.itemIds);
      }
      expect(new Set(allAllocated).size).toBe(allAllocated.length);

      // Total payments must cover seller reserves
      expect(settlement.totalCollectedPayments).toBeGreaterThanOrEqual(settlement.totalSellerPayouts);
    });
  });
});
