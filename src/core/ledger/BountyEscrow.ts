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

export const DEFAULT_MOCK_BALANCES: Record<string, number> = {
    'user-1': 1000,
    'user-2': 500
};

export class BountyEscrow {
    private locks: Map<string, EscrowLock> = new Map();
    private balances: Map<string, number> = new Map();

    constructor(initialBalances?: Map<string, number> | Record<string, number>) {
        this.reset();
        if (initialBalances) {
            if (initialBalances instanceof Map) {
                for (const [k, v] of initialBalances.entries()) {
                    this.balances.set(k, v);
                }
            } else {
                for (const [k, v] of Object.entries(initialBalances)) {
                    this.balances.set(k, v);
                }
            }
        }
    }

    public reset(balances?: Record<string, number>): void {
        this.locks.clear();
        this.balances.clear();
        const base = balances || DEFAULT_MOCK_BALANCES;
        for (const [k, v] of Object.entries(base)) {
            this.balances.set(k, v);
        }
    }

    public deposit(userId: string, amount: number): void {
        if (amount <= 0) return;
        const current = this.balances.get(userId) || 0;
        this.balances.set(userId, current + amount);
    }

    public lockFunds(bountyId: string, posterId: string, amount: number): boolean {
        const balance = this.balances.get(posterId) || 0;

        if (balance < amount) {
            console.warn('[Escrow] Insufficient funds for poster ' + posterId);
            return false;
        }

        if (this.locks.has(bountyId)) {
            console.warn('[Escrow] Bounty ' + bountyId + ' already has an active lock');
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

        console.log('[Escrow] Locked ' + amount + ' tokens for bounty ' + bountyId);
        return true;
    }

    public executePayout(bountyId: string, claimerId: string): boolean {
        const lock = this.locks.get(bountyId);

        if (!lock || lock.status !== 'LOCKED') {
            console.error('[Escrow] Cannot payout. Lock invalid or already processed.');
            return false;
        }

        const claimerBalance = this.balances.get(claimerId) || 0;
        this.balances.set(claimerId, claimerBalance + lock.amount);

        lock.status = 'RELEASED_TO_CLAIMER';
        console.log('[Escrow] Payout executed: ' + lock.amount + ' tokens transferred to ' + claimerId);
        return true;
    }

    public reversePayout(bountyId: string, claimerId: string): boolean {
        const lock = this.locks.get(bountyId);

        if (!lock || lock.status !== 'RELEASED_TO_CLAIMER') {
            console.error('[Escrow] Cannot reverse payout. Lock not released to claimer.');
            return false;
        }

        const claimerBalance = this.balances.get(claimerId) || 0;
        if (claimerBalance < lock.amount) {
            console.error('[Escrow] Cannot reverse payout: claimer balance (' + claimerBalance + ') is insufficient to recover lock amount (' + lock.amount + ').');
            return false;
        }

        this.balances.set(claimerId, claimerBalance - lock.amount);
        lock.status = 'LOCKED';
        console.log('[Escrow] Payout reversed: ' + lock.amount + ' tokens reclaimed from ' + claimerId);
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
        console.log('[Escrow] Refunded ' + lock.amount + ' tokens to poster ' + lock.posterId);
        return true;
    }

    public getLockStatus(bountyId: string): EscrowLock | null {
        return this.locks.get(bountyId) || null;
    }

    public getUserBalance(userId: string): number {
        return this.balances.get(userId) || 0;
    }
}
