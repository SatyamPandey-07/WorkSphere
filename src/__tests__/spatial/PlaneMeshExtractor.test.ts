import {
    PlaneMeshExtractor,
    Vec3,
    PlaneEquation
} from '../../core/spatial/PlaneMeshExtractor';

describe('PlaneMeshExtractor', () => {
    let extractor: PlaneMeshExtractor;

    beforeEach(() => {
        extractor = new PlaneMeshExtractor({
            distanceThreshold: 0.02,
            maxIterations: 100,
            minInliers: 15,
            maxPlanes: 4
        });
    });

    describe('Vector and Plane Geometry Primitives', () => {
        it('calculates vector cross product, dot product, and normalization', () => {
            const v1: Vec3 = { x: 1, y: 0, z: 0 };
            const v2: Vec3 = { x: 0, y: 1, z: 0 };
            const cross = PlaneMeshExtractor.cross(v1, v2);

            expect(cross.x).toBe(0);
            expect(cross.y).toBe(0);
            expect(cross.z).toBe(1);

            expect(PlaneMeshExtractor.dot(v1, v2)).toBe(0);
            expect(PlaneMeshExtractor.dot(v1, v1)).toBe(1);
        });

        it('fits plane equation from 3 non-collinear points', () => {
            const p1: Vec3 = { x: 0, y: 0.75, z: 0 };
            const p2: Vec3 = { x: 1, y: 0.75, z: 0 };
            const p3: Vec3 = { x: 0, y: 0.75, z: 1 };

            const eq = PlaneMeshExtractor.fitPlaneFrom3Points(p1, p2, p3);
            expect(eq).not.toBeNull();
            expect(Math.abs(eq!.b)).toBeCloseTo(1, 4); // Y-axis normal
            expect(eq!.a).toBeCloseTo(0, 4);
            expect(eq!.c).toBeCloseTo(0, 4);
        });

        it('rejects collinear, nearly collinear, and non-finite point triplets', () => {
            const collinear = PlaneMeshExtractor.fitPlaneFrom3Points(
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 1, z: 1 },
                { x: 2, y: 2, z: 2 }
            );
            const nearlyCollinear = PlaneMeshExtractor.fitPlaneFrom3Points(
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 0, z: 0 },
                { x: 2, y: 1e-7, z: 0 }
            );
            const nonFinite = PlaneMeshExtractor.fitPlaneFrom3Points(
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 0, z: 0 },
                { x: Number.NaN, y: 1, z: 0 }
            );

            expect(collinear).toBeNull();
            expect(nearlyCollinear).toBeNull();
            expect(nonFinite).toBeNull();
        });

        it('calculates point-to-plane Euclidean distance', () => {
            const plane: PlaneEquation = { a: 0, b: 1, c: 0, d: -0.75 }; // y = 0.75
            const p: Vec3 = { x: 2, y: 0.85, z: 5 };
            const dist = PlaneMeshExtractor.distanceToPlane(p, plane);
            expect(dist).toBeCloseTo(0.1, 4);
        });
    });

    describe('Surface Semantic Classification', () => {
        it('classifies surfaces based on normal orientation and elevation', () => {
            const upNormal: Vec3 = { x: 0, y: 1, z: 0 };
            const wallNormal: Vec3 = { x: 1, y: 0, z: 0 };

            expect(extractor.classifySurface(upNormal, 0.05)).toBe('FLOOR');
            expect(extractor.classifySurface(upNormal, 0.74)).toBe('DESK');
            expect(extractor.classifySurface(upNormal, 2.5)).toBe('CEILING');
            expect(extractor.classifySurface(wallNormal, 1.2)).toBe('WALL');
        });
    });

    describe('RANSAC Multi-Plane Extraction on Synthetic Point Clouds', () => {
        it('segments desk and floor planes with accurate geometric dimensions and mesh topology', () => {
            const points: Vec3[] = [];

            // 1. Generate Synthetic Desk points at y = 0.75m (width 1.2m, depth 0.8m)
            for (let x = -0.5; x <= 0.5; x += 0.15) {
                for (let z = -0.3; z <= 0.3; z += 0.15) {
                    const noise = (Math.random() - 0.5) * 0.004;
                    points.push({ x, y: 0.75 + noise, z });
                }
            }

            // 2. Generate Synthetic Floor points at y = 0.05m
            for (let x = -1.0; x <= 1.0; x += 0.4) {
                for (let z = -1.0; z <= 1.0; z += 0.4) {
                    const noise = (Math.random() - 0.5) * 0.004;
                    points.push({ x, y: 0.05 + noise, z });
                }
            }

            const planes = extractor.extractPlanes(points);
            expect(planes.length).toBeGreaterThanOrEqual(2);

            const deskPlane = planes.find(p => p.surfaceType === 'DESK');
            const floorPlane = planes.find(p => p.surfaceType === 'FLOOR');

            expect(deskPlane).toBeDefined();
            expect(floorPlane).toBeDefined();

            // Validate desk properties
            expect(deskPlane?.dimensions.height).toBeCloseTo(0.75, 1);
            expect(Math.max(deskPlane!.dimensions.width, deskPlane!.dimensions.depth)).toBeGreaterThanOrEqual(0.7);
            expect(deskPlane?.isErgonomicDesk).toBe(true);
            expect(deskPlane?.areaSqMeters).toBeGreaterThan(0.2);

            // Validate 3D mesh structure
            expect(deskPlane?.mesh.vertices.length).toBeGreaterThan(0);
            expect(deskPlane?.mesh.indices.length).toBeGreaterThan(0);
            expect(deskPlane?.mesh.indices.length % 3).toBe(0);
        });

        it('returns empty array when input point cloud has insufficient points', () => {
            const sparsePoints: Vec3[] = [
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 1, z: 1 }
            ];
            const planes = extractor.extractPlanes(sparsePoints);
            expect(planes).toEqual([]);
        });
    });
});
