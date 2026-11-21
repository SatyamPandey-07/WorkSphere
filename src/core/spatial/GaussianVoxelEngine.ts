/**
 * @file GaussianVoxelEngine.ts
 * @description 3D Gaussian Splatting Radiance Field and Voxel Partitioning Coordinator.
 * Implements full 3D ellipsoidal covariance parameterization, view-dependent spherical harmonics (SH),
 * projective screen-space Jacobian transformation, front-to-back alpha-blending rasterization,
 * spatial voxel grid partitioning, and adaptive density control for digital twin workspace rendering.
 */

export type Vector3 = [number, number, number];
export type Quaternion = [number, number, number, number]; // [w, x, y, z]
export type Matrix3x3 = [Vector3, Vector3, Vector3];
export type Matrix4x4 = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number]
];

export interface SphericalHarmonics {
  /** Degree 0 (DC) base color coefficients [R, G, B] */
  dc: Vector3;
  /** Optional Degree 1 coefficients (3 directional dipole vectors for RGB) */
  extra?: [Vector3, Vector3, Vector3];
}

export interface GaussianSplat {
  id: string;
  position: Vector3;
  scale: Vector3; // [sx, sy, sz]
  rotation: Quaternion; // [w, x, y, z]
  opacity: number; // 0.0 to 1.0
  sh: SphericalHarmonics;
}

export interface Camera {
  position: Vector3;
  viewMatrix: Matrix4x4;
  projectionMatrix: Matrix4x4;
  focalLength: { fx: number; fy: number };
  screenSize: { width: number; height: number };
}

export interface ProjectedGaussian {
  splatId: string;
  screenPosition: [number, number];
  depth: number;
  cov2D: [number, number, number]; // [covXX, covXY, covYY]
  invCov2D: [number, number, number]; // [invXX, invXY, invYY]
  color: Vector3; // [r, g, b] in [0, 1]
  opacity: number;
  radius: number;
}

/**
 * Mathematical utilities for 3D quaternion orientations and linear algebra
 */
export class Math3D {
  public static readonly SH_C0 = 0.28209479177387814;
  public static readonly SH_C1 = 0.4886025119029199;

  public static normalizeVec3(v: Vector3): Vector3 {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len === 0) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  public static normalizeQuat(q: Quaternion): Quaternion {
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    if (len === 0) return [1, 0, 0, 0];
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
  }

  /**
   * Converts a normalized quaternion [w, x, y, z] to a 3x3 orthonormal rotation matrix R
   */
  public static quatToRotMatrix(q: Quaternion): Matrix3x3 {
    const [w, x, y, z] = Math3D.normalizeQuat(q);
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    return [
      [1 - (yy + zz), xy - wz, xz + wy],
      [xy + wz, 1 - (xx + zz), yz - wx],
      [xz - wy, yz + wx, 1 - (xx + yy)]
    ];
  }

  /**
   * Reconstructs symmetric 3D covariance matrix Sigma = R * S * S^T * R^T
   */
  public static computeCovariance3D(scale: Vector3, rotation: Quaternion): Matrix3x3 {
    const R = Math3D.quatToRotMatrix(rotation);
    const [sx, sy, sz] = scale;

    // S * S^T is diagonal [sx^2, sy^2, sz^2]
    const s2: Vector3 = [sx * sx, sy * sy, sz * sz];

    // Compute M = R * S
    const M: Matrix3x3 = [
      [R[0][0] * sx, R[0][1] * sy, R[0][2] * sz],
      [R[1][0] * sx, R[1][1] * sy, R[1][2] * sz],
      [R[2][0] * sx, R[2][1] * sy, R[2][2] * sz]
    ];

    // Sigma = M * M^T
    const cov: Matrix3x3 = [
      [
        M[0][0] * M[0][0] + M[0][1] * M[0][1] + M[0][2] * M[0][2],
        M[0][0] * M[1][0] + M[0][1] * M[1][1] + M[0][2] * M[1][2],
        M[0][0] * M[2][0] + M[0][1] * M[2][1] + M[0][2] * M[2][2]
      ],
      [
        M[1][0] * M[0][0] + M[1][1] * M[0][1] + M[1][2] * M[0][2],
        M[1][0] * M[1][0] + M[1][1] * M[1][1] + M[1][2] * M[1][2],
        M[1][0] * M[2][0] + M[1][1] * M[2][1] + M[1][2] * M[2][2]
      ],
      [
        M[2][0] * M[0][0] + M[2][1] * M[0][1] + M[2][2] * M[0][2],
        M[2][0] * M[1][0] + M[2][1] * M[1][1] + M[2][2] * M[1][2],
        M[2][0] * M[2][0] + M[2][1] * M[2][1] + M[2][2] * M[2][2]
      ]
    ];

    return cov;
  }

