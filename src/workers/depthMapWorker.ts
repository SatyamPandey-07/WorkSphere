/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface Point3D {
    x: number;
    y: number;
    z: number;
    confidence: number;
}

interface VoxelGrid {
    size: number;
    resolution: number;
    cells: Map<string, Point3D[]>;
}

let voxelGrid: VoxelGrid | null = null;

function initVoxelGrid(size: number, resolution: number) {
    voxelGrid = {
        size,
        resolution,
        cells: new Map(),
    };
}

function getVoxelKey(x: number, y: number, z: number): string {
    if (!voxelGrid) return '';
    const res = voxelGrid.resolution;
    const vx = Math.floor(x / res);
    const vy = Math.floor(y / res);
    const vz = Math.floor(z / res);
    return `${vx},${vy},${vz}`;
}

function downsamplePointCloud(points: Point3D[]): Point3D[] {
    if (!voxelGrid) return points;

    voxelGrid.cells.clear();

    for (const point of points) {
        const key = getVoxelKey(point.x, point.y, point.z);
        if (!voxelGrid.cells.has(key)) {
            voxelGrid.cells.set(key, []);
        }
        voxelGrid.cells.get(key)!.push(point);
    }

    const downsampled: Point3D[] = [];

    for (const cellPoints of voxelGrid.cells.values()) {
        if (cellPoints.length === 0) continue;

        let sumX = 0, sumY = 0, sumZ = 0, sumConf = 0;
        let maxConf = 0;

        for (const p of cellPoints) {
            sumX += p.x;
            sumY += p.y;
            sumZ += p.z;
            sumConf += p.confidence;
            if (p.confidence > maxConf) maxConf = p.confidence;
        }

        const count = cellPoints.length;
        downsampled.push({
            x: sumX / count,
            y: sumY / count,
            z: sumZ / count,
            confidence: maxConf,
        });
    }

    return downsampled;
}

function calculateGeometricAngles(points: Point3D[]): any {
    if (points.length < 3) return null;

    const groundPoints = points.filter(p => p.y < -0.5 && p.confidence > 0.8);
    if (groundPoints.length < 10) return { deskHeight: null, monitorAngle: null };

    let sumY = 0;
    for (const p of groundPoints) sumY += p.y;
    const deskHeight = sumY / groundPoints.length;

    const monitorPoints = points.filter(p => p.y > deskHeight + 0.2 && p.y < deskHeight + 0.8 && p.z < -0.3);
    let monitorAngle = null;

    if (monitorPoints.length > 5) {
        let sumZ = 0, sumY = 0;
        for (const p of monitorPoints) {
            sumZ += p.z;
            sumY += p.y;
        }
        const avgZ = sumZ / monitorPoints.length;
        const avgY = sumY / monitorPoints.length;
        monitorAngle = Math.atan2(avgY - deskHeight, Math.abs(avgZ)) * (180 / Math.PI);
    }

    return { deskHeight, monitorAngle };
}

self.onmessage = (event) => {
    const { type, payload } = event.data;

    if (type === 'INIT_GRID') {
        initVoxelGrid(payload.size, payload.resolution);
        self.postMessage({ type: 'GRID_INITIALIZED' });
    } else if (type === 'PROCESS_POINTS') {
        const points = payload.points as Point3D[];
        const downsampled = downsamplePointCloud(points);
        const metrics = calculateGeometricAngles(downsampled);

        self.postMessage({
            type: 'POINTS_PROCESSED',
            payload: {
                points: downsampled,
                metrics,
                originalCount: points.length,
                downsampledCount: downsampled.length,
            },
        });
    }
};
