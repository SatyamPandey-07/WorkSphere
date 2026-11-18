export interface Point3D {
    x: number;
    y: number;
    z: number;
}

export interface PlaneEquation {
    /** Unit normal vector [nx, ny, nz] */
    normal: [number, number, number];
    /** Signed distance scalar d in plane equation: nx*x + ny*y + nz*z + d = 0 */
    d: number;
}

export interface ExtractedPlaneMesh {
    id: string;
    equation: PlaneEquation;
    centroid: Point3D;
    inliers: Point3D[];
    inlierIndices: number[];
    /** Flat Float32Array [x0, y0, z0, ...] suitable for Three.js BufferGeometry */
    positions: Float32Array;
    /** Flat Float32Array [nx, ny, nz, ...] guaranteed free of NaN/Infinity */
    normals: Float32Array;
    areaEstimateSqMeters: number;
}

export interface RansacPlaneOptions {
    /** Maximum RANSAC iterations per plane extraction pass (default: 250) */
    maxIterations?: number;
    /** Distance threshold in meters for a point to count as an inlier (default: 0.025m = 2.5cm) */
    distanceThreshold?: number;
    /** Minimum inlier count required to accept a plane (default: 12) */
    minInliers?: number;
    /** Maximum number of distinct planes to extract sequentially (default: 6) */
    maxPlanes?: number;
    /** Minimum squared edge length in m^2 to reject duplicate/coincident points (default: 1e-8) */
    minEdgeLengthSq?: number;
    /** Relative sine threshold for collinearity: sin(theta) <= collinearitySinEpsilon (default: 1e-4) */
    collinearitySinEpsilon?: number;
    /** Optional deterministic RNG returning [0, 1) for reproducible tests */
    randomFn?: () => number;
}

const DEFAULT_MIN_EDGE_LENGTH_SQ = 1e-8;      // (0.1 mm)^2
const DEFAULT_COLLINEARITY_SIN_EPS = 1e-4;    // ~0.0057 degrees

function isFinitePoint(p: Point3D): boolean {
    return (
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.z)
    );
}

/**
 * Computes a unit plane equation from three 3D points.
 * Returns `null` immediately if any point is non-finite, coincident/identical,
 * or collinear within scale-invariant tolerance—preventing zero-vector division
 * and `[NaN, NaN, NaN]` normal corruption.
 */
export function fitPlaneFromTriplet(
    p1: Point3D,
    p2: Point3D,
    p3: Point3D,
    minEdgeLengthSq: number = DEFAULT_MIN_EDGE_LENGTH_SQ,
    collinearitySinEpsilon: number = DEFAULT_COLLINEARITY_SIN_EPS
): PlaneEquation | null {
    if (!isFinitePoint(p1) || !isFinitePoint(p2) || !isFinitePoint(p3)) {
        return null;
    }

    // Edge vectors u = p2 - p1, v = p3 - p1
    const ux = p2.x - p1.x;
    const uy = p2.y - p1.y;
    const uz = p2.z - p1.z;

    const vx = p3.x - p1.x;
    const vy = p3.y - p1.y;
    const vz = p3.z - p1.z;

    const uLenSq = ux * ux + uy * uy + uz * uz;
    const vLenSq = vx * vx + vy * vy + vz * vz;

    // Reject identical or near-coincident points
    if (uLenSq <= minEdgeLengthSq || vLenSq <= minEdgeLengthSq) {
        return null;
    }

    // Cross product n = u x v
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const crossLenSq = nx * nx + ny * ny + nz * nz;

    // Scale-invariant collinearity test:
    // ||u x v||^2 = ||u||^2 * ||v||^2 * sin^2(theta)
    // Rejects triplets lying on a single straight line regardless of scale.
    const sinThresholdSq = collinearitySinEpsilon * collinearitySinEpsilon;
    if (crossLenSq <= sinThresholdSq * uLenSq * vLenSq) {
        return null;
    }

    /**
     * Fits a plane equation ax + by + cz + d = 0 from 3 points.
     */
    public static fitPlaneFrom3Points(p1: Vec3, p2: Vec3, p3: Vec3): PlaneEquation | null {
        const v1 = PlaneMeshExtractor.subtract(p2, p1);
        const v2 = PlaneMeshExtractor.subtract(p3, p1);
        const normal = PlaneMeshExtractor.cross(v1, v2);
        const len = PlaneMeshExtractor.norm(normal);
        // RANSAC can select duplicate, collinear, nearly-collinear, or corrupt
        // points. Reject non-finite/near-zero normals before any normalization.
        if (!Number.isFinite(len) || len < 1e-6) return null;

        const a = normal.x / len;
        const b = normal.y / len;
        const c = normal.z / len;
        const d = -(a * p1.x + b * p1.y + c * p1.z);

        return { a, b, c, d };
    }

    const invLen = 1 / crossLen;
    let unitNx = nx * invLen;
    let unitNy = ny * invLen;
    let unitNz = nz * invLen;

    // Canonicalize normal orientation (+Y upward preference for floors/desks, else +Z/+X)
    if (
        unitNy < -1e-6 ||
        (Math.abs(unitNy) <= 1e-6 && unitNz < -1e-6) ||
        (Math.abs(unitNy) <= 1e-6 && Math.abs(unitNz) <= 1e-6 && unitNx < 0)
    ) {
        unitNx = -unitNx;
        unitNy = -unitNy;
        unitNz = -unitNz;
    }

    const d = -(unitNx * p1.x + unitNy * p1.y + unitNz * p1.z);

    if (!Number.isFinite(unitNx) || !Number.isFinite(unitNy) || !Number.isFinite(unitNz) || !Number.isFinite(d)) {
        return null;
    }

    return {
        normal: [unitNx, unitNy, unitNz],
        d,
    };
}