  /**
   * Evaluates view-dependent color using Spherical Harmonics (degrees 0 & 1)
   */
  public static evaluateSH(sh: SphericalHarmonics, dir: Vector3): Vector3 {
    const d = Math3D.normalizeVec3(dir);

    // Degree 0 (ambient DC term)
    let r = 0.5 + Math3D.SH_C0 * sh.dc[0];
    let g = 0.5 + Math3D.SH_C0 * sh.dc[1];
    let b = 0.5 + Math3D.SH_C0 * sh.dc[2];

    // Degree 1 (directional dipoles)
    if (sh.extra) {
      const [shX, shY, shZ] = sh.extra;
      // Y_1^-1 = C1 * y, Y_1^0 = C1 * z, Y_1^1 = C1 * x
      const y1_neg1 = -Math3D.SH_C1 * d[1];
      const y1_0 = Math3D.SH_C1 * d[2];
      const y1_1 = -Math3D.SH_C1 * d[0];

      r += y1_1 * shX[0] + y1_neg1 * shY[0] + y1_0 * shZ[0];
      g += y1_1 * shX[1] + y1_neg1 * shY[1] + y1_0 * shZ[1];
      b += y1_1 * shX[2] + y1_neg1 * shY[2] + y1_0 * shZ[2];
    }

    return [
      Math.max(0, Math.min(1, r)),
      Math.max(0, Math.min(1, g)),
      Math.max(0, Math.min(1, b))
    ];
  }

  /**
   * Transforms a 3D point by a 4x4 matrix
   */
  public static transformPoint4x4(p: Vector3, m: Matrix4x4): Vector3 {
    const x = p[0] * m[0][0] + p[1] * m[0][1] + p[2] * m[0][2] + m[0][3];
    const y = p[0] * m[1][0] + p[1] * m[1][1] + p[2] * m[1][2] + m[1][3];
    const z = p[0] * m[2][0] + p[1] * m[2][1] + p[2] * m[2][2] + m[2][3];
    const w = p[0] * m[3][0] + p[1] * m[3][1] + p[2] * m[3][2] + m[3][3];

    if (w !== 0 && w !== 1) {
      return [x / w, y / w, z / w];
    }
    return [x, y, z];
  }
}

/**
 * Spatial Uniform Voxel Hash Grid for Accelerated Spatial Queries
 */
export class VoxelHashGrid {
  private voxelSize: number;
  private grid: Map<string, GaussianSplat[]> = new Map();

  constructor(voxelSize: number = 0.5) {
    this.voxelSize = voxelSize;
  }

  private hash(x: number, y: number, z: number): string {
    const vx = Math.floor(x / this.voxelSize);
    const vy = Math.floor(y / this.voxelSize);
    const vz = Math.floor(z / this.voxelSize);
    return `${vx},${vy},${vz}`;
  }

  public insert(splat: GaussianSplat): void {
    const key = this.hash(splat.position[0], splat.position[1], splat.position[2]);
    const list = this.grid.get(key) || [];
    list.push(splat);
    this.grid.set(key, list);
  }

  public queryRadius(center: Vector3, radius: number): GaussianSplat[] {
    const minX = center[0] - radius;
    const maxX = center[0] + radius;
    const minY = center[1] - radius;
    const maxY = center[1] + radius;
    const minZ = center[2] - radius;
    const maxZ = center[2] + radius;

    const startVX = Math.floor(minX / this.voxelSize);
    const endVX = Math.floor(maxX / this.voxelSize);
    const startVY = Math.floor(minY / this.voxelSize);
    const endVY = Math.floor(maxY / this.voxelSize);
    const startVZ = Math.floor(minZ / this.voxelSize);
    const endVZ = Math.floor(maxZ / this.voxelSize);

    const results: GaussianSplat[] = [];
    const rSq = radius * radius;

    for (let x = startVX; x <= endVX; x++) {
      for (let y = startVY; y <= endVY; y++) {
        for (let z = startVZ; z <= endVZ; z++) {
          const cell = this.grid.get(`${x},${y},${z}`);
          if (cell) {
            for (const s of cell) {
              const dx = s.position[0] - center[0];
              const dy = s.position[1] - center[1];
              const dz = s.position[2] - center[2];
              if (dx * dx + dy * dy + dz * dz <= rSq) {
                results.push(s);
              }
            }
          }
        }
      }
    }

    return results;
  }

  public clear(): void {
    this.grid.clear();
  }

  public getOccupiedVoxelCount(): number {
    return this.grid.size;
  }
}

/**
 * 3D Gaussian Splatting Radiance Field & Voxel Engine
 */
export class GaussianVoxelEngine {
  private splats: Map<string, GaussianSplat> = new Map();
  private grid: VoxelHashGrid;

