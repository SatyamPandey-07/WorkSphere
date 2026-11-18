/**
 * @file PlaneMeshExtractor.ts
 * @description Extracts and classifies 3D planar surfaces (desks, floors, walls, ceilings)
 * from LiDAR point clouds using iterative RANSAC, 2D convex hull projections, and indexed
 * triangle mesh reconstruction for spatial digital twins.
 *
 * Mathematical Foundations & Algorithm Flow:
 * 1. 3D Plane Parameterization: Represented in standard Cartesian normal form
 *    $P(x, y, z): ax + by + cz + d = 0$, constrained such that the unit normal
 *    $\mathbf{n} = (a, b, c)^T$ satisfies $\|\mathbf{n}\|_2 = \sqrt{a^2 + b^2 + c^2} = 1$.
 * 2. Minimal Sample Hypothesis Generation: Randomly samples $M = 3$ non-collinear
 *    points $(p_1, p_2, p_3)$ to compute the cross product $(p_2 - p_1) \times (p_3 - p_1)$
 *    and plane offset $d = -\mathbf{n} \cdot p_1$. Degenerate samples with $\|\mathbf{n}\|_2 < 10^{-6}$
 *    are discarded.
 * 3. Inlier Classification & Consensus: Given distance threshold $\tau > 0$ (default $0.03\,\text{m}$),
 *    evaluates orthogonal Euclidean point-to-plane distance $|ax + by + cz + d| \le \tau$.
 * 4. Multi-Plane Extraction via Sequential Depletion: Greedily discovers the dominant consensus
 *    plane, constructs geometric descriptors, removes inlier points from the active cloud,
 *    and repeats up to `maxPlanes` or until remaining points fall below `minInliers`.
 * 5. Spatial Indexing Status: RANSAC consensus traversal currently evaluates points linearly
 *    with time complexity $\mathcal{O}(K \cdot N)$. Spatial partitioning structures (such as
 *    Bounding Volume Hierarchies or octrees) are not currently implemented for point querying in this class.
 */

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Vec2 {
    x: number;
    y: number;
}

/**
 * Standard Hessian normal form plane equation: ax + by + cz + d = 0.
 * In this implementation, the normal vector (a, b, c) is normalized to unit length,
 * meaning a^2 + b^2 + c^2 = 1.
 */
export interface PlaneEquation {
    /** Component along X axis of the unit normal vector */
    a: number;
    /** Component along Y axis of the unit normal vector */
    b: number;
    /** Component along Z axis of the unit normal vector */
    c: number;
    /** Constant offset parameter representing signed perpendicular distance from the world origin to the plane */
    d: number;
}

/**
 * Semantic classification categories for detected planar surfaces.
 */
export type SurfaceType = 'DESK' | 'FLOOR' | 'WALL' | 'CEILING' | 'UNKNOWN';

/**
 * Indexed triangle mesh representation of an extracted planar polygon.
 */
export interface TriangleMesh {
    /** Flat array of vertex coordinates: [x0, y0, z0, x1, y1, z1, ...] */
    vertices: number[];
    /** Flat array of normal vectors corresponding to each vertex: [nx0, ny0, nz0, ...] */
    normals: number[];
    /** Triangle vertex index triplets forming indexed faces: [i0, i1, i2, ...] */
    indices: number[];
}

/**
 * Complete metadata and geometric representation of a segmented 3D planar surface.
 */
export interface ExtractedPlane {
    /** Unique identifier assigned to the extracted plane (e.g., 'plane-1') */
    planeId: string;
    /** Semantic classification tag inferred from normal orientation and elevation */
    surfaceType: SurfaceType;
    /** Normalized plane equation parameters ax + by + cz + d = 0 */
    equation: PlaneEquation;
    /** Geometric centroid (center of mass) of the classified inlier points */
    center: Vec3;
    /** Unit surface normal vector oriented upward for horizontal surfaces */
    normal: Vec3;
    /** Number of points in the point cloud classified as inliers for this plane */
    inliersCount: number;
    /** 2D polygonal surface area in square meters computed via Shoelace formula */
    areaSqMeters: number;
    /** 2D convex hull vertices projected onto the local orthonormal tangent frame */
    boundary2D: Vec2[];
    /** 3D boundary polygon vertices in world coordinates */
    boundary3D: Vec3[];
    /** Indexed triangle mesh synthesized via triangle fan from centroid */
    mesh: TriangleMesh;
    /** Bounding dimensions (width, depth, height) in meters */
    dimensions: {
        width: number;
        depth: number;
        height: number;
    };
    /** Optional ergonomics compliance flag for surfaces classified as DESK */
    isErgonomicDesk?: boolean;
}

