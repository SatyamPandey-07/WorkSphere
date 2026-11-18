/**
 * Combinatorial Double-Auction Matching Engine
 * Implements Winner Determination Problem (WDP) optimization,
 * Vickrey-Clarke-Groves (VCG) truthful pricing, and commit-reveal bid sealing.
 */

export const SCALE = 100_000_000n; // 10^8 fixed-point scaling factor

export const AuctionPhase = {
  SEALED_COMMITMENT: 'SEALED_COMMITMENT',
  REVEAL_PHASE: 'REVEAL_PHASE',
  SOLVED_WDP: 'SOLVED_WDP',
  SETTLED: 'SETTLED',
} as const;

export type AuctionPhase = (typeof AuctionPhase)[keyof typeof AuctionPhase];

export interface BundleBid {
  bidId: string;
  bidderId: string;
  itemIds: string[];
  maxOfferPrice: bigint;
  commitmentHash: string;
  salt?: string;
  isRevealed: boolean;
  timestamp: number;
}

export interface ResourceAsk {
  askId: string;
  sellerId: string;
  itemId: string;
  reservePrice: bigint;
}

export interface WinningAllocation {
  bidId: string;
  bidderId: string;
  itemIds: string[];
  offerPrice: bigint;
  vcgPayment: bigint; // Truthful clearing price
}

export interface AuctionSettlementSummary {
  auctionId: string;
  totalWinningBids: number;
  allocatedItems: string[];
  winningAllocations: WinningAllocation[];
  totalCollectedPayments: bigint;
  totalSellerPayouts: bigint;
  platformSurplus: bigint;
  socialWelfare: bigint;
  settledAt: number;
}

export class CombinatorialAuctionEngine {
  public readonly auctionId: string;
  private phase: AuctionPhase = AuctionPhase.SEALED_COMMITMENT;

  private asks: Map<string, ResourceAsk> = new Map(); // itemId -> ResourceAsk
  private commitments: Map<string, string> = new Map(); // bidId -> commitmentHash
  private bids: Map<string, BundleBid> = new Map(); // bidId -> BundleBid
  private winningAllocations: WinningAllocation[] = [];

  constructor(auctionId: string) {
    this.auctionId = auctionId;
  }

  public getPhase(): AuctionPhase {
    return this.phase;
  }

  /**
   * Registers a resource ask with a minimum reserve price.
   */
  public registerAsk(sellerId: string, itemId: string, reservePrice: bigint): void {
    if (this.phase !== AuctionPhase.SEALED_COMMITMENT) {
      throw new Error(`Cannot register ask during phase ${this.phase}`);
    }
    this.asks.set(itemId, {
      askId: `ask-${itemId}`,
      sellerId,
      itemId,
      reservePrice,
    });
  }

  /**
   * Phase 1: Commits a sealed bid hash preventing front-running.
   */
  public commitBid(bidId: string, commitmentHash: string): void {
    if (this.phase !== AuctionPhase.SEALED_COMMITMENT) {
      throw new Error(`Cannot commit bid during phase ${this.phase}`);
    }
    this.commitments.set(bidId, commitmentHash);
  }

  /**
   * Transitions auction to reveal phase.
   */
  public openRevealPhase(): void {
    if (this.phase !== AuctionPhase.SEALED_COMMITMENT) {
      throw new Error(`Cannot transition to reveal phase from ${this.phase}`);
    }
    this.phase = AuctionPhase.REVEAL_PHASE;
  }

