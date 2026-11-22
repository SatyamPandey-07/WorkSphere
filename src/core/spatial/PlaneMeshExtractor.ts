/**
 * @file PlaneMeshExtractor.ts
 * @description Extracts and classifies 3D planar surfaces (desks, floors, walls, ceilings)
 * from LiDAR point clouds using iterative RANSAC, 2D convex hull projections, and indexed
 * triangle mesh reconstruction for spatial digital twins.
 */

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export type Point3D = Vec3;

export interface Vec2 {
    x: number;
    y: number;
}

export interface PlaneEquation {
    a: number;
    b: number;
    c: number;
    d: number;
    normal?: [number, number, number];
}

export type SurfaceType = 'DESK' | 'FLOOR' | 'WALL' | 'CEILING' | 'UNKNOWN';

export interface TriangleMesh {
    vertices: number[]; // flat [x, y, z, x, y, z, ...]
    normals: number[];  // flat [nx, ny, nz, ...]
    indices: number[];  // triangle vertex index triplets [i0, i1, i2, ...]
}

export interface ExtractedPlane {
    planeId: string;
    surfaceType: SurfaceType;
    equation: PlaneEquation;
    center: Vec3;
    normal: Vec3;
    inliersCount: number;
    areaSqMeters: number;
    boundary2D: Vec2[];
    boundary3D: Vec3[];
    mesh: TriangleMesh;
    dimensions: {
        width: number;
        depth: number;
        height: number;
    };
    isErgonomicDesk?: boolean;
}

export type ExtractedPlaneMesh = ExtractedPlane;

export interface RansacOptions {
    distanceThreshold: number; // in meters (e.g. 0.03 m = 3 cm)
    maxIterations: number;     // RANSAC trial iterations
    minInliers: number;        // Minimum inliers to accept a plane
    maxPlanes: number;         // Maximum number of planes to extract
    /** Voxel edge length in metres. Defaults to 0.05 m. */
    voxelLeafSize?: number;
}

export class PlaneMeshExtractor {
    private options: Required<RansacOptions>;

    constructor(customOptions?: Partial<RansacOptions>) {
        this.options = {
            distanceThreshold: 0.03,
            maxIterations: 200,
            minInliers: 20,
            maxPlanes: 6,
            ...customOptions,
            voxelLeafSize: customOptions?.voxelLeafSize === undefined ? 0.05 : customOptions.voxelLeafSize
        };
        if (!Number.isFinite(this.options.voxelLeafSize) || this.options.voxelLeafSize <= 0) {
            throw new RangeError('voxelLeafSize must be a finite number greater than zero');
        }
    }

    // --- Vector Math Utilities ---

    public static dot(a: Vec3, b: Vec3): number {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    public static cross(a: Vec3, b: Vec3): Vec3 {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        };
    }

    public static norm(v: Vec3): number {
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }

    public static normalize(v: Vec3): Vec3 {
        const len = PlaneMeshExtractor.norm(v);
        if (len === 0) return { x: 0, y: 1, z: 0 };
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    }

