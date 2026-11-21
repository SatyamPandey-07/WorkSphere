import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeAuctionSealedBidProver } from '../../core/zkp/ZeroKnowledgeAuctionSealedBidProver';

describe('ZeroKnowledgeAuctionSealedBidProver', () => {
  const auction = new ZeroKnowledgeAuctionSealedBidProver();

  it('resolves a sealed-bid Vickrey auction and verifies winner dominance without revealing losing bids', () => {
    const bids = [
      auction.commitBid('team-alpha', 450n),
      auction.commitBid('team-beta', 920n),
      auction.commitBid('team-gamma', 680n),
    ];
    const published = new Map(bids.map((b) => [b.bidderId, b.commitment]));

    const proof = auction.resolveAuction('room-auction-1', bids, {
      bitLength: 12,
      vickreySecondPrice: true,
    });

    expect(proof.winnerId).toBe('team-beta');
    expect(proof.winningBid).toBe(920n);
    expect(proof.settlementPrice).toBe(680n);
    expect(auction.verifyAuctionResult(proof, published).valid).toBe(true);
  });

  it('rejects forged winning bids or tampered dominance proofs', () => {
    const bids = [
      auction.commitBid('b1', 300n),
      auction.commitBid('b2', 500n),
    ];
    const published = new Map(bids.map((b) => [b.bidderId, b.commitment]));
    const proof = auction.resolveAuction('room-auction-2', bids, { bitLength: 10 });

    expect(
      auction.verifyAuctionResult({ ...proof, winningBid: 501n }, published).valid
    ).toBe(false);

    const badDom = {
      ...proof,
      dominanceProofs: [
        { ...proof.dominanceProofs[0], linkResponse: proof.dominanceProofs[0].linkResponse + 1n },
      ],
    };
    expect(auction.verifyAuctionResult(badDom, published).valid).toBe(false);
  });

  it('enforces reserve-price compliance and rejects below-reserve winning bids', () => {
    const bids = [
      auction.commitBid('desk-team-1', 210n),
      auction.commitBid('desk-team-2', 390n),
      auction.commitBid('desk-team-3', 310n),
    ];
    const ledger = auction.publishCommitmentLedger(bids);
    const proof = auction.resolveAuction('reserve-auction-1', bids, { bitLength: 10 });

    const pass = auction.verifyReservePriceCompliance(proof, ledger, 350n);
    expect(pass.valid).toBe(true);
    expect(pass.marginOverReserve).toBe(40n);

    const fail = auction.verifyReservePriceCompliance(proof, ledger, 450n);
    expect(fail.valid).toBe(false);
    expect(fail.marginOverReserve).toBe(-60n);
  });

  it('batch-verifies multiple sealed auctions and round-trips proof serialization', () => {
    const bidsA = [auction.commitBid('a1', 120n), auction.commitBid('a2', 260n)];
    const bidsB = [auction.commitBid('b1', 540n), auction.commitBid('b2', 330n)];
    const ledgerA = auction.publishCommitmentLedger(bidsA);
    const ledgerB = auction.publishCommitmentLedger(bidsB);

    const proofA = auction.resolveAuction('batch-auc-A', bidsA, { bitLength: 10, vickreySecondPrice: true });
    const proofB = auction.resolveAuction('batch-auc-B', bidsB, { bitLength: 10, vickreySecondPrice: false });

    const batchRes = auction.batchVerifyAuctions([
      { proof: proofA, publishedCommitments: ledgerA },
      { proof: proofB, publishedCommitments: ledgerB },
    ]);
    expect(batchRes.allValid).toBe(true);
    expect(batchRes.verifiedAuctionIds).toEqual(['batch-auc-A', 'batch-auc-B']);
    expect(batchRes.totalSettlementVolume).toBe(120n + 540n);

    const serialized = auction.serializeResultProof(proofA);
    const deserialized = auction.deserializeResultProof(serialized);
    expect(auction.verifyAuctionResult(deserialized, ledgerA).valid).toBe(true);
  });
});
