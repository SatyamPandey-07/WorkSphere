/**
 * Performance Benchmark Suite for PlaneMeshExtractor (WorkSphere #8146)
 *
 * Evaluates execution runtime and memory characteristics across point cloud
 * densities: 10,000, 50,000, 100,000, 250,000, and 500,000 vertices.
 *
 * Uses deterministic synthetic point clouds with controllable inliers (desks, floors)
 * and isotropic Poisson-like outlier noise generated via pseudo-random LCG.
 */

import { PlaneMeshExtractor } from '../src/core/spatial/PlaneMeshExtractor.ts';
import type { Vec3 } from '../src/core/spatial/PlaneMeshExtractor.ts';

export interface BenchmarkMetrics {
    vertices: number;
    iterations: number;
    medianRuntimeMs: number;
    minRuntimeMs: number;
    maxRuntimeMs: number;
    meanRuntimeMs: number;
    stdDevRuntimeMs: number;
    planesExtracted: number;
    inliersFound: number;
    heapUsedMb: number;
    memoryDeltaMb: number;
    notes: string;
}

/**
 * Deterministic Linear Congruential Generator (LCG) for reproducible benchmarks.
 */
class DeterministicRng {
    private seed: number;

    constructor(seed = 133742) {
        this.seed = seed;
    }

    public next(): number {
        this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
        return this.seed / 4294967296;
    }

    public nextRange(min: number, max: number): number {
        return min + this.next() * (max - min);
    }
}

/**
 * Generates a synthetic point cloud with realistic desk, floor planar structures
 * and uniform spatial outliers.
 */
export function generateSyntheticPointCloud(totalVertices: number, seed = 428146): Vec3[] {
    const rng = new DeterministicRng(seed);
    const points: Vec3[] = new Array(totalVertices);

    // Distribution:
    // 35% Floor plane (y ≈ 0.05 m, bounds [-5, 5] x [-5, 5])
    // 25% Desk plane (y ≈ 0.75 m, bounds [-1.5, 1.5] x [-1, 1])
    // 40% Uniform spatial outlier volume ([-6, 6] x [-1, 3] x [-6, 6])
    const floorCount = Math.floor(totalVertices * 0.35);
    const deskCount = Math.floor(totalVertices * 0.25);
    const outlierCount = totalVertices - floorCount - deskCount;

    let idx = 0;

    // 1. Floor Inliers
    for (let i = 0; i < floorCount; i++) {
        points[idx++] = {
            x: rng.nextRange(-5.0, 5.0),
            y: 0.05 + rng.nextRange(-0.008, 0.008), // small sensor jitter
            z: rng.nextRange(-5.0, 5.0)
        };
    }

    // 2. Desk Inliers
    for (let i = 0; i < deskCount; i++) {
        points[idx++] = {
            x: rng.nextRange(-1.2, 1.2),
            y: 0.75 + rng.nextRange(-0.005, 0.005),
            z: rng.nextRange(-0.8, 0.8)
        };
    }

    // 3. Outliers / Room Clutter
    for (let i = 0; i < outlierCount; i++) {
        points[idx++] = {
            x: rng.nextRange(-6.0, 6.0),
            y: rng.nextRange(-0.5, 3.0),
            z: rng.nextRange(-6.0, 6.0)
        };
    }

    return points;
}

/**
 * Runs benchmarks across defined density configurations.
 */
export function runPlaneExtractorBenchmarks(): BenchmarkMetrics[] {
    const testSizes = [10000, 50000, 100000, 250000, 500000];
    const results: BenchmarkMetrics[] = [];

    const extractor = new PlaneMeshExtractor({
        distanceThreshold: 0.03,
        maxIterations: 100, // Standard configuration for predictable benchmark passes
        minInliers: 50,
        maxPlanes: 2
    });

    // Warm-up pass to let V8 optimize JIT compiled code paths
    const warmupCloud = generateSyntheticPointCloud(5000, 99999);
    extractor.extractPlanes(warmupCloud);

    for (const size of testSizes) {
        const repetitions = size <= 100000 ? 5 : 3;
        const timings: number[] = [];
        let planesExtracted = 0;
        let inliersFound = 0;

        // Force GC if available or record base memory
        const baseHeap = process.memoryUsage().heapUsed;

        for (let rep = 0; rep < repetitions; rep++) {
            const cloud = generateSyntheticPointCloud(size, 100000 + size + rep * 17);

            const start = performance.now();
            const planes = extractor.extractPlanes(cloud);
            const duration = performance.now() - start;

            timings.push(duration);
            planesExtracted = planes.length;
            inliersFound = planes.reduce((acc, p) => acc + p.inliersCount, 0);
        }

        const endHeap = process.memoryUsage().heapUsed;

        timings.sort((a, b) => a - b);
        const medianRuntimeMs = timings[Math.floor(timings.length / 2)];
        const minRuntimeMs = timings[0];
        const maxRuntimeMs = timings[timings.length - 1];
        const meanRuntimeMs = timings.reduce((a, b) => a + b, 0) / timings.length;
        const variance = timings.reduce((acc, t) => acc + Math.pow(t - meanRuntimeMs, 2), 0) / timings.length;
        const stdDevRuntimeMs = Math.sqrt(variance);

        const heapUsedMb = Math.round((endHeap / (1024 * 1024)) * 100) / 100;
        const memoryDeltaMb = Math.round(((endHeap - baseHeap) / (1024 * 1024)) * 100) / 100;

        let notes = `Extracted ${planesExtracted} planes (${inliersFound} inliers)`;
        if (size >= 250000) {
            notes += '; linear consensus scan dominates runtime';
        }

        results.push({
            vertices: size,
            iterations: repetitions,
            medianRuntimeMs: Math.round(medianRuntimeMs * 100) / 100,
            minRuntimeMs: Math.round(minRuntimeMs * 100) / 100,
            maxRuntimeMs: Math.round(maxRuntimeMs * 100) / 100,
            meanRuntimeMs: Math.round(meanRuntimeMs * 100) / 100,
            stdDevRuntimeMs: Math.round(stdDevRuntimeMs * 100) / 100,
            planesExtracted,
            inliersFound,
            heapUsedMb,
            memoryDeltaMb,
            notes
        });
    }

    return results;
}

function main(): void {
    console.log('========================================================================================');
    console.log('WorkSphere #8146: PlaneMeshExtractor RANSAC Spatial Segmentation Performance Benchmarks');
    console.log(`Node.js: ${process.version} | Platform: ${process.platform} ${process.arch}`);
    console.log('========================================================================================\n');

    const results = runPlaneExtractorBenchmarks();

    console.table(results.map(r => ({
        'Vertices (N)': r.vertices.toLocaleString(),
        'Repetitions': r.iterations,
        'Median (ms)': r.medianRuntimeMs.toFixed(2),
        'Min (ms)': r.minRuntimeMs.toFixed(2),
        'Max (ms)': r.maxRuntimeMs.toFixed(2),
        'StdDev (ms)': r.stdDevRuntimeMs.toFixed(2),
        'Planes': r.planesExtracted,
        'Inliers': r.inliersFound.toLocaleString(),
        'Heap (MB)': r.heapUsedMb,
        'Notes': r.notes
    })));
}

main();