/**
 * Samples 3 distinct random indices in [0, count - 1].
 */
function sampleDistinctTripletIndices(
    count: number,
    randomFn: () => number
): [number, number, number] {
    const i1 = Math.floor(randomFn() * count);

    let i2 = Math.floor(randomFn() * (count - 1));
    if (i2 >= i1) i2 += 1;

    let i3 = Math.floor(randomFn() * (count - 2));
    const first = Math.min(i1, i2);
    const second = Math.max(i1, i2);
    if (i3 >= first) i3 += 1;
    if (i3 >= second) i3 += 1;

    return [i1, i2, i3];
}

/**
 * Refines a plane equation over its consensus inliers via covariance / Newell normal averaging,
 * falling back to the RANSAC hypothesis plane if refined points are degenerate.
 */
function refinePlaneFromInliers(
    inliers: Point3D[],
    fallbackEquation: PlaneEquation
): { equation: PlaneEquation; centroid: Point3D } {
    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (const p of inliers) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
    }

    const invCount = 1 / inliers.length;
    const centroid: Point3D = {
        x: cx * invCount,
        y: cy * invCount,
        z: cz * invCount,
    };

    // Re-anchor d to the inlier centroid using the validated unit normal
    const [nx, ny, nz] = fallbackEquation.normal;
    const refinedD = -(nx * centroid.x + ny * centroid.y + nz * centroid.z);

    if (!Number.isFinite(refinedD)) {
        return { equation: fallbackEquation, centroid };
    }

    return {
        equation: {
            normal: [nx, ny, nz],
            d: refinedD,
        },
        centroid,
    };
}

/**
 * Builds Three.js-compatible flat position and normal Float32Arrays from validated inliers.
 */
function buildMeshBuffers(
    inliers: Point3D[],
    normal: [number, number, number]
): { positions: Float32Array; normals: Float32Array } {
    const positions = new Float32Array(inliers.length * 3);
    const normals = new Float32Array(inliers.length * 3);
    const [nx, ny, nz] = normal;

    for (let i = 0; i < inliers.length; i++) {
        const offset = i * 3;
        positions[offset] = inliers[i].x;
        positions[offset + 1] = inliers[i].y;
        positions[offset + 2] = inliers[i].z;

        normals[offset] = nx;
        normals[offset + 1] = ny;
        normals[offset + 2] = nz;
    }

    return { positions, normals };
}

/**
 * Estimates bounding planar surface area (in m^2) by projecting inliers onto the plane's local 2D basis.
 */
function estimatePlanarArea(
    inliers: Point3D[],
    centroid: Point3D,
    normal: [number, number, number]
): number {
    if (inliers.length < 3) return 0;

    const [nx, ny, nz] = normal;
    // Construct orthonormal basis (tangent, bitangent) perpendicular to normal
    const refX = Math.abs(nx) < 0.9 ? 1 : 0;
    const refY = Math.abs(nx) < 0.9 ? 0 : 1;
    const refZ = 0;

    let tx = ny * refZ - nz * refY;
    let ty = nz * refX - nx * refZ;
    let tz = nx * refY - ny * refX;
    const tLen = Math.hypot(tx, ty, tz);
    if (tLen === 0) return 0;
    tx /= tLen;
    ty /= tLen;
    tz /= tLen;

    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (const p of inliers) {
        const dx = p.x - centroid.x;
        const dy = p.y - centroid.y;
        const dz = p.z - centroid.z;

        const u = dx * tx + dy * ty + dz * tz;
        const v = dx * bx + dy * by + dz * bz;

        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
    }

    return Math.max(0, (maxU - minU) * (maxV - minV));
}