    public static subtract(a: Vec3, b: Vec3): Vec3 {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    public static add(a: Vec3, b: Vec3): Vec3 {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }

    public static scale(v: Vec3, s: number): Vec3 {
        return { x: v.x * s, y: v.y * s, z: v.z * s };
    }

    /**
     * Replaces each occupied cubic voxel with the arithmetic centroid of its points.
     * Math.floor gives stable integer coordinates for negative values and boundaries.
     */
    public static downsamplePointCloud(points: Vec3[], leafSize: number): Vec3[] {
        if (!Number.isFinite(leafSize) || leafSize <= 0) {
            throw new RangeError('leafSize must be a finite number greater than zero');
        }
        if (points.length === 0) return [];

        interface VoxelAccumulator { x: number; y: number; z: number; count: number; }
        const voxels = new Map<string, VoxelAccumulator>();
        for (const point of points) {
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
            const voxelX = Math.floor(point.x / leafSize);
            const voxelY = Math.floor(point.y / leafSize);
            const voxelZ = Math.floor(point.z / leafSize);
            const key = `${voxelX},${voxelY},${voxelZ}`;
            const voxel = voxels.get(key);
            if (voxel) {
                voxel.x += point.x;
                voxel.y += point.y;
                voxel.z += point.z;
                voxel.count++;
            } else {
                voxels.set(key, { x: point.x, y: point.y, z: point.z, count: 1 });
            }
        }

        const downsampled: Vec3[] = new Array(voxels.size);
        let index = 0;
        for (const voxel of voxels.values()) {
            downsampled[index++] = {
                x: voxel.x / voxel.count,
                y: voxel.y / voxel.count,
                z: voxel.z / voxel.count
            };
        }
        return downsampled;
    }

    private static planeSignature(plane: PlaneEquation): string {
        const coefficients = [plane.a, plane.b, plane.c, plane.d];
        const firstSignificant = coefficients.find(value => Math.abs(value) > 1e-12) ?? 1;
        const orientation = firstSignificant < 0 ? -1 : 1;
        return coefficients.map(value => Math.round(value * orientation * 1e6)).join(',');
    }

    // --- Plane Fitting & Distance ---

    /**
     * Fits a plane equation ax + by + cz + d = 0 from 3 points.
     */
    public static fitPlaneFrom3Points(p1: Vec3, p2: Vec3, p3: Vec3): PlaneEquation | null {
        if (!p1 || !p2 || !p3) return null;
        if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p1.z) ||
            !Number.isFinite(p2.x) || !Number.isFinite(p2.y) || !Number.isFinite(p2.z) ||
            !Number.isFinite(p3.x) || !Number.isFinite(p3.y) || !Number.isFinite(p3.z)) {
            return null;
        }

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