  constructor(voxelSize: number = 0.5) {
    this.grid = new VoxelHashGrid(voxelSize);
  }

  public addSplat(splat: GaussianSplat): void {
    this.splats.set(splat.id, splat);
    this.grid.insert(splat);
  }

  public addSplats(splats: GaussianSplat[]): void {
    for (const splat of splats) {
      this.addSplat(splat);
    }
  }

  public getSplat(id: string): GaussianSplat | undefined {
    return this.splats.get(id);
  }

  public getAllSplats(): GaussianSplat[] {
    return Array.from(this.splats.values());
  }

  public getSplatCount(): number {
    return this.splats.size;
  }

  /**
   * Projects 3D Gaussians into screen space using perspective projection Jacobian J.
   * Culls splats behind near clipping plane and computes 2D screen covariance Sigma'.
   */
  public cullAndProject(camera: Camera): ProjectedGaussian[] {
    const projected: ProjectedGaussian[] = [];
    const { width, height } = camera.screenSize;
    const { fx, fy } = camera.focalLength;
    const cx = width / 2;
    const cy = height / 2;

    for (const splat of this.splats.values()) {
      if (splat.opacity <= 0.001) continue;

      // Transform position into camera space
      const pCam = Math3D.transformPoint4x4(splat.position, camera.viewMatrix);
      const tx = pCam[0];
      const ty = pCam[1];
      const tz = pCam[2];

      // Near plane clipping
      if (tz <= 0.2) continue;

      // Screen space mean position
      const screenX = (fx * tx) / tz + cx;
      const screenY = (fy * ty) / tz + cy;

      // 3D Covariance Matrix Sigma in world coordinates
      const cov3D = Math3D.computeCovariance3D(splat.scale, splat.rotation);

      // Extract 3x3 rotation from view matrix W
      const W: Matrix3x3 = [
        [camera.viewMatrix[0][0], camera.viewMatrix[0][1], camera.viewMatrix[0][2]],
        [camera.viewMatrix[1][0], camera.viewMatrix[1][1], camera.viewMatrix[1][2]],
        [camera.viewMatrix[2][0], camera.viewMatrix[2][1], camera.viewMatrix[2][2]]
      ];

      // Perspective projection Jacobian matrix J (2x3):
      // J = [ [fx/tz, 0, -fx*tx/tz^2], [0, fy/tz, -fy*ty/tz^2] ]
      const tz2 = tz * tz;
      const J00 = fx / tz;
      const J02 = (-fx * tx) / tz2;
      const J11 = fy / tz;
      const J12 = (-fy * ty) / tz2;

      // Compute T = J * W (2x3)
      const T00 = J00 * W[0][0] + J02 * W[2][0];
      const T01 = J00 * W[0][1] + J02 * W[2][1];
      const T02 = J00 * W[0][2] + J02 * W[2][2];

      const T10 = J11 * W[1][0] + J12 * W[2][0];
      const T11 = J11 * W[1][1] + J12 * W[2][1];
      const T12 = J11 * W[1][2] + J12 * W[2][2];

      // Compute 2D Covariance: Sigma' = T * cov3D * T^T
      // First M = T * cov3D (2x3)
      const M00 = T00 * cov3D[0][0] + T01 * cov3D[1][0] + T02 * cov3D[2][0];
      const M01 = T00 * cov3D[0][1] + T01 * cov3D[1][1] + T02 * cov3D[2][1];
      const M02 = T00 * cov3D[0][2] + T01 * cov3D[1][2] + T02 * cov3D[2][2];

      const M10 = T10 * cov3D[0][0] + T11 * cov3D[1][0] + T12 * cov3D[2][0];
      const M11 = T10 * cov3D[0][1] + T11 * cov3D[1][1] + T12 * cov3D[2][1];
      const M12 = T10 * cov3D[0][2] + T11 * cov3D[1][2] + T12 * cov3D[2][2];

      // Sigma' = M * T^T (2x2) with low-pass blur filter nu = 0.3 to prevent aliasing
      const nu = 0.3;
      let covXX = M00 * T00 + M01 * T01 + M02 * T02 + nu;
      let covXY = M00 * T10 + M01 * T11 + M02 * T12;
      let covYY = M10 * T10 + M11 * T11 + M12 * T12 + nu;

      // Eigenvalue analysis for 2D ellipse bounding radius (3-sigma bound)
      const trace = covXX + covYY;
      const det = covXX * covYY - covXY * covXY;
      if (det <= 0.0001) continue;

      const term = Math.sqrt(Math.max(0.1, (trace * trace) / 4 - det));
      const lambda1 = trace / 2 + term;
      const radius = Math.ceil(3 * Math.sqrt(Math.max(lambda1, 1)));

      // Frustum culling: check if bounding box intersects screen
      if (
        screenX + radius < 0 ||
        screenX - radius > width ||
        screenY + radius < 0 ||
        screenY - radius > height
      ) {
        continue;
      }

      // Inverse 2D covariance for fast rasterization
      const invDet = 1 / det;
      const invCov2D: [number, number, number] = [
        covYY * invDet,
        -covXY * invDet,
        covXX * invDet
      ];

      // Direction vector from camera to splat
      const viewDir: Vector3 = [
        splat.position[0] - camera.position[0],
        splat.position[1] - camera.position[1],
        splat.position[2] - camera.position[2]
      ];
      const color = Math3D.evaluateSH(splat.sh, viewDir);

      projected.push({
        splatId: splat.id,
        screenPosition: [screenX, screenY],
        depth: tz,
        cov2D: [covXX, covXY, covYY],
        invCov2D,
        color,
        opacity: splat.opacity,
        radius
      });
    }

    // Sort front-to-back by depth
    projected.sort((a, b) => a.depth - b.depth);
    return projected;
  }

