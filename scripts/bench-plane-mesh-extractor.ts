/**
 * Performance Benchmark Suite for PlaneMeshExtractor (WorkSphere #8151)
 *
 * Evaluates execution runtime and memory characteristics across point cloud
 * densities: 10,000, 50,000, 100,000, 250,000, and 500,000 vertices.
 *
 * Uses deterministic synthetic point clouds with controllable inliers (desks, floors)
 * and isotropic Poisson-like outlier noise generated via pseudo-random LCG.
 */

import { PlaneMeshExtractor } from '../src/core/spatial/PlaneMeshExtractor.ts';
import type { PlaneEquation, Vec3 } from '../src/core/spatial/PlaneMeshExtractor.ts';

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
    outputPoints: number;
    baselineMedianRuntimeMs: number;
    endToEndSpeedup: number;
    voxelizationMedianRuntimeMs: number;
    ransacMedianRuntimeMs: number;
    baselineRansacMedianRuntimeMs: number;
    ransacSpeedup: number;
    recoveryMedianRuntimeMs: number;
    baselineRecoveryMedianRuntimeMs: number;
}

/** Benchmark-only adapter; protected production methods remain outside the public API. */
class BenchmarkExtractor extends PlaneMeshExtractor {
    public extractWithoutDownsampling(points: Vec3[]): unknown[] {
        return this.extractPlanesInternal(points, false);
    }

    public runSinglePlaneRansac(points: Vec3[]): { equation: PlaneEquation; inliers: Vec3[] } | null {
        return this.ransacSinglePlane(points);
    }

    public recoverOriginal(points: Vec3[], equation: PlaneEquation): void {
        this.recoverOriginalInliers(points, equation);
    }
}

