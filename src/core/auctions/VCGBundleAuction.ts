/**
 * @file VCGBundleAuction.ts
 * @description Sealed-bid Vickrey-Clarke-Groves (VCG) combinatorial bundle clearing engine.
 * Solves the Winner Determination Problem (WDP) over complementary resource bundles with Clarke pivot rule,
 * zero-knowledge bid commitments, individual rationality, and dominant-strategy truthfulness.
 */

import { createHash } from 'crypto';

/**
 * Sealed bid commitment record.
 */
export interface SealedBidCommitment {
  readonly bidderId: string;
  readonly commitmentHash: string;
  readonly timestamp: number;
}

/**
 * Revealed bundle bid.
 */
export interface RevealedBid {
  readonly bidderId: string;
  readonly bundle: readonly string[]; // Set of distinct item IDs
  readonly amount: number; // Bid valuation
  readonly blindingFactor: string;
}

/**
 * Single winning allocation entry.
 */
export interface WinningBidderAllocation {
  readonly bidderId: string;
  readonly bundle: readonly string[];
  readonly bidAmount: number;
  readonly vcgPayment: number; // Clarke pivot price
  readonly utility: number; // bidAmount - vcgPayment
}

/**
 * Final auction clearance outcome.
 */
export interface AuctionClearanceOutcome {
  readonly totalWelfare: number;
  readonly totalRevenue: number;
  readonly allocations: readonly WinningBidderAllocation[];
  readonly clearedItems: readonly string[];
}

/**
 * Computes deterministic SHA-256 bid commitment hash.
 */
export function computeBidCommitment(
  bidderId: string,
  bundle: readonly string[],
  amount: number,
  blindingFactor: string
): string {
  const sortedBundle = [...bundle].sort().join(',');
  return createHash('sha256')
    .update(bidderId)
    .update(sortedBundle)
    .update(amount.toFixed(4))
    .update(blindingFactor)
    .digest('hex');
}

/**
 * VCG Combinatorial Bundle Auction Engine.
 */
export class VCGBundleAuction {
  public readonly auctionId: string;
  public readonly availableItems: readonly string[];

  private readonly commitments: Map<string, SealedBidCommitment>; // bidderId -> commitment
  private readonly revealedBids: Map<string, RevealedBid>; // bidderId -> bid
  private isAuctionClosed: boolean;

  constructor(auctionId: string, availableItems: readonly string[]) {
    this.auctionId = auctionId;
    this.availableItems = [...availableItems];
    this.commitments = new Map();
    this.revealedBids = new Map();
    this.isAuctionClosed = false;
  }

  /**
   * Submits a sealed cryptographic bid commitment during bidding phase.
   */
  public submitCommitment(bidderId: string, commitmentHash: string): void {
    if (this.isAuctionClosed) {
      throw new Error('VCGBundleAuction: Bidding phase is closed');
    }
    this.commitments.set(bidderId, {
      bidderId,
      commitmentHash,
      timestamp: Date.now(),
    });
  }

  /**
   * Reveals a previously committed bid with blinding factor verification.
   */
  public revealBid(
    bidderId: string,
    bundle: readonly string[],
    amount: number,
    blindingFactor: string
  ): void {
    if (this.isAuctionClosed) {
      throw new Error('VCGBundleAuction: Reveal phase is closed');
    }

    const commitment = this.commitments.get(bidderId);
    if (!commitment) {
      throw new Error(`VCGBundleAuction: No commitment found for bidder ${bidderId}`);
    }

    if (amount <= 0) {
      throw new Error('VCGBundleAuction: Bid amount must be positive');
    }

    // Verify all bundle items exist in availableItems
    for (const item of bundle) {
      if (!this.availableItems.includes(item)) {
        throw new Error(`VCGBundleAuction: Bundle item "${item}" is not available in auction`);
      }
    }

    // Check commitment match
    const computed = computeBidCommitment(bidderId, bundle, amount, blindingFactor);
    if (computed !== commitment.commitmentHash) {
      throw new Error('VCGBundleAuction: Revealed bid does not match sealed commitment');
    }

    this.revealedBids.set(bidderId, {
      bidderId,
      bundle: [...new Set(bundle)].sort(),
      amount,
      blindingFactor,
    });
  }

