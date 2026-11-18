import { describe, it, expect } from 'vitest';
import {
  VCGBundleAuction,
  computeBidCommitment,
} from '../../core/auctions/VCGBundleAuction';

describe('VCGBundleAuction (Combinatorial Bundle VCG Clearing)', () => {
  const items = ['desk_A', 'desk_B', 'meeting_room_1', 'gpu_cluster_X'];

  describe('Commit-Reveal Protocol', () => {
    it('verifies valid commitments and rejects altered bids', () => {
      const auction = new VCGBundleAuction('auc_01', items);
      const blinding = 'salt_random_123';
      const commitment = computeBidCommitment('bidder_alice', ['desk_A'], 50, blinding);

      auction.submitCommitment('bidder_alice', commitment);

      // Revealing with correct params succeeds
      expect(() => {
        auction.revealBid('bidder_alice', ['desk_A'], 50, blinding);
      }).not.toThrow();

      // Tampered amount or bundle throws
      const auction2 = new VCGBundleAuction('auc_02', items);
      auction2.submitCommitment('bidder_bob', commitment);
      expect(() => {
        auction2.revealBid('bidder_bob', ['desk_A'], 51, blinding);
      }).toThrow('does not match sealed commitment');
    });

    it('rejects bids with unavailable items', () => {
      const auction = new VCGBundleAuction('auc_03', items);
      const blinding = 'salt_abc';
      const commitment = computeBidCommitment('bidder_carol', ['nonexistent_item'], 20, blinding);
      auction.submitCommitment('bidder_carol', commitment);

      expect(() => {
        auction.revealBid('bidder_carol', ['nonexistent_item'], 20, blinding);
      }).toThrow('is not available in auction');
    });
  });

  describe('Classic Vickrey Equivalence (Single Item)', () => {
    it('charges the second-highest bid to the winner under single item auction', () => {
      const auction = new VCGBundleAuction('auc_vickrey', items);

      // Alice bids 100 for desk_A
      const saltA = 'salt_a';
      auction.submitCommitment('alice', computeBidCommitment('alice', ['desk_A'], 100, saltA));
      auction.revealBid('alice', ['desk_A'], 100, saltA);

      // Bob bids 75 for desk_A
      const saltB = 'salt_b';
      auction.submitCommitment('bob', computeBidCommitment('bob', ['desk_A'], 75, saltB));
      auction.revealBid('bob', ['desk_A'], 75, saltB);

      const outcome = auction.clearAuction();
      expect(outcome.allocations.length).toBe(1);

      const winner = outcome.allocations[0];
      expect(winner.bidderId).toBe('alice');
      expect(winner.bidAmount).toBe(100);
      expect(winner.vcgPayment).toBe(75); // Exactly the 2nd price!
      expect(winner.utility).toBe(25); // 100 - 75 = 25
      expect(outcome.totalRevenue).toBe(75);
    });
  });

  describe('Combinatorial Bundle & Clarke Pivot Rule', () => {
    it('solves WDP and charges Clarke pivot externality payments', () => {
      const auction = new VCGBundleAuction('auc_bundle', items);

      // Alice wants desk_A & desk_B together for 120
      const saltA = 'salt_alice';
      auction.submitCommitment('alice', computeBidCommitment('alice', ['desk_A', 'desk_B'], 120, saltA));
      auction.revealBid('alice', ['desk_A', 'desk_B'], 120, saltA);

      // Bob wants desk_A for 50
      const saltB = 'salt_bob';
      auction.submitCommitment('bob', computeBidCommitment('bob', ['desk_A'], 50, saltB));
      auction.revealBid('bob', ['desk_A'], 50, saltB);

      // Carol wants desk_B for 60
      const saltC = 'salt_carol';
      auction.submitCommitment('carol', computeBidCommitment('carol', ['desk_B'], 60, saltC));
      auction.revealBid('carol', ['desk_B'], 60, saltC);

      // Dave wants gpu_cluster_X (uncontested) for 200
      const saltD = 'salt_dave';
      auction.submitCommitment('dave', computeBidCommitment('dave', ['gpu_cluster_X'], 200, saltD));
      auction.revealBid('dave', ['gpu_cluster_X'], 200, saltD);

      const outcome = auction.clearAuction();

      // Alice (120) beats Bob + Carol (50 + 60 = 110)
      // Dave wins uncontested (200)
      // Total Welfare = 120 + 200 = 320
      expect(outcome.totalWelfare).toBe(320);

      const aliceAlloc = outcome.allocations.find((a) => a.bidderId === 'alice')!;
      expect(aliceAlloc).toBeDefined();
      // Counterfactual welfare without Alice: Bob (50) + Carol (60) + Dave (200) = 310
      // Welfare of others with Alice: Dave (200)
      // VCG Payment = 310 - 200 = 110!
      expect(aliceAlloc.vcgPayment).toBe(110);
      expect(aliceAlloc.utility).toBe(10); // 120 - 110 = 10 (Individual Rationality)

      const daveAlloc = outcome.allocations.find((a) => a.bidderId === 'dave')!;
      expect(daveAlloc).toBeDefined();
      // Uncontested item externality is 0
      expect(daveAlloc.vcgPayment).toBe(0);
      expect(daveAlloc.utility).toBe(200);
    });
  });
});
