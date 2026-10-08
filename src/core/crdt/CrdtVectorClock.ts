/**
 * CrdtVectorClock.ts
 * Vector clock logic for tracking causal history and resolving merge conflicts.
 * Ensures that concurrent edits from multiple users are ordered deterministically.
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

    public compare(otherClock: VectorClock): 'before' | 'after' | 'concurrent' {
        let isBefore = false;
        let isAfter = false;

        const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);

        for (const nodeId of allNodes) {
            const time1 = this.clock[nodeId] || 0;
            const time2 = otherClock[nodeId] || 0;

            if (time1 < time2) isBefore = true;
            if (time1 > time2) isAfter = true;
        }

        if (isBefore && !isAfter) return 'before';
        if (isAfter && !isBefore) return 'after';
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
