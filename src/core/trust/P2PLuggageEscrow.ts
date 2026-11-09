/**
 * @file P2PLuggageEscrow.ts
 * @description Manages the lifecycle of storage deposits in a peer-to-peer trust network.
 * Implements a strict state machine to lock funds until the user successfully retrieves 
 * their luggage and confirms its condition, preventing host fraud.
 */

export enum EscrowState {
    PROPOSED = 'PROPOSED',
    FUNDED = 'FUNDED',
    STORAGE_ACTIVE = 'STORAGE_ACTIVE',
    RETRIEVAL_INITIATED = 'RETRIEVAL_INITIATED',
    COMPLETED = 'COMPLETED',
    DISPUTED = 'DISPUTED',
    REFUNDED = 'REFUNDED',
}

export interface EscrowRecord {
    id: string;
    guestId: string;
    hostId: string;
    lockerId: string;
    amount: number;
    currency: string;
    state: EscrowState;
    createdAt: number;
    fundedAt?: number;
    completedAt?: number;
    disputeReason?: string;
    multiSigApprovals: string[];
}

export class P2PLuggageEscrow {
    private ledger: Map<string, EscrowRecord>;
    private requiredApprovals: number;

    constructor(requiredApprovals: number = 2) {
        this.ledger = new Map();
        this.requiredApprovals = requiredApprovals;
    }

    public proposeEscrow(guestId: string, hostId: string, lockerId: string, amount: number, currency: string): EscrowRecord {
        const id = crypto.randomUUID();
        const record: EscrowRecord = {
            id,
            guestId,
            hostId,
            lockerId,
            amount,
            currency,
            state: EscrowState.PROPOSED,
            createdAt: Date.now(),
            multiSigApprovals: [],
        };
        this.ledger.set(id, record);
        return record;
    }

    public fundEscrow(escrowId: string, transactionHash: string): EscrowRecord {
        const record = this.getRecord(escrowId);
        if (record.state !== EscrowState.PROPOSED) {
            throw new Error(`Cannot fund escrow in state ${record.state}`);
        }
        record.state = EscrowState.FUNDED;
        record.fundedAt = Date.now();
        record.multiSigApprovals.push(`GUEST_FUND:${transactionHash}`);
        return record;
    }

    public activateStorage(escrowId: string, hostSignature: string): EscrowRecord {
        const record = this.getRecord(escrowId);
        if (record.state !== EscrowState.FUNDED) {
            throw new Error(`Cannot activate storage in state ${record.state}`);
        }
        record.state = EscrowState.STORAGE_ACTIVE;
        record.multiSigApprovals.push(`HOST_ACTIVATE:${hostSignature}`);
        return record;
    }

    public initiateRetrieval(escrowId: string, guestSignature: string): EscrowRecord {
        const record = this.getRecord(escrowId);
        if (record.state !== EscrowState.STORAGE_ACTIVE) {
            throw new Error(`Cannot initiate retrieval in state ${record.state}`);
        }
        record.state = EscrowState.RETRIEVAL_INITIATED;
        record.multiSigApprovals.push(`GUEST_RETRIEVE:${guestSignature}`);
        return record;
    }

    public completeEscrow(escrowId: string, hostReleaseSig: string): EscrowRecord {
        const record = this.getRecord(escrowId);
        if (record.state !== EscrowState.RETRIEVAL_INITIATED) {
            throw new Error(`Cannot complete escrow in state ${record.state}`);
        }

        record.multiSigApprovals.push(`HOST_RELEASE:${hostReleaseSig}`);

        if (record.multiSigApprovals.length >= this.requiredApprovals + 2) {
            record.state = EscrowState.COMPLETED;
            record.completedAt = Date.now();
        }

        return record;
    }

    public disputeEscrow(escrowId: string, disputerId: string, reason: string): EscrowRecord {
        const record = this.getRecord(escrowId);
        if (record.state === EscrowState.COMPLETED || record.state === EscrowState.REFUNDED) {
            throw new Error('Cannot dispute a finalized escrow');
        }
        if (disputerId !== record.guestId && disputerId !== record.hostId) {
            throw new Error('Unauthorized disputer');
        }
        record.state = EscrowState.DISPUTED;
        record.disputeReason = reason;
        return record;
    }

    private getRecord(escrowId: string): EscrowRecord {
        const record = this.ledger.get(escrowId);
        if (!record) throw new Error('Escrow record not found');
        return record;
    }

    public getActiveEscrowsForUser(userId: string): EscrowRecord[] {
        const results: EscrowRecord[] = [];
        for (const record of this.ledger.values()) {
            if ((record.guestId === userId || record.hostId === userId) &&
                record.state !== EscrowState.COMPLETED &&
                record.state !== EscrowState.REFUNDED) {
                results.push(record);
            }
        }
        return results;
    }
}