  /**
   * Renders color at screen coordinate (px, py) by volumetric front-to-back alpha blending
   */
  public renderRay(px: number, py: number, projected: ProjectedGaussian[]): Vector3 {
    let accR = 0;
    let accG = 0;
    let accB = 0;
    let transmittance = 1.0;

    for (const p of projected) {
      const dx = px - p.screenPosition[0];
      const dy = py - p.screenPosition[1];

      // Quick bounding radius check
      if (dx * dx + dy * dy > p.radius * p.radius) {
        continue;
      }

      // Evaluate 2D Gaussian power: -0.5 * (dx * invXX * dx + 2 * dx * invXY * dy + dy * invYY * dy)
      const [invXX, invXY, invYY] = p.invCov2D;
      const power = -0.5 * (dx * dx * invXX + 2 * dx * dy * invXY + dy * dy * invYY);

      if (power > 0) continue; // Out of bounds
      const G = Math.exp(power);
      const alpha = Math.min(0.99, p.opacity * G);

      if (alpha < 0.001) continue;

      const weight = alpha * transmittance;
      accR += p.color[0] * weight;
      accG += p.color[1] * weight;
      accB += p.color[2] * weight;

      transmittance *= 1.0 - alpha;

      // Early ray termination
      if (transmittance < 0.001) {
        break;
      }
    }

    return [
      Math.min(1, accR),
      Math.min(1, accG),
      Math.min(1, accB)
    ];
  }

  /**
   * Adaptive splat density pruning: removes splats with sub-threshold opacity
   */
  public prune(minOpacity: number = 0.05): number {
    let pruned = 0;
    for (const [id, splat] of this.splats.entries()) {
      if (splat.opacity < minOpacity) {
        this.splats.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) {
      this.rebuildGrid();
    }
    return pruned;
  }

  /**
   * Densification: clones under-reconstructed Gaussians and splits oversized Gaussians
   */
  public densify(maxScale: number = 2.0): number {
    let splitCount = 0;
    const newSplats: GaussianSplat[] = [];

    for (const splat of this.splats.values()) {
      const maxDim = Math.max(splat.scale[0], splat.scale[1], splat.scale[2]);
      if (maxDim > maxScale) {
        // Split into two smaller Gaussians
        const newScale: Vector3 = [
          splat.scale[0] / 1.6,
          splat.scale[1] / 1.6,
          splat.scale[2] / 1.6
        ];
        const offset = maxDim * 0.2;

        const s1: GaussianSplat = {
          ...splat,
          id: `${splat.id}_split_1`,
          position: [splat.position[0] + offset, splat.position[1], splat.position[2]],
          scale: newScale
        };
        const s2: GaussianSplat = {
          ...splat,
          id: `${splat.id}_split_2`,
          position: [splat.position[0] - offset, splat.position[1], splat.position[2]],
          scale: newScale
        };

        newSplats.push(s1, s2);
        this.splats.delete(splat.id);
        splitCount++;
      }
    }

    for (const s of newSplats) {
      this.addSplat(s);
    }

    return splitCount;
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const splat of this.splats.values()) {
      this.grid.insert(splat);
    }
  }

  /**
   * Serializes current Gaussian radiance field to standard JSON structure
   */
  public toJSON(): string {
    return JSON.stringify({
      version: '1.0.0',
      count: this.splats.size,
      splats: Array.from(this.splats.values())
    });
  }

  /**
   * Deserializes Gaussian radiance field from JSON structure
   */
  public static fromJSON(jsonStr: string): GaussianVoxelEngine {
    const data = JSON.parse(jsonStr);
    const engine = new GaussianVoxelEngine();
    if (Array.isArray(data.splats)) {
      engine.addSplats(data.splats);
    }
    return engine;
  }
}
