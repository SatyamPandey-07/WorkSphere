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

    describe('Voxel-grid downsampling', () => {
        it('computes centroids without mutating the input', () => {
            const points: Vec3[] = [
                { x: 0.01, y: 0.02, z: 0.03 },
                { x: 0.04, y: 0.01, z: 0.02 },
                { x: 0.11, y: 0.01, z: 0.01 }
            ];
            const original = points.map(point => ({ ...point }));
            expect(PlaneMeshExtractor.downsamplePointCloud(points, 0.1)).toEqual([
                { x: 0.025, y: 0.015, z: 0.025 },
                { x: 0.11, y: 0.01, z: 0.01 }
            ]);
            expect(points).toEqual(original);
        });

        it('handles negative coordinates and exact voxel boundaries', () => {
            const points: Vec3[] = [
                { x: -0.1, y: 0, z: 0 },
                { x: -0.1000001, y: 0, z: 0 },
                { x: 0.0999999, y: 0, z: 0 },
                { x: 0.1, y: 0, z: 0 }
            ];
            expect(PlaneMeshExtractor.downsamplePointCloud(points, 0.1)).toHaveLength(4);
        });

        it('supports empty clouds and rejects invalid leaf sizes', () => {
            expect(PlaneMeshExtractor.downsamplePointCloud([], 0.05)).toEqual([]);
            for (const leafSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
                expect(() => new PlaneMeshExtractor({ voxelLeafSize: leafSize })).toThrow(RangeError);
                expect(() => PlaneMeshExtractor.downsamplePointCloud([], leafSize)).toThrow(RangeError);
            }
        });

        it('uses the default and configurable leaf sizes before RANSAC', () => {
            const points = Array.from({ length: 30 }, (_, index) => ({
                x: (index % 2) * 0.01,
                y: 0.75,
                z: Math.floor(index / 2) * 0.01
            }));
            const defaultExtractor = new PlaneMeshExtractor({ minInliers: 1, maxIterations: 1 });
            const configurableExtractor = new PlaneMeshExtractor({ minInliers: 1, maxIterations: 1, voxelLeafSize: 0.001 });
            const defaultSpy = jest.spyOn(PlaneMeshExtractor, 'downsamplePointCloud');
            defaultExtractor.extractPlanes(points);
            expect(defaultSpy).toHaveBeenCalledWith(points, 0.05);
            defaultSpy.mockRestore();
            const fineSpy = jest.spyOn(PlaneMeshExtractor, 'downsamplePointCloud');
            configurableExtractor.extractPlanes(points);
            expect(fineSpy).toHaveBeenCalledWith(points, 0.001);
            fineSpy.mockRestore();
        });

        it('passes the downsampled cloud to RANSAC', () => {
            const points = Array.from({ length: 40 }, (_, index) => ({
                x: (index % 2) * 0.01,
                y: 0.75,
                z: Math.floor(index / 2) * 0.01
            }));
            const integrationExtractor = new PlaneMeshExtractor({ minInliers: 1, maxIterations: 1 });
            const ransacSpy = jest.spyOn(
                integrationExtractor as unknown as { ransacSinglePlane: (values: Vec3[]) => unknown },
                'ransacSinglePlane'
            );
            integrationExtractor.extractPlanes(points);
            expect(ransacSpy).toHaveBeenCalled();
            expect(ransacSpy.mock.calls[0][0].length).toBeLessThan(points.length);
            ransacSpy.mockRestore();
        });

        it('recovers original-resolution inliers for mesh geometry and counts', () => {
            const points: Vec3[] = [];
            for (let x = -0.4; x <= 0.4; x += 0.01) {
                for (let z = -0.3; z <= 0.3; z += 0.01) {
                    points.push({ x, y: 0.75, z });
                }
            }
            const downsampled = PlaneMeshExtractor.downsamplePointCloud(points, 0.05);
            const planes = new PlaneMeshExtractor({
                minInliers: 20,
                maxIterations: 100,
                maxPlanes: 1,
                voxelLeafSize: 0.05
            }).extractPlanes(points);

            expect(downsampled.length).toBeLessThan(points.length);
            expect(planes).toHaveLength(1);
            expect(planes[0].inliersCount).toBe(points.length);
            expect(planes[0].dimensions.width).toBeGreaterThan(0.5);
            expect(planes[0].dimensions.depth).toBeGreaterThan(0.5);
            expect(planes[0].center.x).toBeCloseTo(0, 2);
            expect(planes[0].center.y).toBeCloseTo(0.75, 2);
            expect(planes[0].center.z).toBeCloseTo(0, 2);
        });

        it('rejects an invalid candidate without deleting valid points in the same voxels', () => {
            const invalidPoints: Vec3[] = [
                { x: 0, y: 0.1, z: 0 },
                { x: 0.01, y: 0.1, z: 0.01 },
                { x: 0.02, y: 0.1, z: 0.02 }
            ];
            const validPoints: Vec3[] = [];
            for (let x = 0; x <= 0.2; x += 0.05) {
                for (let z = 0.5; z <= 0.7; z += 0.05) {
                    validPoints.push({ x, y: 0.75, z });
                }
            }
            const points = [...invalidPoints, ...validPoints];
            const validCentroids = PlaneMeshExtractor.downsamplePointCloud(validPoints, 0.05);
            const extractor = new PlaneMeshExtractor({
                minInliers: 3,
                maxIterations: 1,
                maxPlanes: 1,
                voxelLeafSize: 0.05
            });
            const ransacSpy = jest.spyOn(
                extractor as unknown as { ransacSinglePlane: jest.Mock },
                'ransacSinglePlane'
            );
            ransacSpy
                .mockReturnValueOnce({
                    equation: { a: 1, b: 0, c: 0, d: -10 },
                    inliers: validCentroids.slice(0, 3)
                })
                .mockReturnValueOnce({
                    equation: { a: 0, b: 1, c: 0, d: -0.75 },
                    inliers: validCentroids
                });

            const planes = extractor.extractPlanes(points);

            expect(ransacSpy).toHaveBeenCalledTimes(2);
            expect(planes).toHaveLength(1);
            expect(planes[0].inliersCount).toBe(validPoints.length);
            expect(planes[0].center.y).toBeCloseTo(0.75, 5);
            ransacSpy.mockRestore();
        });

        it('terminates after rejecting candidates when no valid plane remains', () => {
            const points = [
                { x: 0, y: 0, z: 0 },
                { x: 1, y: 0, z: 0 },
                { x: 0, y: 0, z: 1 },
                { x: 0, y: 1, z: 0 }
            ];
            const extractor = new PlaneMeshExtractor({
                minInliers: 3,
                maxIterations: 2,
                maxPlanes: 1,
                voxelLeafSize: 0.05
            });
            const ransacSpy = jest.spyOn(
                extractor as unknown as { ransacSinglePlane: jest.Mock },
                'ransacSinglePlane'
            ).mockReturnValue({
                equation: { a: 1, b: 0, c: 0, d: -10 },
                inliers: points.slice(0, 3)
            });

            expect(extractor.extractPlanes(points)).toEqual([]);
            expect(ransacSpy).toHaveBeenCalledTimes(3);
            ransacSpy.mockRestore();
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
