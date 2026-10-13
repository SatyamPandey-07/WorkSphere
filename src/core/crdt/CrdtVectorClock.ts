/**
 * CrdtVectorClock.ts
 * Vector clock logic for tracking causal history and resolving merge conflicts.
 * Ensures that concurrent edits from multiple users are ordered deterministically.
 * Follows Lamport timestamp ordering to resolve desynchronization during rapid reconnects (#5277).
 */

export type VectorClock = Record<string, number>;

export class CrdtVectorClock {
    private clock: VectorClock;

    constructor(initialClock: VectorClock = {}) {
        this.clock = { ...initialClock };
    }

    public increment(nodeId: string): void {
        this.clock[nodeId] = (this.clock[nodeId] || 0) + 1;
    }

    public getClock(): VectorClock {
        return { ...this.clock };
    }

    public merge(otherClock: VectorClock): void {
        for (const [nodeId, time] of Object.entries(otherClock)) {
            this.clock[nodeId] = Math.max(this.clock[nodeId] || 0, time);
        }
    }

    /**
     * Calculates the scalar Lamport logical timestamp (total event tick sum) for this vector clock.
     */
    public getLamportTime(): number {
        return Object.values(this.clock).reduce((sum, time) => sum + (time || 0), 0);
    }

    /**
     * Static helper to compute the Lamport timestamp sum for any vector clock record.
     */
    public static getLamportTime(clock: VectorClock): number {
        return Object.values(clock).reduce((sum, time) => sum + (time || 0), 0);
    }

    /**
     * Compares two vector clocks.
     * Strictly follows Lamport timestamp ordering when clocks are concurrent (#5277)
     * to deterministically reconcile operations even when clocks have skipped ticks.
     */
    public compare(otherClock: VectorClock): 'before' | 'after' | 'concurrent' | 'equal' {
        let isBefore = false;
        let isAfter = false;

        const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);

        for (const nodeId of allNodes) {
            const time1 = this.clock[nodeId] || 0;
            const time2 = otherClock[nodeId] || 0;

            if (time1 < time2) isBefore = true;
            if (time1 > time2) isAfter = true;
        }

        if (!isBefore && !isAfter) return 'equal';
        if (isBefore && !isAfter) return 'before';
        if (isAfter && !isBefore) return 'after';

        // Concurrent in partial order (isBefore && isAfter):
        // Follow Lamport timestamp ordering to deterministically order operations across skipped ticks
        const lamport1 = this.getLamportTime();
        const lamport2 = CrdtVectorClock.getLamportTime(otherClock);

        if (lamport1 < lamport2) return 'before';
        if (lamport1 > lamport2) return 'after';

        return 'concurrent';
    }

    public static serialize(clock: VectorClock): string {
        return JSON.stringify(clock);
    }

    public static deserialize(serialized: string): VectorClock {
        try {
            return JSON.parse(serialized);
        } catch {
            return {};
        }
    }
}
