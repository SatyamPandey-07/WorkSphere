/**
 * VickreyAuctionEngine
 * Manages the auction lifecycle, enforcing strict bid-hiding rules and calculating the second-price settlement.
 */

import { BidCryptography, SealedBid } from './BidCryptography';

export enum AuctionStatus {
    ACTIVE = 'ACTIVE',
    CLOSED = 'CLOSED',
    SETTLED = 'SETTLED',
    CANCELLED = 'CANCELLED'
}

export interface Auction {
    auctionId: string;
    deskId: string;
    status: AuctionStatus;
    endsAt: number;
    sealedBids: Map<string, SealedBid>;
    winnerId: string | null;
    winningPrice: number | null;
}

export class VickreyAuctionEngine {
    private auctions: Map<string, Auction> = new Map();
    private crypto: BidCryptography;

    constructor() {
        this.crypto = new BidCryptography();
    }

    public createAuction(deskId: string, durationMs: number): Auction {
        const auctionId = `auc_${Date.now()}_${deskId}`;
        const auction: Auction = {
            auctionId,
            deskId,
            status: AuctionStatus.ACTIVE,
            endsAt: Date.now() + durationMs,
            sealedBids: new Map(),
            winnerId: null,
            winningPrice: null
        };

        this.auctions.set(auctionId, auction);
        return auction;
    }

    public async placeBid(auctionId: string, userId: string, amount: number, salt: string): Promise<boolean> {
        const auction = this.auctions.get(auctionId);
        if (!auction || auction.status !== AuctionStatus.ACTIVE) return false;
        if (Date.now() > auction.endsAt) {
            this.closeAuction(auctionId);
            return false;
        }

        const sealed = await this.crypto.sealBid(userId, amount, salt);
        auction.sealedBids.set(userId, sealed);
        return true;
    }

    public async closeAuction(auctionId: string): Promise<void> {
        const auction = this.auctions.get(auctionId);
        if (!auction || auction.status !== AuctionStatus.ACTIVE) return;

        auction.status = AuctionStatus.CLOSED;
    }

    public async settleAuction(auctionId: string, reveals: { userId: string, amount: number, salt: string }[]): Promise<{ winnerId: string, price: number } | null> {
        const auction = this.auctions.get(auctionId);
        if (!auction || auction.status !== AuctionStatus.CLOSED) return null;

        const validBids: { userId: string, amount: number }[] = [];

        for (const reveal of reveals) {
            const sealed = auction.sealedBids.get(reveal.userId);
            if (!sealed) continue;

            const isValid = await this.crypto.verifyBid(sealed, reveal.userId, reveal.amount, reveal.salt);
            if (isValid) {
                validBids.push({ userId: reveal.userId, amount: reveal.amount });
            }
        }

        if (validBids.length === 0) {
            auction.status = AuctionStatus.CANCELLED;
            return null;
        }

        // Sort descending by amount
        validBids.sort((a, b) => b.amount - a.amount);

        const winner = validBids[0];
        // Vickrey rule: Winner pays the SECOND highest bid
        const price = validBids.length > 1 ? validBids[1].amount : winner.amount;

        auction.winnerId = winner.userId;
        auction.winningPrice = price;
        auction.status = AuctionStatus.SETTLED;

        return { winnerId: winner.userId, price };
    }

    public getAuction(auctionId: string): Auction | undefined {
        return this.auctions.get(auctionId);
    }
}
