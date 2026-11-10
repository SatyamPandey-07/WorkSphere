/**
 * LoungeEscrow.ts
 * Manages the temporary locking of funds to guarantee instant payment 
 * to emergency lounge or hotel partners.
 */

export interface EscrowRecord {
    id: string;
    userId: string;
    amount: number;
    reason: string;
    status: 'LOCKED' | 'RELEASED' | 'REFUNDED' | 'EXECUTED';
    createdAt: number;
    expiresAt: number;
    vendorReference?: string;
}

export class LoungeEscrow {
    private ledger: Map<string, EscrowRecord> = new Map();
    private userBalances: Map<string, number> = new Map();

    constructor() {
        // Mock initial balances
        this.userBalances.set('user-123', 500.00);
    }

    public lockFunds(userId: string, amount: number, reason: string): boolean {
        const balance = this.userBalances.get(userId) || 0;

        if (balance < amount) {
            console.warn(`[Escrow] Insufficient funds for ${userId}. Required: ${amount}, Available: ${balance}`);
            return false;
        }

        const record: EscrowRecord = {
            id: crypto.randomUUID(),
            userId,
            amount,
            reason,
            status: 'LOCKED',
            createdAt: Date.now(),
            expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hour lock
        };

        this.ledger.set(record.id, record);
        this.userBalances.set(userId, balance - amount);

        console.log(`[Escrow] Locked $${amount} for user ${userId} (Reason: ${reason})`);
        return true;
    }

    public executePayout(escrowId: string, vendorReference: string): boolean {
        const record = this.ledger.get(escrowId);
        if (!record || record.status !== 'LOCKED') {
            console.warn(`[Escrow] Cannot execute payout for ${escrowId}. Status: ${record?.status}`);
            return false;
        }

        record.status = 'EXECUTED';
        record.vendorReference = vendorReference;

        // In production, this triggers a Stripe Connect / Banking API payout to the lounge
        console.log(`[Escrow] Executed payout of $${record.amount} to vendor for ${vendorReference}`);
        return true;
    }

    public refund(userId: string, reason: string): void {
        // Find all locked escrows for this user and refund them
        let refundedAmount = 0;

        for (const [id, record] of this.ledger.entries()) {
            if (record.userId === userId && record.status === 'LOCKED') {
                record.status = 'REFUNDED';
                refundedAmount += record.amount;
            }
        }

        if (refundedAmount > 0) {
            const currentBalance = this.userBalances.get(userId) || 0;
            this.userBalances.set(userId, currentBalance + refundedAmount);
            console.log(`[Escrow] Refunded $${refundedAmount} to ${userId} (Reason: ${reason})`);
        }
    }

    public releaseExpiredLocks(): void {
        const now = Date.now();

        for (const [id, record] of this.ledger.entries()) {
            if (record.status === 'LOCKED' && record.expiresAt < now) {
                record.status = 'RELEASED';
                const currentBalance = this.userBalances.get(record.userId) || 0;
                this.userBalances.set(record.userId, currentBalance + record.amount);
                console.log(`[Escrow] Released expired lock ${id} for user ${record.userId}`);
            }
        }
    }

    public getUserBalance(userId: string): number {
        return this.userBalances.get(userId) || 0;
    }

    public getActiveEscrows(userId: string): EscrowRecord[] {
        return Array.from(this.ledger.values()).filter(r => r.userId === userId && r.status === 'LOCKED');
    }
}
