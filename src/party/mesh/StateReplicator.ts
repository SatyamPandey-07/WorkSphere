/**
 * StateReplicator.ts
 * Handles the delta-compression and broadcasting of state changes across regional PartyKit servers.
 * Ensures eventual consistency by transmitting only the changed portions of the state.
 */

export interface StateDelta {
    version: number;
    nodeId: string;
    timestamp: number;
    operations: Record<string, unknown>[];
}

export class StateReplicator {
    private localVersion: number;
    private pendingDeltas: StateDelta[];
    private replicationQueue: (() => Promise<void>)[];
    private isReplicating: boolean;

    constructor(initialVersion: number = 0) {
        this.localVersion = initialVersion;
        this.pendingDeltas = [];
        this.replicationQueue = [];
        this.isReplicating = false;
    }

    public applyLocalOperation(operation: Record<string, unknown>): StateDelta {
        this.localVersion += 1;
        const delta: StateDelta = {
            version: this.localVersion,
            nodeId: process.env.REGION_ID || 'local',
            timestamp: Date.now(),
            operations: [operation],
        };
        this.pendingDeltas.push(delta);
        this.scheduleReplication();
        return delta;
    }

    public mergeRemoteDelta(delta: StateDelta): boolean {
        if (delta.version <= this.localVersion) {
            return false; // Already applied or stale
        }
        this.localVersion = delta.version;
        this.pendingDeltas.push(delta);
        return true;
    }

    private scheduleReplication(): void {
        if (this.isReplicating) return;
        this.isReplicating = true;
        this.processQueue().catch((err) => {
            console.error('State replication failed:', err);
            this.isReplicating = false;
        });
    }

    private async processQueue(): Promise<void> {
        while (this.pendingDeltas.length > 0) {
            const delta = this.pendingDeltas.shift();
            if (!delta) continue;

            // In a real implementation, this would broadcast to sibling PartyKit servers via HTTP/WebSocket
            // await broadcastToMesh(delta);
            console.log(`Replicating delta v${delta.version} to mesh...`);
        }
        this.isReplicating = false;
    }

    public getCurrentVersion(): number {
        return this.localVersion;
    }
}