  /**
   * Closes auction and solves Winner Determination Problem (WDP) using Clarke pivot rule.
   */
  public clearAuction(): AuctionClearanceOutcome {
    this.isAuctionClosed = true;
    const allBids = Array.from(this.revealedBids.values());

    if (allBids.length === 0) {
      return {
        totalWelfare: 0,
        totalRevenue: 0,
        allocations: [],
        clearedItems: [],
      };
    }

    // 1. Solve primary WDP: maximize total social welfare with all bidders
    const optimalAllocation = this.solveWDP(allBids);

    // 2. Compute Clarke pivot payments for each winner
    const allocations: WinningBidderAllocation[] = [];
    let totalRevenue = 0;
    const clearedItemsSet = new Set<string>();

    for (const winningBid of optimalAllocation.winningBids) {
      // Calculate welfare of other winners in optimal allocation
      const othersWelfareOptimal = optimalAllocation.totalWelfare - winningBid.amount;

      // Calculate counterfactual optimal welfare without winningBid.bidderId
      const counterfactualBids = allBids.filter((b) => b.bidderId !== winningBid.bidderId);
      const counterfactualWelfare = this.solveWDP(counterfactualBids).totalWelfare;

      // VCG payment: externality imposed on other bidders
      // p_i = V_{-i}^* - sum_{j != i} v_j(x^*)
      const vcgPayment = Math.max(0, counterfactualWelfare - othersWelfareOptimal);
      const utility = winningBid.amount - vcgPayment;

      allocations.push({
        bidderId: winningBid.bidderId,
        bundle: winningBid.bundle,
        bidAmount: winningBid.amount,
        vcgPayment,
        utility,
      });

      totalRevenue += vcgPayment;
      for (const item of winningBid.bundle) {
        clearedItemsSet.add(item);
      }
    }

    return {
      totalWelfare: optimalAllocation.totalWelfare,
      totalRevenue,
      allocations,
      clearedItems: Array.from(clearedItemsSet).sort(),
    };
  }

  /**
   * Optimal Winner Determination Problem (WDP) solver.
   * Finds disjoint subset of bids that maximizes total valuation.
   */
  public solveWDP(bids: readonly RevealedBid[]): {
    totalWelfare: number;
    winningBids: readonly RevealedBid[];
  } {
    let bestWelfare = 0;
    let bestAllocation: RevealedBid[] = [];

    const search = (
      index: number,
      currentWelfare: number,
      currentAllocation: RevealedBid[],
      allocatedItems: Set<string>
    ) => {
      if (index === bids.length) {
        if (currentWelfare > bestWelfare) {
          bestWelfare = currentWelfare;
          bestAllocation = [...currentAllocation];
        }
        return;
      }

      const bid = bids[index];

      // Branch 1: Try including this bid if its items are not already allocated
      let canInclude = true;
      for (const item of bid.bundle) {
        if (allocatedItems.has(item)) {
          canInclude = false;
          break;
        }
      }

      if (canInclude) {
        for (const item of bid.bundle) allocatedItems.add(item);
        currentAllocation.push(bid);

        search(index + 1, currentWelfare + bid.amount, currentAllocation, allocatedItems);

        currentAllocation.pop();
        for (const item of bid.bundle) allocatedItems.delete(item);
      }

      // Branch 2: Exclude this bid
      search(index + 1, currentWelfare, currentAllocation, allocatedItems);
    };

    search(0, 0, [], new Set<string>());

    return {
      totalWelfare: bestWelfare,
      winningBids: bestAllocation,
    };
  }
}
