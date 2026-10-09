/**
 * RegionRouter.ts
 * Determines the optimal regional node for incoming client connections based on latency probes.
 * Maintains a registry of available regional endpoints and calculates round-trip times (RTT).
 */

export interface RegionNode {
    id: string;
    region: string;
    endpoint: string;
    latencyMs: number;
    lastSeen: number;
    isActive: boolean;
}

export class RegionRouter {
    private nodes: Map<string, RegionNode>;
    private probeIntervalMs: number;

    constructor(probeIntervalMs: number = 5000) {
        this.nodes = new Map();
        this.probeIntervalMs = probeIntervalMs;
    }

    public registerNode(node: RegionNode): void {
        this.nodes.set(node.id, { ...node, lastSeen: Date.now(), isActive: true });
    }

    public unregisterNode(nodeId: string): void {
        const node = this.nodes.get(nodeId);
        if (node) {
            node.isActive = false;
            this.nodes.set(nodeId, node);
        }
    }

    public updateLatency(nodeId: string, latencyMs: number): void {
        const node = this.nodes.get(nodeId);
        if (node) {
            node.latencyMs = latencyMs;
            node.lastSeen = Date.now();
            this.nodes.set(nodeId, node);
        }
    }

    public getOptimalNode(clientRegion?: string): RegionNode | null {
        const activeNodes = Array.from(this.nodes.values()).filter((n) => n.isActive);
        if (activeNodes.length === 0) return null;

        if (clientRegion) {
            const regionalNodes = activeNodes.filter((n) => n.region === clientRegion);
            if (regionalNodes.length > 0) {
                return regionalNodes.reduce((min, curr) => (curr.latencyMs < min.latencyMs ? curr : min));
            }
        }

        return activeNodes.reduce((min, curr) => (curr.latencyMs < min.latencyMs ? curr : min));
    }

    public getAllActiveNodes(): RegionNode[] {
        return Array.from(this.nodes.values()).filter((n) => n.isActive);
    }

    public checkStaleNodes(): void {
        const now = Date.now();
        for (const [id, node] of this.nodes.entries()) {
            if (node.isActive && now - node.lastSeen > this.probeIntervalMs * 3) {
                node.isActive = false;
                this.nodes.set(id, node);
            }
        }
    }
}

export const globalRegionRouter = new RegionRouter();