/**
 * Configuration options governing the RANSAC plane segmentation algorithm.
 */
export interface RansacOptions {
    /** Maximum perpendicular Euclidean distance in meters for a point to qualify as an inlier (e.g. 0.03 m) */
    distanceThreshold: number;
    /** Maximum number of random 3-point sample iterations per plane search */
    maxIterations: number;
    /** Minimum number of consensus inliers required to accept a plane hypothesis */
    minInliers: number;
    /** Maximum number of sequential planes to extract from a single point cloud */
    maxPlanes: number;
}

/**
 * Core spatial processor for extracting planar surfaces from 3D point clouds.
 */
export class PlaneMeshExtractor {
    private options: RansacOptions;

    /**
     * Initializes a new instance of PlaneMeshExtractor with configurable RANSAC parameters.
     *
     * @param customOptions - Optional partial configuration overriding default RANSAC parameters.
     * Defaults:
     * - `distanceThreshold`: 0.03 meters (3 cm)
     * - `maxIterations`: 200 trials
     * - `minInliers`: 20 points
     * - `maxPlanes`: 6 planes
     */
    constructor(customOptions?: Partial<RansacOptions>) {
        this.options = {
            distanceThreshold: 0.03,
            maxIterations: 200,
            minInliers: 20,
            maxPlanes: 6,
            ...customOptions
        };
    }

    // --- Vector Math Utilities ---

    /**
     * Computes the vector dot product of two 3D vectors: a . b = ax*bx + ay*by + az*bz.
     *
     * @param a - First 3D vector.
     * @param b - Second 3D vector.
     * @returns Scalar dot product.
     */
    public static dot(a: Vec3, b: Vec3): number {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    /**
     * Computes the vector cross product of two 3D vectors: a x b.
     * Yields an orthogonal vector adhering to the right-hand rule.
     *
     * @param a - First 3D vector.
     * @param b - Second 3D vector.
     * @returns Resulting orthogonal 3D vector.
     */
    public static cross(a: Vec3, b: Vec3): Vec3 {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        };
    }

    /**
     * Computes the Euclidean norm (magnitude / length) of a 3D vector: ||v||_2 = sqrt(x^2 + y^2 + z^2).
     *
     * @param v - 3D vector.
     * @returns Scalar Euclidean length.
     */
    public static norm(v: Vec3): number {
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }

    /**
     * Normalizes a 3D vector to unit length (||v||_2 = 1).
     * If the input vector has zero magnitude (||v||_2 == 0), returns a fallback unit vector { x: 0, y: 1, z: 0 }.
     *
     * @param v - 3D vector to normalize.
     * @returns Unit-length 3D vector.
     */
    public static normalize(v: Vec3): Vec3 {
        const len = PlaneMeshExtractor.norm(v);
        if (len === 0) return { x: 0, y: 1, z: 0 };
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    }