  /**
   * Phase 2: Reveals a committed bid with plaintext parameters and salt.
   */
  public revealBid(params: {
    bidId: string;
    bidderId: string;
    itemIds: string[];
    maxOfferPrice: bigint;
    salt: string;
  }): boolean {
    if (this.phase !== AuctionPhase.REVEAL_PHASE) {
      throw new Error(`Cannot reveal bid during phase ${this.phase}`);
    }

    const commitment = this.commitments.get(params.bidId);
    if (!commitment) {
      throw new Error(`No sealed commitment found for bidId ${params.bidId}`);
    }

    // Verify cryptographic commitment hash
    const expectedHash = this.computeCommitmentHash(
      params.itemIds,
      params.maxOfferPrice,
      params.salt
    );

    if (commitment !== expectedHash) {
      throw new Error('Bid reveal failed: commitment hash mismatch');
    }

    // Ensure all requested items exist in registered asks
    for (const item of params.itemIds) {
      if (!this.asks.has(item)) {
        throw new Error(`Requested item ${item} is not available in auction asks`);
      }
    }

    this.bids.set(params.bidId, {
      bidId: params.bidId,
      bidderId: params.bidderId,
      itemIds: params.itemIds,
      maxOfferPrice: params.maxOfferPrice,
      commitmentHash: commitment,
      salt: params.salt,
      isRevealed: true,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Solves the Winner Determination Problem (WDP) and calculates VCG payments.
   */
  public solveWDP(): { winningBidsCount: number; maxSocialWelfare: bigint } {
    if (this.phase !== AuctionPhase.REVEAL_PHASE) {
      throw new Error(`Cannot solve WDP during phase ${this.phase}`);
    }

    const revealedBids = Array.from(this.bids.values()).filter((b) => b.isRevealed);

    // 1. Solve optimal allocation with ALL bidders
    const optimalSubset = this.findOptimalAllocation(revealedBids);

    // 2. Compute VCG payments for each winning bidder:
    // P_i = Welfare_{-i}(optimal without i) - Welfare_{-i}(optimal with i)
    this.winningAllocations = [];
    for (const winBid of optimalSubset) {
      // Find optimal allocation excluding bidder winBid
      const subsetWithoutI = revealedBids.filter((b) => b.bidId !== winBid.bidId);
      const optimalWithoutI = this.findOptimalAllocation(subsetWithoutI);
      const welfareWithoutI = this.computeWelfare(optimalWithoutI);

      // Welfare of others in optimal subset
      const welfareOthersWithI = this.computeWelfare(
        optimalSubset.filter((b) => b.bidId !== winBid.bidId)
      );

      // VCG payment: externality imposed on others + asks cost
      let vcgPayment = welfareWithoutI - welfareOthersWithI;

      // Lower bound payment by reserve prices of items in bundle
      let sumReserves = 0n;
      for (const item of winBid.itemIds) {
        sumReserves += this.asks.get(item)?.reservePrice ?? 0n;
      }
      if (vcgPayment < sumReserves) {
        vcgPayment = sumReserves;
      }

      this.winningAllocations.push({
        bidId: winBid.bidId,
        bidderId: winBid.bidderId,
        itemIds: winBid.itemIds,
        offerPrice: winBid.maxOfferPrice,
        vcgPayment,
      });
    }

    this.phase = AuctionPhase.SOLVED_WDP;
    return {
      winningBidsCount: this.winningAllocations.length,
      maxSocialWelfare: this.computeWelfare(optimalSubset),
    };
  }

  /**
   * Finalizes auction and computes complete settlement figures.
   */
  public settleAuction(): AuctionSettlementSummary {
    if (this.phase !== AuctionPhase.SOLVED_WDP) {
      throw new Error(`Cannot settle auction in phase ${this.phase}`);
    }

    let totalCollectedPayments = 0n;
    let totalSellerPayouts = 0n;
    const allocatedItems = new Set<string>();

    for (const alloc of this.winningAllocations) {
      totalCollectedPayments += alloc.vcgPayment;
      for (const item of alloc.itemIds) {
        allocatedItems.add(item);
        const ask = this.asks.get(item)!;
        totalSellerPayouts += ask.reservePrice;
      }
    }

    const platformSurplus = totalCollectedPayments - totalSellerPayouts;
    const socialWelfare = this.computeWelfare(
      this.winningAllocations.map((a) => this.bids.get(a.bidId)!)
    );

    this.phase = AuctionPhase.SETTLED;

    return {
      auctionId: this.auctionId,
      totalWinningBids: this.winningAllocations.length,
      allocatedItems: Array.from(allocatedItems),
      winningAllocations: [...this.winningAllocations],
      totalCollectedPayments,
      totalSellerPayouts,
      platformSurplus,
      socialWelfare,
      settledAt: Date.now(),
    };
  }

  /**
   * Helper to compute cryptographic commitment hash: sha256 simulation.
   */
  public computeCommitmentHash(itemIds: string[], maxOfferPrice: bigint, salt: string): string {
    const raw = `${itemIds.sort().join(',')}:${maxOfferPrice}:${salt}`;
    let hash = 0x811c9dc5n;
    for (let i = 0; i < raw.length; i++) {
      hash ^= BigInt(raw.charCodeAt(i));
      hash = (hash * 0x01000193n) & 0xffffffffn;
    }
    return hash.toString(16).padStart(8, '0');
  }

  // --- Optimization & Social Welfare Solvers ---

  private findOptimalAllocation(candidateBids: BundleBid[]): BundleBid[] {
    let bestWelfare = 0n;
    let bestSubset: BundleBid[] = [];

    const n = candidateBids.length;
    // Exact power set search for small combinatorial auctions (n <= 16)
    const maxCombinations = 1 << Math.min(n, 16);

    for (let mask = 0; mask < maxCombinations; mask++) {
      const subset: BundleBid[] = [];
      const usedItems = new Set<string>();
      let hasOverlap = false;

      for (let i = 0; i < n; i++) {
        if ((mask >> i) & 1) {
          const bid = candidateBids[i];
          for (const item of bid.itemIds) {
            if (usedItems.has(item)) {
              hasOverlap = true;
              break;
            }
            usedItems.add(item);
          }
          if (hasOverlap) break;
          subset.push(bid);
        }
      }

      if (!hasOverlap) {
        const welfare = this.computeWelfare(subset);
        if (welfare > bestWelfare) {
          bestWelfare = welfare;
          bestSubset = subset;
        }
      }
    }

    return bestSubset;
  }

  private computeWelfare(subset: BundleBid[]): bigint {
    let sumBids = 0n;
    let sumReserves = 0n;
    const usedItems = new Set<string>();

    for (const b of subset) {
      sumBids += b.maxOfferPrice;
      for (const item of b.itemIds) {
        if (!usedItems.has(item)) {
          usedItems.add(item);
          sumReserves += this.asks.get(item)?.reservePrice ?? 0n;
        }
      }
    }

    return sumBids >= sumReserves ? sumBids - sumReserves : 0n;
  }
}
