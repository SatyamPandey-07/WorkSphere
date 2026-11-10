/**
 * slamWorker.ts
 * Web Worker that processes heavy point-cloud data and calculates 
 * geometric transformations off the main thread.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { VoxelOctree, OctreeNode } from '../core/spatial/VoxelOctree';

interface WorkerMessage {
    type: 'PROCESS_POINTCLOUD' | 'BUILD_OCTREE' | 'QUERY_REGION' | 'CLEAR';
    payload: any;
}

let octree: VoxelOctree | null = null;

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        switch (type) {
            case 'PROCESS_POINTCLOUD':
                processPointCloud(payload);
                break;
            case 'BUILD_OCTREE':
                buildOctree(payload);
                break;
            case 'QUERY_REGION':
                queryRegion(payload);
                break;
            case 'CLEAR':
                octree = null;
                self.postMessage({ type: 'CLEARED' });
                break;
        }
    } catch (error: any) {
        self.postMessage({ type: 'ERROR', error: error.message });
    }
});

function processPointCloud(payload: { buffer: ArrayBuffer; resolution: number }) {
    const points = new Float32Array(payload.buffer);
    const pointCount = points.length / 4;

    // Apply voxel grid downsampling to reduce noise and data size
    const voxelMap = new Map<string, { x: number; y: number; z: number; count: number }>();
    const res = payload.resolution;

    for (let i = 0; i < pointCount; i++) {
        const offset = i * 4;
        const x = points[offset];
        const y = points[offset + 1];
        const z = points[offset + 2];

        const vx = Math.floor(x / res);
        const vy = Math.floor(y / res);
        const vz = Math.floor(z / res);
        const key = `${vx},${vy},${vz}`;

        if (!voxelMap.has(key)) {
            voxelMap.set(key, { x: 0, y: 0, z: 0, count: 0 });
        }

        const voxel = voxelMap.get(key)!;
        voxel.x += x;
        voxel.y += y;
        voxel.z += z;
        voxel.count++;
    }

    // Calculate centroids
    const downsampledPoints = new Float32Array(voxelMap.size * 4);
    let idx = 0;

    for (const voxel of voxelMap.values()) {
        downsampledPoints[idx] = voxel.x / voxel.count;
        downsampledPoints[idx + 1] = voxel.y / voxel.count;
        downsampledPoints[idx + 2] = voxel.z / voxel.count;
        downsampledPoints[idx + 3] = 1.0;
        idx += 4;
    }

    self.postMessage({
        type: 'POINTCLOUD_PROCESSED',
        buffer: downsampledPoints.buffer,
        pointCount: voxelMap.size
    }, [downsampledPoints.buffer]);
}

function buildOctree(payload: { buffer: ArrayBuffer; bounds: { min: number[], max: number[] } }) {
    const points = new Float32Array(payload.buffer);
    octree = new VoxelOctree(payload.bounds.min, payload.bounds.max, 8); // Max depth 8

    const pointCount = points.length / 4;
    for (let i = 0; i < pointCount; i++) {
        const offset = i * 4;
        octree.insert({
            x: points[offset],
            y: points[offset + 1],
            z: points[offset + 2]
        });
    }

    self.postMessage({
        type: 'OCTREE_BUILT',
        nodeCount: octree.getNodeCount()
    });
}

function queryRegion(payload: { center: number[], radius: number }) {
    if (!octree) {
        self.postMessage({ type: 'ERROR', error: 'Octree not initialized' });
        return;
    }

    const pointsInRegion = octree.queryRadius(payload.center, payload.radius);

    self.postMessage({
        type: 'REGION_QUERIED',
        points: pointsInRegion,
        count: pointsInRegion.length
    });
}
