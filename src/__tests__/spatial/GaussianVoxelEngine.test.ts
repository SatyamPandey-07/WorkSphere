/**
 * @file GaussianVoxelEngine.test.ts
 * @description Comprehensive unit test suite for 3D Gaussian Splatting Radiance Field,
 * view-dependent spherical harmonics, screen-space projective covariance, front-to-back alpha blending,
 * voxel hash grid partitioning, and adaptive density pruning/densification.
 */

import {
  Math3D,
  VoxelHashGrid,
  GaussianVoxelEngine,
  GaussianSplat,
  Camera,
  Matrix4x4,
} from '../../core/spatial/GaussianVoxelEngine';

describe('GaussianVoxelEngine & 3D Radiance Field Suite', () => {
  describe('Math3D & Linear Algebra', () => {
    it('normalizes 3D vectors and quaternions correctly', () => {
      const v = Math3D.normalizeVec3([3, 0, 4]);
      expect(v[0]).toBeCloseTo(0.6);
      expect(v[1]).toBeCloseTo(0.0);
      expect(v[2]).toBeCloseTo(0.8);

      const zero = Math3D.normalizeVec3([0, 0, 0]);
      expect(zero).toEqual([0, 0, 0]);

      const q = Math3D.normalizeQuat([2, 0, 0, 0]);
      expect(q).toEqual([1, 0, 0, 0]);
    });

    it('converts identity quaternion to identity 3x3 rotation matrix', () => {
      const R = Math3D.quatToRotMatrix([1, 0, 0, 0]);
      expect(R[0][0]).toBeCloseTo(1);
      expect(R[0][1]).toBeCloseTo(0);
      expect(R[0][2]).toBeCloseTo(0);
      expect(R[1][1]).toBeCloseTo(1);
      expect(R[2][2]).toBeCloseTo(1);
    });

    it('computes symmetric positive semi-definite 3D covariance matrix', () => {
      const scale = [0.5, 0.2, 0.1] as [number, number, number];
      const rot = [1, 0, 0, 0] as [number, number, number, number];
      const cov = Math3D.computeCovariance3D(scale, rot);

      // S^2 diagonal elements
      expect(cov[0][0]).toBeCloseTo(0.25);
      expect(cov[1][1]).toBeCloseTo(0.04);
      expect(cov[2][2]).toBeCloseTo(0.01);

      // Symmetry check
      expect(cov[0][1]).toBeCloseTo(cov[1][0]);
      expect(cov[0][2]).toBeCloseTo(cov[2][0]);
      expect(cov[1][2]).toBeCloseTo(cov[2][1]);
    });

    it('evaluates Degree 0 and Degree 1 Spherical Harmonics color', () => {
      const sh = {
        dc: [0.5, 0.5, 0.5] as [number, number, number],
        extra: [
          [0.1, 0.0, 0.0],
          [0.0, 0.1, 0.0],
          [0.0, 0.0, 0.1],
        ] as [[number, number, number], [number, number, number], [number, number, number]],
      };

      const colorFront = Math3D.evaluateSH(sh, [0, 0, 1]);
      expect(colorFront[0]).toBeGreaterThanOrEqual(0);
      expect(colorFront[0]).toBeLessThanOrEqual(1);

      const colorBack = Math3D.evaluateSH(sh, [0, 0, -1]);
      // Directional difference due to Degree 1 dipoles
      expect(colorFront[2]).not.toBeCloseTo(colorBack[2]);
    });

    it('transforms 3D points by 4x4 matrix', () => {
      const translationMat: Matrix4x4 = [
        [1, 0, 0, 10],
        [0, 1, 0, -5],
        [0, 0, 1, 20],
        [0, 0, 0, 1],
      ];
      const p = Math3D.transformPoint4x4([1, 2, 3], translationMat);
      expect(p[0]).toBeCloseTo(11);
      expect(p[1]).toBeCloseTo(-3);
      expect(p[2]).toBeCloseTo(23);
    });
  });

  describe('VoxelHashGrid Spatial Partitioning', () => {
    it('bins and queries splats within target radius', () => {
      const grid = new VoxelHashGrid(1.0);
      const s1: GaussianSplat = {
        id: 's1',
        position: [0.2, 0.3, 0.1],
        scale: [0.1, 0.1, 0.1],
        rotation: [1, 0, 0, 0],
        opacity: 0.9,
        sh: { dc: [0, 0, 0] },
      };
      const s2: GaussianSplat = {
        id: 's2',
        position: [5.0, 5.0, 5.0],
        scale: [0.1, 0.1, 0.1],
        rotation: [1, 0, 0, 0],
        opacity: 0.9,
        sh: { dc: [0, 0, 0] },
      };

      grid.insert(s1);
      grid.insert(s2);

      const nearCenter = grid.queryRadius([0, 0, 0], 1.0);
      expect(nearCenter.length).toBe(1);
      expect(nearCenter[0].id).toBe('s1');

      const far = grid.queryRadius([5, 5, 5], 0.5);
      expect(far.length).toBe(1);
      expect(far[0].id).toBe('s2');

      const empty = grid.queryRadius([10, 10, 10], 1.0);
      expect(empty.length).toBe(0);
    });
  });

  describe('GaussianVoxelEngine Culling, Projection & Rasterization', () => {
    const identityCam: Camera = {
      position: [0, 0, 0],
      viewMatrix: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      projectionMatrix: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      focalLength: { fx: 500, fy: 500 },
      screenSize: { width: 800, height: 600 },
    };

    it('projects valid in-frustum Gaussian splats to screen space', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplat({
        id: 'desk-center',
        position: [0, 0, 2.0], // 2 meters in front of camera
        scale: [0.2, 0.2, 0.2],
        rotation: [1, 0, 0, 0],
        opacity: 0.85,
        sh: { dc: [1, 0, 0] },
      });

      const projected = engine.cullAndProject(identityCam);
      expect(projected.length).toBe(1);
      expect(projected[0].splatId).toBe('desk-center');
      // Center of 800x600 screen is (400, 300)
      expect(projected[0].screenPosition[0]).toBeCloseTo(400);
      expect(projected[0].screenPosition[1]).toBeCloseTo(300);
      expect(projected[0].depth).toBeCloseTo(2.0);
      expect(projected[0].radius).toBeGreaterThan(0);
      expect(projected[0].cov2D[0]).toBeGreaterThan(0);
      expect(projected[0].cov2D[2]).toBeGreaterThan(0);
    });

    it('culls splats behind the camera near plane (tz <= 0.2)', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplat({
        id: 'behind-camera',
        position: [0, 0, -1.0], // Behind camera
        scale: [0.2, 0.2, 0.2],
        rotation: [1, 0, 0, 0],
        opacity: 0.9,
        sh: { dc: [0, 1, 0] },
      });

      const projected = engine.cullAndProject(identityCam);
      expect(projected.length).toBe(0);
    });

    it('sorts projected splats front-to-back by depth', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplats([
        {
          id: 'far-splat',
          position: [0, 0, 5.0],
          scale: [0.2, 0.2, 0.2],
          rotation: [1, 0, 0, 0],
          opacity: 0.9,
          sh: { dc: [0, 0, 1] },
        },
        {
          id: 'near-splat',
          position: [0, 0, 1.5],
          scale: [0.2, 0.2, 0.2],
          rotation: [1, 0, 0, 0],
          opacity: 0.9,
          sh: { dc: [1, 0, 0] },
        },
      ]);

      const projected = engine.cullAndProject(identityCam);
      expect(projected.length).toBe(2);
      expect(projected[0].splatId).toBe('near-splat');
      expect(projected[1].splatId).toBe('far-splat');
      expect(projected[0].depth).toBeLessThan(projected[1].depth);
    });

    it('renders pixel radiance via front-to-back alpha blending', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplat({
        id: 'solid-red',
        position: [0, 0, 2.0],
        scale: [0.3, 0.3, 0.3],
        rotation: [1, 0, 0, 0],
        opacity: 0.95,
        sh: { dc: [1.5, -1, -1] }, // High red DC
      });

      const projected = engine.cullAndProject(identityCam);
      const color = engine.renderRay(400, 300, projected);

      // Red channel should dominate at screen center
      expect(color[0]).toBeGreaterThan(0.5);
      expect(color[1]).toBeLessThan(0.4);
      expect(color[2]).toBeLessThan(0.4);
    });

    it('returns zero radiance for ray cast outside any splat bounding radius', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplat({
        id: 'center',
        position: [0, 0, 2.0],
        scale: [0.1, 0.1, 0.1],
        rotation: [1, 0, 0, 0],
        opacity: 0.95,
        sh: { dc: [1, 1, 1] },
      });

      const projected = engine.cullAndProject(identityCam);
      // Ray at corner (0, 0) far from center (400, 300)
      const color = engine.renderRay(10, 10, projected);
      expect(color).toEqual([0, 0, 0]);
    });

    it('prunes low-opacity splats', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplats([
        {
          id: 's-ghost',
          position: [0, 0, 1],
          scale: [0.1, 0.1, 0.1],
          rotation: [1, 0, 0, 0],
          opacity: 0.01,
          sh: { dc: [0, 0, 0] },
        },
        {
          id: 's-solid',
          position: [0, 0, 2],
          scale: [0.1, 0.1, 0.1],
          rotation: [1, 0, 0, 0],
          opacity: 0.8,
          sh: { dc: [0, 0, 0] },
        },
      ]);

      const pruned = engine.prune(0.05);
      expect(pruned).toBe(1);
      expect(engine.getSplatCount()).toBe(1);
      expect(engine.getSplat('s-solid')).toBeDefined();
      expect(engine.getSplat('s-ghost')).toBeUndefined();
    });

    it('densifies oversized splats by subdivision', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplat({
        id: 'huge-splat',
        position: [0, 0, 2],
        scale: [3.5, 0.5, 0.5], // max scale 3.5 > threshold 2.0
        rotation: [1, 0, 0, 0],
        opacity: 0.9,
        sh: { dc: [0.5, 0.5, 0.5] },
      });

      const splitCount = engine.densify(2.0);
      expect(splitCount).toBe(1);
      expect(engine.getSplatCount()).toBe(2);
      expect(engine.getSplat('huge-splat_split_1')).toBeDefined();
      expect(engine.getSplat('huge-splat_split_2')).toBeDefined();
    });

    it('serializes and deserializes radiance field to/from JSON cleanly', () => {
      const engine = new GaussianVoxelEngine();
      engine.addSplat({
        id: 'splat-json',
        position: [1.2, 2.3, 3.4],
        scale: [0.1, 0.2, 0.3],
        rotation: [0.707, 0, 0.707, 0],
        opacity: 0.75,
        sh: { dc: [0.2, 0.4, 0.6] },
      });

      const jsonStr = engine.toJSON();
      const restored = GaussianVoxelEngine.fromJSON(jsonStr);

      expect(restored.getSplatCount()).toBe(1);
      const s = restored.getSplat('splat-json');
      expect(s).toBeDefined();
      expect(s!.position).toEqual([1.2, 2.3, 3.4]);
      expect(s!.opacity).toBe(0.75);
    });
  });
});
