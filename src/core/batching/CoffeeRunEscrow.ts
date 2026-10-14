/**
 * CoffeeRunEscrow
 * Manages the lifecycle of a pooled order, locking user funds until the batch threshold is met or the timer expires.
 */

export enum EscrowStatus {
    PENDING = 'PENDING',
    LOCKED = 'LOCKED',
    EXECUTED = 'EXECUTED',
    REFUNDED = 'REFUNDED',
    EXPIRED = 'EXPIRED',
}

export interface EscrowParticipant {
    userId: string;
    amountLocked: number;
    joinedAt: number;
}

export interface BatchOrder {
    batchId: string;
    venueId: string;
    initiatorId: string;
    status: EscrowStatus;
    participants: Map<string, EscrowParticipant>;
    totalLocked: number;
    requiredThreshold: number;
    expiresAt: number;
}

export class CoffeeRunEscrow {
    private orders: Map<string, BatchOrder> = new Map();
    private readonly DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

    public createBatch(initiatorId: string, venueId: string, threshold: number): BatchOrder {
        const batchId = this.generateBatchId();
        const order: BatchOrder = {
            batchId,
            venueId,
            initiatorId,
            status: EscrowStatus.PENDING,
            participants: new Map(),
            totalLocked: 0,
            requiredThreshold: threshold,
            expiresAt: Date.now() + this.DEFAULT_TIMEOUT_MS,
        };

        this.orders.set(batchId, order);
        return order;
    }

    public joinBatch(batchId: string, userId: string, amount: number): boolean {
        const order = this.orders.get(batchId);
        if (!order || order.status !== EscrowStatus.PENDING) return false;
        if (Date.now() > order.expiresAt) {
            this.expireBatch(batchId);
            return false;
        }

        order.participants.set(userId, {
            userId,
            amountLocked: amount,
            joinedAt: Date.now(),
        });

        order.totalLocked += amount;

        if (order.totalLocked >= order.requiredThreshold) {
            this.lockBatch(batchId);
        }

        return true;
    }

    private lockBatch(batchId: string): void {
        const order = this.orders.get(batchId);
        if (order) {
            order.status = EscrowStatus.LOCKED;
        }
    }

    public executeBatch(batchId: string): boolean {
        const order = this.orders.get(batchId);
        if (!order || order.status !== EscrowStatus.LOCKED) return false;

        // Logic to trigger external payment gateway would go here
        order.status = EscrowStatus.EXECUTED;
        return true;
    }

    public expireBatch(batchId: string): void {
        const order = this.orders.get(batchId);
        if (order && order.status === EscrowStatus.PENDING) {
            order.status = EscrowStatus.EXPIRED;
            // Trigger refund logic for all participants
        }
    }

    public getBatch(batchId: string): BatchOrder | undefined {
        return this.orders.get(batchId);
    }

    private generateBatchId(): string {
        return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
}
