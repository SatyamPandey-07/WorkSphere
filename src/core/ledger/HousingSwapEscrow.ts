/**
 * @file HousingSwapEscrow.ts
 * @description Defines the strict lifecycle of a housing swap (PROPOSED -> FUNDED -> 
 * KEYS_EXCHANGED -> SETTLED), locking deposits until mutual confirmation. Implements
 * a deterministic state machine to prevent fraud during peer-to-peer apartment swaps.
 */

import { createHash, randomBytes } from 'crypto';

export enum SwapState {
    PROPOSED = 'PROPOSED',
    FUNDED = 'FUNDED',
    KEYS_EXCHANGED = 'KEYS_EXCHANGED',
    SETTLED = 'SETTLED',
    DISPUTED = 'DISPUTED',
    CANCELLED = 'CANCELLED',
}

export interface SwapParticipant {
    userId: string;
    propertyId: string;
    publicKey: string;
    depositAmount: number;
}

export interface SwapRecord {
    id: string;
    partyA: SwapParticipant;
    partyB: SwapParticipant;
    state: SwapState;
    startDate: number;
    endDate: number;
    createdAt: number;
    fundedAt?: number;
    keysExchangedAt?: number;
    settledAt?: number;
    disputeReason?: string;
    multiSigHashes: string[];
}

export class HousingSwapEscrow {
    private ledger: Map<string, SwapRecord>;
    private readonly lockDurationMs: number;

    constructor(lockDurationDays: number = 30) {
        this.ledger = new Map();
        this.lockDurationMs = lockDurationDays * 24 * 60 * 60 * 1000;
    }

    public proposeSwap(partyA: SwapParticipant, partyB: SwapParticipant, startDate: number, endDate: number): SwapRecord {
        if (startDate >= endDate) throw new Error('Start date must be before end date');
        if (partyA.depositAmount !== partyB.depositAmount) throw new Error('Deposits must be equal');

        const id = randomBytes(16).toString('hex');
        const record: SwapRecord = {
            id,
            partyA,
            partyB,
            state: SwapState.PROPOSED,
            startDate,
            endDate,
            createdAt: Date.now(),
            multiSigHashes: [],
        };

        this.ledger.set(id, record);
        return record;
    }

    public fundSwap(swapId: string, userId: string, txHash: string): SwapRecord {
        const record = this.getRecord(swapId);
        if (record.state !== SwapState.PROPOSED && record.state !== SwapState.FUNDED) {
            throw new Error(`Cannot fund swap in state ${record.state}`);
        }

        const participant = this.getParticipant(record, userId);
        const hash = this.hashTransaction(txHash, participant.userId);

        if (!record.multiSigHashes.includes(hash)) {
            record.multiSigHashes.push(hash);
        }

        if (record.multiSigHashes.length >= 2) {
            record.state = SwapState.FUNDED;
            record.fundedAt = Date.now();
        }

        return record;
    }

    public confirmKeyExchange(swapId: string, userId: string, digitalKeySig: string): SwapRecord {
        const record = this.getRecord(swapId);
        if (record.state !== SwapState.FUNDED) {
            throw new Error(`Cannot exchange keys in state ${record.state}`);
        }

        const participant = this.getParticipant(record, userId);
        const hash = this.hashTransaction(digitalKeySig, participant.userId);

        if (!record.multiSigHashes.includes(hash)) {
            record.multiSigHashes.push(hash);
        }

        if (record.multiSigHashes.length >= 4) {
            record.state = SwapState.KEYS_EXCHANGED;
            record.keysExchangedAt = Date.now();
        }

        return record;
    }

    public settleSwap(swapId: string, userId: string, confirmationSig: string): SwapRecord {
        const record = this.getRecord(swapId);
        if (record.state !== SwapState.KEYS_EXCHANGED) {
            throw new Error(`Cannot settle swap in state ${record.state}`);
        }

        const participant = this.getParticipant(record, userId);
        const hash = this.hashTransaction(confirmationSig, participant.userId);

        if (!record.multiSigHashes.includes(hash)) {
            record.multiSigHashes.push(hash);
        }

        if (record.multiSigHashes.length >= 6) {
            record.state = SwapState.SETTLED;
            record.settledAt = Date.now();
        }

        return record;
    }

    public disputeSwap(swapId: string, userId: string, reason: string): SwapRecord {
        const record = this.getRecord(swapId);
        if (record.state === SwapState.SETTLED || record.state === SwapState.CANCELLED) {
            throw new Error('Cannot dispute a finalized or cancelled swap');
        }

        this.getParticipant(record, userId); // Verify user is part of swap
        record.state = SwapState.DISPUTED;
        record.disputeReason = reason;
        return record;
    }

    private getRecord(swapId: string): SwapRecord {
        const record = this.ledger.get(swapId);
        if (!record) throw new Error('Swap record not found');
        return record;
    }

    private getParticipant(record: SwapRecord, userId: string): SwapParticipant {
        if (record.partyA.userId === userId) return record.partyA;
        if (record.partyB.userId === userId) return record.partyB;
        throw new Error('User is not a participant in this swap');
    }

    private hashTransaction(data: string, userId: string): string {
        return createHash('sha256').update(data).update(userId).digest('hex');
    }

    public getActiveSwaps(userId: string): SwapRecord[] {
        const active: SwapRecord[] = [];
        for (const record of this.ledger.values()) {
            if ((record.partyA.userId === userId || record.partyB.userId === userId) &&
                record.state !== SwapState.SETTLED && record.state !== SwapState.CANCELLED) {
                active.push(record);
            }
        }
        return active;
    }
}
