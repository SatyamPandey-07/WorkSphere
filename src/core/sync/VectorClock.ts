/**
 * Implements the vector clock data structure to track causal relationships 
 * and partial ordering of distributed state mutations.
 */

export type ClockMap = Record<string, number>;

export class VectorClock {
    private clock: ClockMap;
    private nodeId: string;

    constructor(nodeId: string, initialClock: ClockMap = {}) {
        this.nodeId = nodeId;
        this.clock = { ...initialClock };
        if (!this.clock[this.nodeId]) {
            this.clock[this.nodeId] = 0;
        }
    }

    /**
     * Increments the local node's counter. Called before a local mutation.
     */
    public increment(): ClockMap {
        this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
        return this.getClock();
    }

    /**
     * Merges an incoming vector clock from another node.
     * Takes the maximum value for each known node ID.
     */
    public merge(incomingClock: ClockMap): void {
        const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(incomingClock)]);

        for (const node of allNodes) {
            const localVal = this.clock[node] || 0;
            const incomingVal = incomingClock[node] || 0;
            this.clock[node] = Math.max(localVal, incomingVal);
        }

        // After merging, increment local node to reflect the receipt event
        this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
    }

    /**
     * Determines the causal relationship between this clock and another.
     * Returns: 'BEFORE', 'AFTER', 'CONCURRENT', or 'EQUAL'
     */
    public compareTo(otherClock: ClockMap): 'BEFORE' | 'AFTER' | 'CONCURRENT' | 'EQUAL' {
        const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);

        let isLess = false;
        let isGreater = false;

        for (const node of allNodes) {
            const localVal = this.clock[node] || 0;
            const otherVal = otherClock[node] || 0;

            if (localVal < otherVal) isLess = true;
            if (localVal > otherVal) isGreater = true;

            if (isLess && isGreater) return 'CONCURRENT';
        }

        if (isLess) return 'BEFORE';
        if (isGreater) return 'AFTER';
        return 'EQUAL';
    }

    public getClock(): ClockMap {
        return { ...this.clock };
    }

    public getNodeId(): string {
        return this.nodeId;
    }
}