        return { a, b, c, d, normal: [a, b, c] };
    }

    /**
     * Calculates perpendicular Euclidean distance from point to plane.
     */
    public static distanceToPlane(p: Vec3, plane: PlaneEquation): number {
        return Math.abs(plane.a * p.x + plane.b * p.y + plane.c * p.z + plane.d);
    }

    // --- RANSAC Multi-Plane Extraction ---

    /**
     * Extracts multiple planar surfaces from raw point cloud.
     */
    public extractPlanes(points: Vec3[]): ExtractedPlane[] {
        return this.extractPlanesInternal(points, true);
    }

    /** Internal baseline hook used by the benchmark without expanding the public API. */
    protected extractPlanesInternal(points: Vec3[], downsample: boolean): ExtractedPlane[] {
        const originalPoints = points.filter(point =>
            Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
        );
        let remainingOriginalPoints = [...originalPoints];
        let processedPoints = downsample
            ? PlaneMeshExtractor.downsamplePointCloud(remainingOriginalPoints, this.options.voxelLeafSize)
            : [...remainingOriginalPoints];
        if (processedPoints.length < this.options.minInliers) return [];

        const extractedPlanes: ExtractedPlane[] = [];
        let remainingPoints = processedPoints;
        const rejectedPlaneSignatures = new Set<string>();
        let candidateAttempts = 0;
        const maxCandidateAttempts = this.options.maxIterations + this.options.maxPlanes;

        let planeIdx = 0;
        while (planeIdx < this.options.maxPlanes && candidateAttempts < maxCandidateAttempts) {
            if (remainingPoints.length < this.options.minInliers) break;

            const bestResult = this.ransacSinglePlane(remainingPoints, rejectedPlaneSignatures);
            candidateAttempts++;
            if (!bestResult || bestResult.inliers.length < this.options.minInliers) break;

            // RANSAC works on voxel centroids, but geometry must retain original detail.
            const { inliers: originalInliers, nonInliers: originalNonInliers } =
                this.recoverOriginalInliers(remainingOriginalPoints, bestResult.equation);
            if (originalInliers.length < this.options.minInliers) {
                // Keep the cloud intact: candidate voxels may also contain valid points.
                // The signature prevents RANSAC from retrying the same invalid plane.
                rejectedPlaneSignatures.add(PlaneMeshExtractor.planeSignature(bestResult.equation));
                continue;
            }

            // Formulate ExtractedPlane
            const plane = this.constructPlaneData(
                `plane-${planeIdx + 1}`,
                bestResult.equation,
                originalInliers
            );
            extractedPlanes.push(plane);

            // Filter out inliers from remaining set
            remainingOriginalPoints = originalNonInliers;
            processedPoints = downsample
                ? PlaneMeshExtractor.downsamplePointCloud(remainingOriginalPoints, this.options.voxelLeafSize)
                : [...remainingOriginalPoints];
            remainingPoints = processedPoints;
            planeIdx++;
        }

        return extractedPlanes;
    }

    /** Recovers full-resolution geometry while partitioning points for the next plane. */
    protected recoverOriginalInliers(
        points: Vec3[],
        equation: PlaneEquation
    ): { inliers: Vec3[]; nonInliers: Vec3[] } {
        const inliers: Vec3[] = [];
        const nonInliers: Vec3[] = [];
        for (const point of points) {
            if (PlaneMeshExtractor.distanceToPlane(point, equation) <= this.options.distanceThreshold) {
                inliers.push(point);
            } else {
                nonInliers.push(point);
            }
        }
        return { inliers, nonInliers };
    }

    /**
     * Executes single plane RANSAC pass over input point set.
     */
    protected ransacSinglePlane(
        points: Vec3[],
        rejectedPlaneSignatures: ReadonlySet<string> = new Set()
    ): { equation: PlaneEquation; inliers: Vec3[] } | null {
        let maxInliers: Vec3[] = [];
        let bestEquation: PlaneEquation | null = null;
        const n = points.length;

        for (let iter = 0; iter < this.options.maxIterations; iter++) {
            // Select 3 random points
            const i1 = Math.floor(Math.random() * n);
            let i2 = Math.floor(Math.random() * n);
            while (i2 === i1) i2 = Math.floor(Math.random() * n);
            let i3 = Math.floor(Math.random() * n);
            while (i3 === i1 || i3 === i2) i3 = Math.floor(Math.random() * n);

            const eq = PlaneMeshExtractor.fitPlaneFrom3Points(points[i1], points[i2], points[i3]);
            if (!eq) continue;
            if (rejectedPlaneSignatures.has(PlaneMeshExtractor.planeSignature(eq))) continue;

            // Find inliers
            const inliers: Vec3[] = [];
            for (let i = 0; i < n; i++) {
                if (PlaneMeshExtractor.distanceToPlane(points[i], eq) <= this.options.distanceThreshold) {
                    inliers.push(points[i]);
                }
            }

            if (inliers.length > maxInliers.length) {
                maxInliers = inliers;
                bestEquation = eq;
            }
        }

        if (!bestEquation || maxInliers.length < this.options.minInliers) return null;
        return { equation: bestEquation, inliers: maxInliers };
    }

    /**
     * Constructs rich spatial plane metadata, 2D boundary, and triangle mesh.
     */
    private constructPlaneData(
        planeId: string,
        eq: PlaneEquation,
        inliers: Vec3[]
    ): ExtractedPlane {
        // Compute Centroid
        let sumX = 0, sumY = 0, sumZ = 0;
        for (const p of inliers) {
            sumX += p.x;
            sumY += p.y;
            sumZ += p.z;
        }
        const center: Vec3 = {
            x: sumX / inliers.length,
            y: sumY / inliers.length,
            z: sumZ / inliers.length
        };

        const normal: Vec3 = { x: eq.a, y: eq.b, z: eq.c };

        // Construct Orthonormal Basis on the Plane (u, v, normal)
        let arbitrary: Vec3 = { x: 0, y: 1, z: 0 };
        if (Math.abs(normal.y) > 0.9) arbitrary = { x: 1, y: 0, z: 0 };

        const u = PlaneMeshExtractor.normalize(PlaneMeshExtractor.cross(normal, arbitrary));
        const v = PlaneMeshExtractor.cross(normal, u);

        // Project Inliers onto 2D Plane Coordinate Frame
        const projected2D: Vec2[] = inliers.map(p => {
            const rel = PlaneMeshExtractor.subtract(p, center);
            return {
                x: PlaneMeshExtractor.dot(rel, u),
                y: PlaneMeshExtractor.dot(rel, v)
            };
        });

        // Compute 2D Convex Hull (Boundary)
        const hull2D = this.compute2DConvexHull(projected2D);
        const areaSqMeters = this.computePolygonArea(hull2D);

        // Compute Dimensions (bounding box along u and v axes)
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of projected2D) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        const width = Math.round((maxX - minX) * 100) / 100;
        const depth = Math.round((maxY - minY) * 100) / 100;

        // Unproject 2D Hull to 3D Boundary
        const boundary3D: Vec3[] = hull2D.map(p2 => {
            const worldP = PlaneMeshExtractor.add(
                center,
                PlaneMeshExtractor.add(
                    PlaneMeshExtractor.scale(u, p2.x),
                    PlaneMeshExtractor.scale(v, p2.y)
                )
            );
            return worldP;
        });

        // Triangulate into 3D Mesh
        const mesh = this.triangulateConvexHull(center, normal, boundary3D);

        // Surface Semantic Classification
        const surfaceType = this.classifySurface(normal, center.y);

        // Ergonomic validation for desks
        let isErgonomicDesk: boolean | undefined = undefined;
        if (surfaceType === 'DESK') {
            const validHeight = center.y >= 0.65 && center.y <= 0.85;
            const maxDim = Math.max(width, depth);
            const minDim = Math.min(width, depth);
            const validWidth = maxDim >= 0.70;
            const validDepth = minDim >= 0.45;
            isErgonomicDesk = validHeight && validWidth && validDepth;
        }

        return {
            planeId,
            surfaceType,
            equation: eq,
            center,
            normal,
            inliersCount: inliers.length,
            areaSqMeters: Math.round(areaSqMeters * 100) / 100,
            boundary2D: hull2D,
            boundary3D,
            mesh,
            dimensions: {
                width,
                depth,
                height: Math.round(center.y * 100) / 100
            },
            isErgonomicDesk
        };
    }

    /**
     * Classifies surface type based on surface normal orientation and elevation.
     */
    public classifySurface(normal: Vec3, elevationY: number): SurfaceType {
        const upDot = PlaneMeshExtractor.dot(normal, { x: 0, y: 1, z: 0 });

        if (Math.abs(upDot) > 0.8) {
            // Horizontal Surface
            if (elevationY < 0.35) return 'FLOOR';
            if (elevationY >= 0.60 && elevationY <= 1.05) return 'DESK';
            if (elevationY > 2.0) return 'CEILING';
            return 'UNKNOWN';
        } else if (Math.abs(upDot) < 0.3) {
            // Vertical Surface
            return 'WALL';
        }

        return 'UNKNOWN';
    }

    /**
     * 2D Convex Hull via Monotone Chain (Andrew's algorithm).
     */
    private compute2DConvexHull(points: Vec2[]): Vec2[] {
        if (points.length <= 3) return [...points];

        const sorted = [...points].sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

        const cross2D = (o: Vec2, a: Vec2, b: Vec2) =>
            (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

        // Lower hull
        const lower: Vec2[] = [];
        for (const p of sorted) {
            while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }

        // Upper hull
        const upper: Vec2[] = [];
        for (let i = sorted.length - 1; i >= 0; i--) {
            const p = sorted[i];
            while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }

        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }

    /**
     * Computes polygon area using the 2D Shoelace formula.
     */
    private computePolygonArea(polygon: Vec2[]): number {
        const n = polygon.length;
        if (n < 3) return 0;

        let area = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += polygon[i].x * polygon[j].y;
            area -= polygon[j].x * polygon[i].y;
        }
        return Math.abs(area) / 2;
    }

    /**
     * Triangulates a 3D convex boundary polygon into indexed triangle vertex arrays.
     */
    private triangulateConvexHull(center: Vec3, normal: Vec3, boundary3D: Vec3[]): TriangleMesh {
        const vertices: number[] = [];
        const normals: number[] = [];
        const indices: number[] = [];

        // Center vertex is index 0
        vertices.push(center.x, center.y, center.z);
        normals.push(normal.x, normal.y, normal.z);

        // Boundary vertices start at index 1
        for (let i = 0; i < boundary3D.length; i++) {
            const b = boundary3D[i];
            vertices.push(b.x, b.y, b.z);
            normals.push(normal.x, normal.y, normal.z);
        }

        // Triangle fan from center
        const m = boundary3D.length;
        for (let i = 0; i < m; i++) {
            const nextIdx = (i + 1) % m;
            indices.push(0, i + 1, nextIdx + 1);
        }

        return { vertices, normals, indices };
    }
}
