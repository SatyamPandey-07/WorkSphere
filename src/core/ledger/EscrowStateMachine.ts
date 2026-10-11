/**
 * EscrowStateMachine.ts
 * Defines the strict state transitions for a booking (FUNDED -> CHECKED_IN -> COMPLETED -> REFUNDED).
 * Ensures deterministic financial handling without manual intervention.
 */

export type EscrowState = 'FUNDED' | 'CHECKED_IN' | 'COMPLETED' | 'REFUNDED' | 'DISPUTED';

export interface EscrowContext {
    bookingId: string;
    userId: string;
    venueId: string;
    amount: number;
    state: EscrowState;
    fundedAt: number;
    checkedInAt?: number;
    completedAt?: number;
    refundedAt?: number;
    slaBreached: boolean;
}

export class EscrowStateMachine {
    private context: EscrowContext;

    constructor(initialContext: EscrowContext) {
        this.context = initialContext;
    }

    public getContext(): EscrowContext {
        return { ...this.context };
    }

    public checkIn(): boolean {
        if (this.context.state !== 'FUNDED') {
            console.warn(`Cannot check in. Current state: ${this.context.state}`);
            return false;
        }

        // Check if check-in is within the allowed window (e.g., 30 minutes of booking)
        const timeSinceFunded = Date.now() - this.context.fundedAt;
        if (timeSinceFunded > 30 * 60 * 1000) {
            console.warn('Check-in window expired. Triggering refund.');
            this.triggerRefund('CHECK_IN_TIMEOUT');
            return false;
        }

        this.context.state = 'CHECKED_IN';
        this.context.checkedInAt = Date.now();
        return true;
    }

    public complete(): boolean {
        if (this.context.state !== 'CHECKED_IN') {
            console.warn(`Cannot complete. Current state: ${this.context.state}`);
            return false;
        }

        if (this.context.slaBreached) {
            console.warn('SLA breached during booking. Triggering refund.');
            this.triggerRefund('SLA_BREACH');
            return false;
        }

        this.context.state = 'COMPLETED';
        this.context.completedAt = Date.now();
        return true;
    }

    public triggerRefund(reason: 'CHECK_IN_TIMEOUT' | 'SLA_BREACH' | 'USER_REQUEST'): boolean {
        if (this.context.state === 'REFUNDED' || this.context.state === 'COMPLETED') {
            console.warn(`Cannot refund. Current state: ${this.context.state}`);
            return false;
        }

        this.context.state = 'REFUNDED';
        this.context.refundedAt = Date.now();
        console.log(`Refund triggered for booking ${this.context.bookingId}. Reason: ${reason}`);
        return true;
    }

    public flagSLABreach(): void {
        this.context.slaBreached = true;
        if (this.context.state === 'CHECKED_IN') {
            this.triggerRefund('SLA_BREACH');
        }
    }
}
