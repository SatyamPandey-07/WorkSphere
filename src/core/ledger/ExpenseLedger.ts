/**
 * ExpenseLedger.ts
 * Manages the immutable, append-only log of all issued cards, 
 * authorizations, and final reconciled corporate expenses.
 */

export interface LedgerEntry {
    hash: string;
    previousHash: string;
    timestamp: number;
    type: 'CARD_ISSUED' | 'AUTHORIZATION' | 'SETTLEMENT' | 'RECONCILIATION';
    data: any;
}

export class ExpenseLedger {
    private chain: LedgerEntry[] = [];
    private currentIndex: number = 0;

    constructor() {
        // Genesis block
        this.appendEntry('GENESIS', 'SYSTEM_INIT', { version: '1.0.0' });
    }

    public appendEntry(type: LedgerEntry['type'], referenceId: string, data: any): LedgerEntry {
        const previousHash = this.chain.length > 0 ? this.chain[this.chain.length - 1].hash : '0';

        const entry: LedgerEntry = {
            hash: '', // Calculated below
            previousHash,
            timestamp: Date.now(),
            type,
            data: { referenceId, ...data }
        };

        entry.hash = this.calculateHash(entry);
        this.chain.push(entry);
        this.currentIndex++;

        return entry;
    }

    private calculateHash(entry: LedgerEntry): string {
        const payload = `${entry.previousHash}${entry.timestamp}${entry.type}${JSON.stringify(entry.data)}`;

        // Simple deterministic hash for demo. In production, use SHA-256.
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            const char = payload.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }

        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    public verifyChainIntegrity(): boolean {
        for (let i = 1; i < this.chain.length; i++) {
            const current = this.chain[i];
            const previous = this.chain[i - 1];

            if (current.previousHash !== previous.hash) {
                console.error(`[Ledger] Chain broken at index ${i}`);
                return false;
            }

            const recalculatedHash = this.calculateHash(current);
            if (current.hash !== recalculatedHash) {
                console.error(`[Ledger] Data tampered at index ${i}`);
                return false;
            }
        }
        return true;
    }

    public getEntriesByType(type: LedgerEntry['type']): LedgerEntry[] {
        return this.chain.filter(e => e.type === type);
    }

    public getEntriesByReference(referenceId: string): LedgerEntry[] {
        return this.chain.filter(e => e.data.referenceId === referenceId);
    }

    public getTotalSpend(): number {
        return this.chain
            .filter(e => e.type === 'SETTLEMENT')
            .reduce((sum, e) => sum + (e.data.amount || 0), 0);
    }

    public getLedgerLength(): number {
        return this.chain.length;
    }
}