function withDeterministicRandom<T>(seed: number, callback: () => T): T {
    const originalRandom = Math.random;
    let state = seed >>> 0;
    Math.random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
    try {
        return callback();
    } finally {
        Math.random = originalRandom;
    }
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

    const extractor = new BenchmarkExtractor({
        distanceThreshold: 0.03,
        maxIterations: 100, // Standard configuration for predictable benchmark passes
        minInliers: 50,
        maxPlanes: 2,
        voxelLeafSize: 0.05
    });
    const baselineExtractor = new BenchmarkExtractor({
        distanceThreshold: 0.03,
        maxIterations: 100,
        minInliers: 50,
        maxPlanes: 2,
        voxelLeafSize: 0.05
    });

    // Warm-up pass to let V8 optimize JIT compiled code paths
    const warmupCloud = generateSyntheticPointCloud(5000, 99999);
    extractor.extractPlanes(warmupCloud);

    for (const size of testSizes) {
        const repetitions = size <= 100000 ? 5 : 3;
        const timings: number[] = [];
        const baselineTimings: number[] = [];
        const voxelTimings: number[] = [];
        const ransacTimings: number[] = [];
        const baselineRansacTimings: number[] = [];
        const recoveryTimings: number[] = [];
        const baselineRecoveryTimings: number[] = [];
        let planesExtracted = 0;
        let inliersFound = 0;
        let outputPoints = 0;

        // Force GC if available or record base memory
        const baseHeap = process.memoryUsage().heapUsed;

        for (let rep = 0; rep < repetitions; rep++) {
            const cloud = generateSyntheticPointCloud(size, 100000 + size + rep * 17);

            const voxelStart = performance.now();
            const downsampled = PlaneMeshExtractor.downsamplePointCloud(cloud, 0.05);
            voxelTimings.push(performance.now() - voxelStart);

            const start = performance.now();
            const planes = withDeterministicRandom(2000 + rep, () => extractor.extractPlanes(cloud));
            const duration = performance.now() - start;
            const baselineStart = performance.now();
            withDeterministicRandom(2000 + rep, () =>
                baselineExtractor.extractWithoutDownsampling(cloud)
            );
            const baselineDuration = performance.now() - baselineStart;

            const ransacStart = performance.now();
            const optimizedRansacResult = withDeterministicRandom(3000 + rep, () =>
                extractor.runSinglePlaneRansac(downsampled)
            );
            ransacTimings.push(performance.now() - ransacStart);
            const baselineRansacStart = performance.now();
            const baselineRansacResult = withDeterministicRandom(3000 + rep, () =>
                baselineExtractor.runSinglePlaneRansac(cloud)
            );
            baselineRansacTimings.push(performance.now() - baselineRansacStart);

            if (optimizedRansacResult && baselineRansacResult) {
                const recoveryStart = performance.now();
                extractor.recoverOriginal(cloud, optimizedRansacResult.equation);
                recoveryTimings.push(performance.now() - recoveryStart);
                const baselineRecoveryStart = performance.now();
                baselineExtractor.recoverOriginal(cloud, baselineRansacResult.equation);
                baselineRecoveryTimings.push(performance.now() - baselineRecoveryStart);
            }

            timings.push(duration);
            baselineTimings.push(baselineDuration);
            outputPoints = downsampled.length;
            planesExtracted = planes.length;
            inliersFound = planes.reduce((acc, p) => acc + p.inliersCount, 0);
        }

        const endHeap = process.memoryUsage().heapUsed;

        timings.sort((a, b) => a - b);
        const medianRuntimeMs = timings[Math.floor(timings.length / 2)];
        baselineTimings.sort((a, b) => a - b);
        voxelTimings.sort((a, b) => a - b);
        ransacTimings.sort((a, b) => a - b);
        baselineRansacTimings.sort((a, b) => a - b);
        const baselineMedianRuntimeMs = baselineTimings[Math.floor(baselineTimings.length / 2)];
        const voxelizationMedianRuntimeMs = voxelTimings[Math.floor(voxelTimings.length / 2)];
        const ransacMedianRuntimeMs = ransacTimings[Math.floor(ransacTimings.length / 2)];
        const baselineRansacMedianRuntimeMs = baselineRansacTimings[Math.floor(baselineRansacTimings.length / 2)];
        recoveryTimings.sort((a, b) => a - b);
        baselineRecoveryTimings.sort((a, b) => a - b);
        const recoveryMedianRuntimeMs = recoveryTimings[Math.floor(recoveryTimings.length / 2)] ?? 0;
        const baselineRecoveryMedianRuntimeMs = baselineRecoveryTimings[Math.floor(baselineRecoveryTimings.length / 2)] ?? 0;
        const minRuntimeMs = timings[0];
        const maxRuntimeMs = timings[timings.length - 1];
        const meanRuntimeMs = timings.reduce((a, b) => a + b, 0) / timings.length;
        const variance = timings.reduce((acc, t) => acc + Math.pow(t - meanRuntimeMs, 2), 0) / timings.length;
        const stdDevRuntimeMs = Math.sqrt(variance);

        const heapUsedMb = Math.round((endHeap / (1024 * 1024)) * 100) / 100;
        const memoryDeltaMb = Math.round(((endHeap - baseHeap) / (1024 * 1024)) * 100) / 100;

        let notes = `Extracted ${planesExtracted} planes (${inliersFound} inliers); downsampling target is 60% point reduction (issue wording is ambiguous)`;
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
            notes,
            outputPoints,
            baselineMedianRuntimeMs: Math.round(baselineMedianRuntimeMs * 100) / 100,
            endToEndSpeedup: Math.round((baselineMedianRuntimeMs / medianRuntimeMs) * 100) / 100,
            voxelizationMedianRuntimeMs: Math.round(voxelizationMedianRuntimeMs * 100) / 100,
            ransacMedianRuntimeMs: Math.round(ransacMedianRuntimeMs * 100) / 100,
            baselineRansacMedianRuntimeMs: Math.round(baselineRansacMedianRuntimeMs * 100) / 100,
            ransacSpeedup: Math.round((baselineRansacMedianRuntimeMs / ransacMedianRuntimeMs) * 100) / 100,
            recoveryMedianRuntimeMs: Math.round(recoveryMedianRuntimeMs * 100) / 100,
            baselineRecoveryMedianRuntimeMs: Math.round(baselineRecoveryMedianRuntimeMs * 100) / 100
        });
    }

    return results;
}

function main(): void {
    console.log('========================================================================================');
    console.log('WorkSphere #8151: PlaneMeshExtractor voxel downsampling vs baseline benchmarks');
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
        'Output points': r.outputPoints.toLocaleString(),
        'Reduction': `${((1 - r.outputPoints / r.vertices) * 100).toFixed(1)}%`,
        'Voxelize (ms)': r.voxelizationMedianRuntimeMs.toFixed(2),
        'Baseline median (ms)': r.baselineMedianRuntimeMs.toFixed(2),
        'E2E speedup': `${r.endToEndSpeedup.toFixed(2)}x`,
        'RANSAC baseline (ms)': r.baselineRansacMedianRuntimeMs.toFixed(2),
        'RANSAC downsampled (ms)': r.ransacMedianRuntimeMs.toFixed(2),
        'RANSAC speedup': `${r.ransacSpeedup.toFixed(2)}x`,
        'Recovery (ms)': r.recoveryMedianRuntimeMs.toFixed(2),
        'Baseline recovery (ms)': r.baselineRecoveryMedianRuntimeMs.toFixed(2),
        'Heap (MB)': r.heapUsedMb,
        'Notes': r.notes
    })));
}

main();
