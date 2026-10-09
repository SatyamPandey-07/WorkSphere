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
}

export class CongestionHeatmapBuilder {
    private gridSize: number;
    private dataPoints: Map<string, SpatialSpeedResult[]>;

    constructor(gridSize: number = 5) {
        this.gridSize = gridSize;
        this.dataPoints = new Map();
    }

    public addDataPoint(point: SpatialSpeedResult): void {
        const gridKey = this.getGridKey(point.x, point.y);
        if (!this.dataPoints.has(gridKey)) {
            this.dataPoints.set(gridKey, []);
        }
        this.dataPoints.get(gridKey)!.push(point);
    }

    public generateHeatmapData(): { x: number; y: number; value: number }[] {
        const heatmapData: { x: number; y: number; value: number }[] = [];

        for (const [key, points] of this.dataPoints.entries()) {
            const [gridX, gridY] = key.split(',').map(Number);
            const centerX = gridX * this.gridSize + this.gridSize / 2;
            const centerY = gridY * this.gridSize + this.gridSize / 2;

            const avgSpeed = points.reduce((sum, p) => sum + p.downloadSpeedMbps, 0) / points.length;

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