    /**
     * Subtracts vector b from vector a: a - b = (ax - bx, ay - by, az - bz).
     *
     * @param a - Minuend vector.
     * @param b - Subtrahend vector.
     * @returns Difference vector.
     */
    public static subtract(a: Vec3, b: Vec3): Vec3 {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    /**
     * Adds two 3D vectors: a + b = (ax + bx, ay + by, az + bz).
     *
     * @param a - First addend vector.
     * @param b - Second addend vector.
     * @returns Sum vector.
     */
    public static add(a: Vec3, b: Vec3): Vec3 {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }

    /**
     * Multiplies a 3D vector by a scalar factor: s * v = (s * vx, s * vy, s * vz).
     *
     * @param v - Base 3D vector.
     * @param s - Scalar multiplication factor.
     * @returns Scaled 3D vector.
     */
    public static scale(v: Vec3, s: number): Vec3 {
        return { x: v.x * s, y: v.y * s, z: v.z * s };
    }

    // --- Plane Fitting & Distance ---

    /**
     * Fits a normalized plane equation ax + by + cz + d = 0 from 3 points in 3D space.
     *
     * Mathematical Method:
     * 1. Constructs displacement vectors v1 = p2 - p1 and v2 = p3 - p1.
     * 2. Calculates unnormalized normal n_raw = v1 x v2.
     * 3. Tests degenerate condition: if ||n_raw||_2 < 1e-6 (collinear or coincident points), returns null.
     * 4. Normalizes (a, b, c) = n_raw / ||n_raw||_2.
     * 5. Solves plane offset constant d = -(a*p1.x + b*p1.y + c*p1.z).
     *
     * @param p1 - First point on the plane.
     * @param p2 - Second point on the plane.
     * @param p3 - Third point on the plane.
     * @returns Normalized PlaneEquation, or null if the 3 points are collinear or degenerate.
     */
    public static fitPlaneFrom3Points(p1: Vec3, p2: Vec3, p3: Vec3): PlaneEquation | null {
        const v1 = PlaneMeshExtractor.subtract(p2, p1);
        const v2 = PlaneMeshExtractor.subtract(p3, p1);
        const normal = PlaneMeshExtractor.cross(v1, v2);
        const len = PlaneMeshExtractor.norm(normal);
        if (len < 1e-6) return null; // Collinear points

        const a = normal.x / len;
        const b = normal.y / len;
        const c = normal.z / len;
        const d = -(a * p1.x + b * p1.y + c * p1.z);

        return { a, b, c, d };
    }

    /**
     * Calculates the perpendicular Euclidean distance from point p to the plane.
     *
     * Because the plane equation is strictly normalized (||(a, b, c)||_2 = 1),
     * the distance simplifies to:
     * distance(p, plane) = |a * p.x + b * p.y + c * p.z + d|
     *
     * @param p - 3D point query position.
     * @param plane - Normalized plane equation.
     * @returns Orthogonal Euclidean distance in meters.
     */
    public static distanceToPlane(p: Vec3, plane: PlaneEquation): number {
        return Math.abs(plane.a * p.x + plane.b * p.y + plane.c * p.z + plane.d);
    }

    // --- RANSAC Multi-Plane Extraction ---

    /**
     * Extracts multiple planar surfaces from a raw 3D point cloud via sequential RANSAC.
     *
     * Algorithmic Procedure:
     * 1. If points.length < minInliers, immediately returns an empty array.
     * 2. Loops up to `options.maxPlanes`:
     *    a. If remaining points < minInliers, halts extraction.
     *    b. Runs single-plane RANSAC (`ransacSinglePlane`) over the remaining points.
     *    c. If no valid plane candidate is found or consensus size < minInliers, halts extraction.
     *    d. Constructs full geometric plane data (`constructPlaneData`) including normal orientation,
     *       centroid, 2D tangent projection, 2D convex hull, and indexed triangle mesh.
     *    e. Depletes inlier points from `remainingPoints` using a Set lookup (O(N) depletion).
     * 3. Returns the list of extracted planes.
     *
     * Time Complexity: O(P * K * N), where P <= maxPlanes, K = maxIterations, and N = number of points.
     *
     * @param points - Array of input 3D point coordinates.
     * @returns Array of segmented ExtractedPlane instances.
     */
    public extractPlanes(points: Vec3[]): ExtractedPlane[] {
        if (points.length < this.options.minInliers) return [];

        const extractedPlanes: ExtractedPlane[] = [];
        let remainingPoints = [...points];

        for (let planeIdx = 0; planeIdx < this.options.maxPlanes; planeIdx++) {
            if (remainingPoints.length < this.options.minInliers) break;

            const bestResult = this.ransacSinglePlane(remainingPoints);
            if (!bestResult || bestResult.inliers.length < this.options.minInliers) break;

            // Formulate ExtractedPlane
            const plane = this.constructPlaneData(
                `plane-${planeIdx + 1}`,
                bestResult.equation,
                bestResult.inliers
            );
            extractedPlanes.push(plane);

            // Filter out inliers from remaining set
            const inlierSet = new Set(bestResult.inliers);
            remainingPoints = remainingPoints.filter(p => !inlierSet.has(p));
        }

        return extractedPlanes;
    }

    /**
     * Executes a single RANSAC plane segmentation pass over an array of 3D points.
     *
     * Iteration Logic:
     * - Fixed iteration count `options.maxIterations` (default 200).
     * - In each iteration, draws 3 random distinct indices using `Math.random()`.
     * - Fits a plane equation using `fitPlaneFrom3Points`.
     * - Performs a linear scan over all N points, classifying point p as an inlier if
     *   `distanceToPlane(p, eq) <= distanceThreshold`.
     * - Retains the candidate with the highest consensus cardinality (inlier count).
     * - Rejects candidates whose final inlier count is below `options.minInliers`.
     *
     * Note: Adaptive iteration termination (e.g., dynamically updating K based on inlier ratio)
     * is not currently implemented; iterations run to `maxIterations`.
     *
     * @param points - Active candidate point cloud.
     * @returns Best plane hypothesis and its consensus inlier points, or null if no valid model found.
     */
    private ransacSinglePlane(points: Vec3[]): { equation: PlaneEquation; inliers: Vec3[] } | null {
        let bestEquation: PlaneEquation | null = null;
        let bestInliers: Vec3[] = [];

        const n = points.length;
        if (n < 3) return null;

        for (let iter = 0; iter < this.options.maxIterations; iter++) {
            // Randomly select 3 distinct points
            const i1 = Math.floor(Math.random() * n);
            let i2 = Math.floor(Math.random() * n);
            while (i2 === i1) i2 = Math.floor(Math.random() * n);
            let i3 = Math.floor(Math.random() * n);
            while (i3 === i1 || i3 === i2) i3 = Math.floor(Math.random() * n);

            const eq = PlaneMeshExtractor.fitPlaneFrom3Points(points[i1], points[i2], points[i3]);
            if (!eq) continue;

            const currentInliers: Vec3[] = [];
            for (let i = 0; i < n; i++) {
                if (PlaneMeshExtractor.distanceToPlane(points[i], eq) <= this.options.distanceThreshold) {
                    currentInliers.push(points[i]);
                }
            }

            if (currentInliers.length > bestInliers.length) {
                bestInliers = currentInliers;
                bestEquation = eq;
            }
        }

        if (!bestEquation || bestInliers.length < this.options.minInliers) return null;
        return { equation: bestEquation, inliers: bestInliers };
    }

    // --- Geometry & Mesh Synthesis ---

    /**
     * Constructs the comprehensive ExtractedPlane data structure from a fitted plane model and consensus inliers.
     *
     * Steps:
     * 1. Normal Orientation Alignment: If the normal is predominantly horizontal (|n.y| > 0.5) but
     *    points downward (n.y < 0), flips the normal and negates d so it consistently points upward.
     * 2. Centroid Calculation: Computes arithmetic mean center = (1/|I|) * sum(p_i) for all inliers.
     * 3. Tangent Frame Generation: Establishes orthonormal basis (u, v) on the plane surface:
     *    - Chooses reference vector arbitrary = (0, 1, 0), falling back to (1, 0, 0) if |normal . arbitrary| > 0.9.
     *    - u = normalize(normal x arbitrary)
     *    - v = normal x u
     * 4. 2D Projection: Projects each inlier p onto (u, v): p2D = ((p - center).u, (p - center).v).
     * 5. 2D Convex Hull: Extracts boundary polygon using Andrew's monotone chain algorithm (O(I log I)).
     * 6. Polygon Area & Bounds: Calculates area via Shoelace formula, and 2D bounding extents.
     * 7. 3D Boundary Reconstruction: Unprojects 2D hull points back to 3D world space.
     * 8. Triangulation: Creates indexed triangle fan mesh with the centroid at index 0.
     * 9. Semantic Classification & Desk Ergonomics Check: Evaluates orientation and elevation.
     *
     * @param planeId - Descriptive string identifier.
     * @param eq - Initial normalized plane equation.
     * @param inliers - Subset of points belonging to the plane consensus set.
     * @returns Fully populated ExtractedPlane object.
     */
    private constructPlaneData(
        planeId: string,
        eq: PlaneEquation,
        inliers: Vec3[]
    ): ExtractedPlane {
        // Normal vector
        let normal: Vec3 = { x: eq.a, y: eq.b, z: eq.c };
        // Ensure normal points upward if mostly horizontal
        if (normal.y < 0 && Math.abs(normal.y) > 0.5) {
            normal = PlaneMeshExtractor.scale(normal, -1);
            eq = { a: normal.x, b: normal.y, c: normal.z, d: -eq.d };
        }

        // Center point
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

        // Local 2D orthonormal tangent frame (u, v)
        let arbitrary: Vec3 = { x: 0, y: 1, z: 0 };
        if (Math.abs(PlaneMeshExtractor.dot(normal, arbitrary)) > 0.9) {
            arbitrary = { x: 1, y: 0, z: 0 };
        }
        const u = PlaneMeshExtractor.normalize(PlaneMeshExtractor.cross(normal, arbitrary));
        const v = PlaneMeshExtractor.cross(normal, u);

        // Project inliers to 2D
        const points2D: Vec2[] = inliers.map(p => {
            const rel = PlaneMeshExtractor.subtract(p, center);
            return {
                x: PlaneMeshExtractor.dot(rel, u),
                y: PlaneMeshExtractor.dot(rel, v)
            };
        });

        // Compute 2D Convex Hull
        const hull2D = this.compute2DConvexHull(points2D);

        // Area & Bounding Dimensions
        const areaSqMeters = this.computePolygonArea(hull2D);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of hull2D) {
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
     * Classifies surface semantic type based on surface normal orientation and elevation along Y axis.
     *
     * Heuristics:
     * - Horizontal (|normal . (0, 1, 0)| > 0.8):
     *   - elevationY < 0.35 m -> 'FLOOR'
     *   - 0.60 m <= elevationY <= 1.05 m -> 'DESK'
     *   - elevationY > 2.0 m -> 'CEILING'
     *   - Otherwise -> 'UNKNOWN'
     * - Vertical (|normal . (0, 1, 0)| < 0.3):
     *   - Inferred as 'WALL'
     * - Other orientations -> 'UNKNOWN'
     *
     * @param normal - Unit normal vector of the plane.
     * @param elevationY - Vertical position (Y coordinate in meters) of the plane centroid.
     * @returns SurfaceType semantic label.
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
     * Computes the 2D Convex Hull of a planar point set using Andrew's Monotone Chain algorithm.
     *
     * Algorithm Details:
     * 1. Sorts points primarily by x-coordinate, secondarily by y-coordinate (O(N log N)).
     * 2. Evaluates cross product orientation cross2D(o, a, b) = (a.x - o.x)*(b.y - o.y) - (a.y - o.y)*(b.x - o.x).
     * 3. Constructs the lower hull by incrementally popping clockwise/collinear turns (cross2D <= 0).
     * 4. Constructs the upper hull similarly in reverse order.
     * 5. Concatenates lower and upper hulls omitting duplicate endpoints.
     *
     * Output order: Counter-Clockwise (CCW) polygon boundary vertices.
     *
     * @param points - Array of 2D points in the local tangent plane.
     * @returns Array of ordered 2D vertices forming the convex hull perimeter.
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
     * Computes the polygon planar surface area using the 2D Shoelace formula (Gauss's area formula).
     *
     * Area = 0.5 * | sum_{i=0}^{n-1} (x_i * y_{i+1} - x_{i+1} * y_i) |
     *
     * @param polygon - Ordered vertices representing the polygon boundary.
     * @returns Enclosed area in square meters.
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
     * Triangulates a 3D convex boundary polygon into an indexed triangle mesh using a triangle fan.
     *
     * Layout:
     * - Vertex 0: Centroid of the plane.
     * - Vertices 1..M: Sequential boundary vertices from boundary3D.
     * - Faces: M triangles with index triplets [0, i + 1, ((i + 1) % M) + 1] for i in [0..M-1].
     *
     * @param center - 3D coordinates of the plane centroid.
     * @param normal - Surface normal vector assigned uniformly to all vertex normals.
     * @param boundary3D - Ordered 3D boundary polygon vertices.
     * @returns Indexed TriangleMesh object.
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
