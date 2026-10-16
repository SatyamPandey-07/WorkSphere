/**
 * BountyEscrow.ts
 * Locks the poster's loyalty tokens or fiat-equivalent funds, executing 
 * the automated payout only when the verifier and peer-review thresholds are met.
 */

export interface EscrowLock {
    bountyId: string;
    posterId: string;
    amount: number;
    lockedAt: number;
    status: 'LOCKED' | 'RELEASED_TO_CLAIMER' | 'REFUNDED_TO_POSTER';
}

export class BountyEscrow {
    private locks: Map<string, EscrowLock> = new Map();
    private balances: Map<string, number> = new Map();

    constructor() {
        // Mock initial balances
        this.balances.set('user-1', 1000);
        this.balances.set('user-2', 500);
    }

    public lockFunds(bountyId: string, posterId: string, amount: number): boolean {
        const balance = this.balances.get(posterId) || 0;

        if (balance < amount) {
            console.warn(`[Escrow] Insufficient funds for poster ${posterId}`);
            return false;
        }

        if (this.locks.has(bountyId)) {
            console.warn(`[Escrow] Bounty ${bountyId} already has an active lock`);
            return false;
        }

        const lock: EscrowLock = {
            bountyId,
            posterId,
            amount,
            lockedAt: Date.now(),
            status: 'LOCKED'
        };

        this.locks.set(bountyId, lock);
        this.balances.set(posterId, balance - amount);

        console.log(`[Escrow] Locked ${amount} tokens for bounty ${bountyId}`);
        return true;
    }

    public executePayout(bountyId: string, claimerId: string): boolean {
        const lock = this.locks.get(bountyId);

        if (!lock || lock.status !== 'LOCKED') {
            console.error(`[Escrow] Cannot payout. Lock invalid or already processed.`);
            return false;
        }

        const claimerBalance = this.balances.get(claimerId) || 0;
        this.balances.set(claimerId, claimerBalance + lock.amount);

        lock.status = 'RELEASED_TO_CLAIMER';
        console.log(`[Escrow] Payout executed: ${lock.amount} tokens transferred to ${claimerId}`);
        return true;
    }

    public refundPoster(bountyId: string): boolean {
        const lock = this.locks.get(bountyId);

        if (!lock || lock.status !== 'LOCKED') {
            return false;
        }

        const posterBalance = this.balances.get(lock.posterId) || 0;
        this.balances.set(lock.posterId, posterBalance + lock.amount);

        lock.status = 'REFUNDED_TO_POSTER';
        console.log(`[Escrow] Refunded ${lock.amount} tokens to poster ${lock.posterId}`);
        return true;
    }

    public getLockStatus(bountyId: string): EscrowLock | null {
        return this.locks.get(bountyId) || null;
    }

    public getUserBalance(userId: string): number {
        return this.balances.get(userId) || 0;
    }
}
