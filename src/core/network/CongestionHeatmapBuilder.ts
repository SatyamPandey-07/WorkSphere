/**
 * CongestionHeatmapBuilder.ts
 * Aggregates P2P test results to identify localized network dead-zones or congested access points within the venue.
 * Maps speed test results to physical coordinates to generate a spatial congestion heatmap.
 */

export interface SpatialSpeedResult {
    x: number;
    y: number;
    downloadSpeedMbps: number;
    uploadSpeedMbps: number;
    timestamp: number;
    nodeId?: string;
    routingTable?: Record<string, string[]>;
}

export class CongestionHeatmapBuilder {
    private static readonly STALE_NODE_TIMEOUT_MS = 15000;

    private gridSize: number;
    private dataPoints: Map<string, SpatialSpeedResult[]>;
    private nodeHeartbeats: Map<string, number>;
    private routingTable: Map<string, Set<string>>;

    constructor(gridSize: number = 5) {
        this.gridSize = gridSize;
        this.dataPoints = new Map();
        this.nodeHeartbeats = new Map();
        this.routingTable = new Map();
    }

    public addDataPoint(point: SpatialSpeedResult): void {
        if (point.nodeId) {
            this.recordNodeHeartbeat(point.nodeId, point.timestamp);
        }
        if (point.routingTable) {
            this.updateRoutingTable(point.routingTable);
        }

        const gridKey = this.getGridKey(point.x, point.y);
        if (!this.dataPoints.has(gridKey)) {
            this.dataPoints.set(gridKey, []);
        }
        this.dataPoints.get(gridKey)!.push(point);
    }

    public recordNodeHeartbeat(nodeId: string, timestamp: number = Date.now()): void {
        if (!nodeId.trim() || !Number.isFinite(timestamp)) {
            throw new RangeError('Node ID and heartbeat timestamp must be valid.');
        }
        const lastHeartbeat = this.nodeHeartbeats.get(nodeId);
        if (lastHeartbeat === undefined || timestamp > lastHeartbeat) {
            this.nodeHeartbeats.set(nodeId, timestamp);
        }
    }

    public updateRoutingTable(routingTable: Record<string, string[]>): void {
        for (const [nodeId, nextHops] of Object.entries(routingTable)) {
            this.routingTable.set(nodeId, new Set(nextHops));
        }
    }

    public getActiveRoutingTable(now: number = Date.now()): Record<string, string[]> {
        const activeNodeIds = this.getActiveNodeIds(now);
        const activeRoutingTable: Record<string, string[]> = Object.create(null);

        for (const [nodeId, nextHops] of this.routingTable) {
            if (activeNodeIds.has(nodeId)) {
                activeRoutingTable[nodeId] = Array.from(nextHops)
                    .filter(nextHop => activeNodeIds.has(nextHop));
            }
        }

        return activeRoutingTable;
    }

    public getRoute(fromNodeId: string, toNodeId: string, now: number = Date.now()): string[] | null {
        if (!Number.isFinite(now)) {
            throw new RangeError('Current time must be a finite timestamp.');
        }

        const activeRoutingTable = this.getActiveRoutingTable(now);
        if (!activeRoutingTable[fromNodeId] || !activeRoutingTable[toNodeId]) {
            return null;
        }

        const queue = [fromNodeId];
        const previousNode = new Map<string, string | null>([[fromNodeId, null]]);

        while (queue.length > 0) {
            const currentNodeId = queue.shift()!;
            if (currentNodeId === toNodeId) {
                const route: string[] = [];
                let nodeId: string | null = toNodeId;
                while (nodeId !== null) {
                    route.unshift(nodeId);
                    nodeId = previousNode.get(nodeId) ?? null;
                }
                return route;
            }

            for (const nextHop of activeRoutingTable[currentNodeId] ?? []) {
                if (!previousNode.has(nextHop)) {
                    previousNode.set(nextHop, currentNodeId);
                    queue.push(nextHop);
                }
            }
        }

        return null;
    }

    public generateHeatmapData(now: number = Date.now()): { x: number; y: number; value: number }[] {
        const activeNodeIds = this.getActiveNodeIds(now);
        const heatmapData: { x: number; y: number; value: number }[] = [];

        for (const [key, points] of this.dataPoints.entries()) {
            const currentPoints = points.filter(point => {
                if (!point.nodeId) {
                    return true;
                }
                return activeNodeIds.has(point.nodeId) &&
                    now >= point.timestamp &&
                    now - point.timestamp <= CongestionHeatmapBuilder.STALE_NODE_TIMEOUT_MS;
            });
            if (currentPoints.length === 0) {
                continue;
            }
            const [gridX, gridY] = key.split(',').map(Number);
            const centerX = gridX * this.gridSize + this.gridSize / 2;
            const centerY = gridY * this.gridSize + this.gridSize / 2;

            const avgSpeed = currentPoints.reduce((sum, p) => sum + p.downloadSpeedMbps, 0) / currentPoints.length;

            heatmapData.push({
                x: centerX,
                y: centerY,
                value: avgSpeed
            });
        }

        return heatmapData;
    }

    private getGridKey(x: number, y: number): string {
        const gridX = Math.floor(x / this.gridSize);
        const gridY = Math.floor(y / this.gridSize);
        return `${gridX},${gridY}`;
    }

    private getActiveNodeIds(now: number): Set<string> {
        if (!Number.isFinite(now)) {
            throw new RangeError('Current time must be a finite timestamp.');
        }

        const activeNodeIds = new Set<string>();
        for (const [nodeId, lastHeartbeat] of this.nodeHeartbeats) {
            if (now >= lastHeartbeat && now - lastHeartbeat <= CongestionHeatmapBuilder.STALE_NODE_TIMEOUT_MS) {
                activeNodeIds.add(nodeId);
            }
        }
        return activeNodeIds;
    }

    public identifyDeadZones(thresholdMbps: number = 5): { x: number; y: number }[] {
        const deadZones: { x: number; y: number }[] = [];
        const heatmap = this.generateHeatmapData();

        for (const point of heatmap) {
            if (point.value < thresholdMbps) {
                deadZones.push({ x: point.x, y: point.y });
            }
        }

        return deadZones;
    }
}