export class PlaneMeshExtractor {
    /**
     * Extracts one or more planar surfaces (desks, floors, walls) from an indoor SLAM point cloud
     * using degenerate-guarded RANSAC sampling. Never emits NaN normals even on 100% collinear input.
     */
    public extractPlanes(
        rawPoints: readonly Point3D[],
        options: RansacPlaneOptions = {}
    ): ExtractedPlaneMesh[] {
        const {
            maxIterations = 250,
            distanceThreshold = 0.025,
            minInliers = 12,
            maxPlanes = 6,
            minEdgeLengthSq = DEFAULT_MIN_EDGE_LENGTH_SQ,
            collinearitySinEpsilon = DEFAULT_COLLINEARITY_SIN_EPS,
            randomFn = Math.random,
        } = options;

        // Filter out any non-finite sensor readings upfront
        const cleanPoints: Array<{ point: Point3D; originalIndex: number }> = [];
        for (let i = 0; i < rawPoints.length; i++) {
            const p = rawPoints[i];
            if (p && isFinitePoint(p)) {
                cleanPoints.push({ point: p, originalIndex: i });
            }
        }

        const effectiveMinInliers = Math.max(3, minInliers);
        if (cleanPoints.length < effectiveMinInliers) {
            return [];
        }

        const remaining = [...cleanPoints];
        const extractedPlanes: ExtractedPlaneMesh[] = [];

        for (let planeIdx = 0; planeIdx < maxPlanes; planeIdx++) {
            if (remaining.length < effectiveMinInliers) {
                break;
            }

            let bestEquation: PlaneEquation | null = null;
            let bestRemainingIndices: number[] = [];

            for (let iter = 0; iter < maxIterations; iter++) {
                const [i1, i2, i3] = sampleDistinctTripletIndices(remaining.length, randomFn);

                const candidatePlane = fitPlaneFromTriplet(
                    remaining[i1].point,
                    remaining[i2].point,
                    remaining[i3].point,
                    minEdgeLengthSq,
                    collinearitySinEpsilon
                );

                // Immediately discard collinear or identical triplets before consensus scoring
                if (!candidatePlane) {
                    continue;
                }

                const [nx, ny, nz] = candidatePlane.normal;
                const { d } = candidatePlane;
                const inlierIdxList: number[] = [];

                for (let idx = 0; idx < remaining.length; idx++) {
                    const pt = remaining[idx].point;
                    const dist = Math.abs(nx * pt.x + ny * pt.y + nz * pt.z + d);
                    if (dist <= distanceThreshold) {
                        inlierIdxList.push(idx);
                    }
                }

                if (inlierIdxList.length > bestRemainingIndices.length) {
                    bestRemainingIndices = inlierIdxList;
                    bestEquation = candidatePlane;
                }
            }

            if (!bestEquation || bestRemainingIndices.length < effectiveMinInliers) {
                break;
            }

            const inlierSet = new Set(bestRemainingIndices);
            const inliers: Point3D[] = [];
            const originalIndices: number[] = [];
            const nextRemaining: Array<{ point: Point3D; originalIndex: number }> = [];

            for (let idx = 0; idx < remaining.length; idx++) {
                if (inlierSet.has(idx)) {
                    inliers.push(remaining[idx].point);
                    originalIndices.push(remaining[idx].originalIndex);
                } else {
                    nextRemaining.push(remaining[idx]);
                }
            }

            const { equation, centroid } = refinePlaneFromInliers(inliers, bestEquation);
            const { positions, normals } = buildMeshBuffers(inliers, equation.normal);
            const areaEstimateSqMeters = estimatePlanarArea(
                inliers,
                centroid,
                equation.normal
            );

            extractedPlanes.push({
                id: `plane-${planeIdx + 1}`,
                equation,
                centroid,
                inliers,
                inlierIndices: originalIndices,
                positions,
                normals,
                areaEstimateSqMeters,
            });

            remaining.length = 0;
            remaining.push(...nextRemaining);
        }

        return extractedPlanes;
    }
}