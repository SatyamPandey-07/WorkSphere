# WebXR Spatial Anchor Tracking & Multi-Camera Calibration Guide

This guide provides practical implementation guidance for WebXR spatial anchor tracking, camera frame calibration, 3D AR marker rendering, and compass fallback integration in WorkSphere. It complements the [WebXR Spatial Anchor Persistence Specification](./WEBXR_SPATIAL_ANCHOR_SPECIFICATION.md) and the [WebXR AR Navigation Manual](./WEBXR_AR_NAVIGATION_MANUAL.md) with actionable code, alignment algorithms, and hardware-specific recommendations.

---

## Table of Contents

1. [Overview](#1-overview)
2. [WebXR Matrix Transformation Code](#2-webxr-matrix-transformation-code)
3. [Camera Frame Calibration](#3-camera-frame-calibration)
4. [3D Anchor Alignment Algorithms](#4-3d-anchor-alignment-algorithms)
5. [3D AR Marker Rendering](#5-3d-ar-marker-rendering)
6. [Fallback Compass Integration](#6-fallback-compass-integration)
7. [Hardware Support Matrix](#7-hardware-support-matrix)
8. [Performance Guidelines](#8-performance-guidelines)
9. [Integration Checklist](#9-integration-checklist)

---

## 1. Overview

### Purpose

This guide addresses the practical challenges of placing persistent virtual objects at precise physical locations using WebXR, including:

- Converting between coordinate spaces using 4×4 transformation matrices
- Calibrating AR anchors against known physical reference points
- Aligning anchors across multiple devices and sessions
- Rendering visual markers that communicate anchor state to users
- Providing a functional compass UI when WebXR is unavailable

### When to Use This Guide

| Scenario | Refer To |
|----------|----------|
| Building a new AR feature with spatial anchors | Sections 2–5 |
| Calibrating anchors across multiple devices | Section 4 |
| Rendering desk/waypoint markers in AR | Section 5 |
| Implementing a non-WebXR navigation fallback | Section 6 |
| Diagnosing device compatibility issues | Section 7 |

### Relationship to Existing Documentation

```text
WEBXR_SPATIAL_ANCHOR_SPECIFICATION.md   (persistence, sync, security)
           |
           v
WEBXR_SPATIAL_ANCHOR_GUIDE.md           (this guide: matrix math, calibration, rendering)
           |
           v
WEBXR_AR_NAVIGATION_MANUAL.md           (session lifecycle, arrows, compass)
```

---

## 2. WebXR Matrix Transformation Code

### 2.1 Column-Major 4×4 Matrix Layout

WebXR stores transformation matrices as `Float32Array(16)` in **column-major** order:

```text
Index:  [ 0  4  8 12]     Column 0: X-axis (right)
        [ 1  5  9 13]     Column 1: Y-axis (up)
        [ 2  6 10 14]     Column 2: Z-axis (forward)
        [ 3  7 11 15]     Column 3: Translation

Translation vector: [m[12], m[13], m[14]]
Scale factors:      [m[0],  m[5],  m[10]]  (uniform scale if equal)
Rotation:           3×3 upper-left submatrix
```

### 2.2 Matrix Utilities

All matrix functions operate on `Float32Array(16)` and return `Float32Array(16)`.

```typescript
function createIdentityMatrix(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function createTranslationMatrix(
  x: number, y: number, z: number
): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function createRotationYMatrix(angleRad: number): Float32Array {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return new Float32Array([
     c, 0,  s, 0,
     0, 1,  0, 0,
    -s, 0,  c, 0,
     0, 0,  0, 1,
  ]);
}

function createScaleMatrix(
  sx: number, sy: number, sz: number
): Float32Array {
  return new Float32Array([
    sx, 0,  0,  0,
    0,  sy, 0,  0,
    0,  0,  sz, 0,
    0,  0,  0,  1,
  ]);
}
```

### 2.3 Matrix Multiplication

Composes two transforms: `result = a * b`.

```typescript
function multiplyMatrices(
  a: Float32Array, b: Float32Array
): Float32Array {
  const result = new Float32Array(16);

  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      result[col * 4 + row] = sum;
    }
  }

  return result;
}
```

### 2.4 Matrix Inversion

Required for converting between anchor space and world space.

```typescript
function invertMatrix(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);

  inv[0] = m[5]  * m[10] * m[15] -
           m[5]  * m[11] * m[14] -
           m[9]  * m[6]  * m[15] +
           m[9]  * m[7]  * m[14] +
           m[13] * m[6]  * m[11] -
           m[13] * m[7]  * m[10];

  inv[4] = -m[4]  * m[10] * m[15] +
            m[4]  * m[11] * m[14] +
            m[8]  * m[6]  * m[15] -
            m[8]  * m[7]  * m[14] -
            m[12] * m[6]  * m[11] +
            m[12] * m[7]  * m[10];

  inv[8] = m[4]  * m[9] * m[15] -
           m[4]  * m[11] * m[13] -
           m[8]  * m[5] * m[15] +
           m[8]  * m[7] * m[13] +
           m[12] * m[5] * m[11] -
           m[12] * m[7] * m[9];

  inv[12] = -m[4]  * m[9] * m[14] +
             m[4]  * m[10] * m[13] +
             m[8]  * m[5] * m[14] -
             m[8]  * m[6] * m[13] -
             m[12] * m[5] * m[10] +
             m[12] * m[6] * m[9];

  inv[1] = -m[1]  * m[10] * m[15] +
            m[1]  * m[11] * m[14] +
            m[9]  * m[2] * m[15] -
            m[9]  * m[3] * m[14] -
            m[13] * m[2] * m[11] +
            m[13] * m[3] * m[10];

  inv[5] = m[0]  * m[10] * m[15] -
           m[0]  * m[11] * m[14] -
           m[8]  * m[2] * m[15] +
           m[8]  * m[3] * m[14] +
           m[12] * m[2] * m[11] -
           m[12] * m[3] * m[10];

  inv[9] = -m[0]  * m[9] * m[15] +
            m[0]  * m[11] * m[13] +
            m[8]  * m[1] * m[15] -
            m[8]  * m[3] * m[13] -
            m[12] * m[1] * m[11] +
            m[12] * m[3] * m[9];

  inv[13] = m[0]  * m[9] * m[14] -
            m[0]  * m[10] * m[13] -
            m[8]  * m[1] * m[14] +
            m[8]  * m[2] * m[13] +
            m[12] * m[1] * m[10] -
            m[12] * m[2] * m[9];

  inv[2] = m[1]  * m[6] * m[15] -
           m[1]  * m[7] * m[14] -
           m[5]  * m[2] * m[15] +
           m[5]  * m[3] * m[14] +
           m[13] * m[2] * m[7] -
           m[13] * m[3] * m[6];

  inv[6] = -m[0]  * m[6] * m[15] +
            m[0]  * m[7] * m[14] +
            m[4]  * m[2] * m[15] -
            m[4]  * m[3] * m[14] -
            m[12] * m[2] * m[7] +
            m[12] * m[3] * m[6];

  inv[10] = m[0]  * m[5] * m[15] -
            m[0]  * m[7] * m[13] -
            m[4]  * m[1] * m[15] +
            m[4]  * m[3] * m[13] +
            m[12] * m[1] * m[7] -
            m[12] * m[3] * m[5];

  inv[14] = -m[0]  * m[5] * m[14] +
             m[0]  * m[6] * m[13] +
             m[4]  * m[1] * m[14] -
             m[4]  * m[2] * m[13] -
             m[12] * m[1] * m[6] +
             m[12] * m[2] * m[5];

  inv[3] = m[1]  * m[6] * m[11] -
           m[1]  * m[7] * m[10] -
           m[5]  * m[2] * m[11] +
           m[5]  * m[3] * m[10] +
           m[9]  * m[2] * m[7] -
           m[9]  * m[3] * m[6];

  inv[7] = -m[0]  * m[6] * m[11] +
            m[0]  * m[7] * m[10] +
            m[4]  * m[2] * m[11] -
            m[4]  * m[3] * m[10] -
            m[8]  * m[2] * m[7] +
            m[8]  * m[3] * m[6];

  inv[11] = m[0]  * m[5] * m[11] -
            m[0]  * m[7] * m[9] -
            m[4]  * m[1] * m[11] +
            m[4]  * m[3] * m[9] +
            m[8]  * m[1] * m[7] -
            m[8]  * m[3] * m[5];

  inv[15] = -m[0]  * m[5] * m[10] +
             m[0]  * m[6] * m[9] +
             m[4]  * m[1] * m[10] -
             m[4]  * m[2] * m[9] -
             m[8]  * m[1] * m[6] +
             m[8]  * m[2] * m[5];

  let det = m[0] * inv[0] + m[1] * inv[4] +
            m[2] * inv[8] + m[3] * inv[12];

  if (Math.abs(det) < 1e-6) {
    throw new Error("Matrix is singular and cannot be inverted");
  }

  det = 1.0 / det;
  for (let i = 0; i < 16; i++) {
    inv[i] *= det;
  }

  return inv;
}
```

### 2.5 Transform a Point by a Matrix

Applies a 4×4 matrix to a 3D point (homogeneous w=1).

```typescript
interface Vec3 { x: number; y: number; z: number; }

function transformPoint(
  matrix: Float32Array, point: Vec3
): Vec3 {
  const w =
    matrix[3] * point.x +
    matrix[7] * point.y +
    matrix[11] * point.z +
    matrix[15];

  return {
    x: (matrix[0] * point.x + matrix[4] * point.y +
        matrix[8] * point.z + matrix[12]) / w,
    y: (matrix[1] * point.x + matrix[5] * point.y +
        matrix[9] * point.z + matrix[13]) / w,
    z: (matrix[2] * point.x + matrix[6] * point.y +
        matrix[10] * point.z + matrix[14]) / w,
  };
}
```

### 2.6 Decompose a Matrix

Extracts position, rotation quaternion, and scale from a 4×4 matrix.

```typescript
interface TransformDecomposition {
  position: Vec3;
  quaternion: { x: number; y: number; z: number; w: number };
  scale: Vec3;
}

function decomposeMatrix(m: Float32Array): TransformDecomposition {
  // Translation
  const position: Vec3 = {
    x: m[12],
    y: m[13],
    z: m[14],
  };

  // Scale
  const scaleX = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const scaleY = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
  const scaleZ = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
  const scale: Vec3 = { x: scaleX, y: scaleY, z: scaleZ };

  // Rotation quaternion from 3x3 submatrix
  const trace = m[0] / scaleX + m[5] / scaleY + m[10] / scaleZ;
  let qx: number, qy: number, qz: number, qw: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m[6] / scaleZ - m[9] / scaleY) * s;
    qy = (m[8] / scaleX - m[2] / scaleZ) * s;
    qz = (m[1] / scaleX - m[4] / scaleY) * s;
  } else if (m[0] / scaleX > m[5] / scaleY && m[0] / scaleX > m[10] / scaleZ) {
    const s = 2.0 * Math.sqrt(1.0 + m[0] / scaleX - m[5] / scaleY - m[10] / scaleZ);
    qw = (m[6] / scaleZ - m[9] / scaleY) / s;
    qx = 0.25 * s;
    qy = (m[4] / scaleY + m[1] / scaleX) / s;
    qz = (m[8] / scaleX + m[2] / scaleZ) / s;
  } else if (m[5] / scaleY > m[10] / scaleZ) {
    const s = 2.0 * Math.sqrt(1.0 + m[5] / scaleY - m[0] / scaleX - m[10] / scaleZ);
    qw = (m[8] / scaleX - m[2] / scaleZ) / s;
    qx = (m[4] / scaleY + m[1] / scaleX) / s;
    qy = 0.25 * s;
    qz = (m[9] / scaleY + m[6] / scaleZ) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m[10] / scaleZ - m[0] / scaleX - m[5] / scaleY);
    qw = (m[1] / scaleX - m[4] / scaleY) / s;
    qx = (m[8] / scaleX + m[2] / scaleZ) / s;
    qy = (m[9] / scaleY + m[6] / scaleZ) / s;
    qz = 0.25 * s;
  }

  // Normalize quaternion
  const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  const quaternion = {
    x: qx / len,
    y: qy / len,
    z: qz / len,
    w: qw / len,
  };

  return { position, quaternion, scale };
}
```

### 2.7 Compose a Matrix from Components

Builds a 4×4 matrix from position, quaternion, and scale.

```typescript
function composeMatrix(
  position: Vec3,
  quaternion: { x: number; y: number; z: number; w: number },
  scale: Vec3
): Float32Array {
  const { x: qx, y: qy, z: qz, w: qw } = quaternion;

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return new Float32Array([
    (1 - (yy + zz)) * scale.x, (xy + wz) * scale.x,       (xz - wy) * scale.x,       0,
    (xy - wz) * scale.y,       (1 - (xx + zz)) * scale.y,  (yz + wx) * scale.y,       0,
    (xz + wy) * scale.z,       (yz - wx) * scale.z,        (1 - (xx + yy)) * scale.z, 0,
    position.x,                position.y,                  position.z,                 1,
  ]);
}
```

---

## 3. Camera Frame Calibration

Camera frame calibration aligns the WebXR local coordinate system with a known physical reference frame. Without calibration, anchors exist only in the device's ephemeral local space.

### 3.1 Calibration Methods

| Method | Accuracy | Setup Time | Equipment | Best For |
|--------|----------|------------|-----------|----------|
| **QR/AprilTag Marker** | 1–3 cm | ~5 s | Printed marker | Permanent venues |
| **Known-Point Pair** | 2–5 cm | ~10 s | Ruler/tape | Ad-hoc calibration |
| **Multi-User Consensus** | 3–8 cm | ~30 s | 2+ devices | Collaborative sessions |
| **Geographic (GPS+Heading)** | 1–5 m | ~3 s | GPS + compass | Outdoor only |

### 3.2 QR Marker Calibration Workflow

```text
1. Place printed QR marker on floor at known position
2. Start WebXR session
3. Hit-test to detect marker plane
4. Create anchor at hit-test pose
5. Decode QR to retrieve known world coordinates
6. Compute alignment transform:
     T_align = T_known * T_detected^-1
7. Store alignment transform for session
8. All subsequent anchors use T_align to convert
   local → world coordinates
```

### 3.3 Hit-Test to Anchor

```typescript
async function calibrateFromHitTest(
  session: XRSession,
  referenceSpace: XRReferenceSpace,
  knownPosition: Vec3
): Promise<Float32Array> {
  const hitTestSource = await session.requestHitTestSource({
    space: referenceSpace,
    entityTypes: ["plane"],
  });

  return new Promise((resolve) => {
    session.requestAnimationFrame(async (time, frame) => {
      const results = frame.getHitTestResults(hitTestSource);

      if (results.length === 0) {
        throw new Error("No hit-test result detected");
      }

      const pose = results[0].getPose(referenceSpace);
      if (!pose) {
        throw new Error("Failed to get hit-test pose");
      }

      const detectedMatrix = pose.transform.matrix;

      // Build alignment: T_known * T_detected^-1
      const detectedInverse = invertMatrix(detectedMatrix);
      const knownMatrix = createTranslationMatrix(
        knownPosition.x, knownPosition.y, knownPosition.z
      );
      const alignment = multiplyMatrices(knownMatrix, detectedInverse);

      hitTestSource.cancel();
      resolve(alignment);
    });
  });
}
```

### 3.4 Known-Point Pair Calibration

When no QR marker is available, the user identifies two known physical points:

```typescript
interface CalibrationPoint {
  worldPosition: Vec3;  // Known physical position (metres)
  localPose: Vec3;      // Observed XR position
}

function computePairCalibration(
  pointA: CalibrationPoint,
  pointB: CalibrationPoint
): Float32Array {
  // Translation aligns point A
  const dx = pointA.worldPosition.x - pointA.localPose.x;
  const dy = pointA.worldPosition.y - pointA.localPose.y;
  const dz = pointA.worldPosition.z - pointA.localPose.z;

  // Compute heading from the two-point vector
  const localDx = pointB.localPose.x - pointA.localPose.x;
  const localDz = pointB.localPose.z - pointA.localPose.z;
  const worldDx = pointB.worldPosition.x - pointA.worldPosition.x;
  const worldDz = pointB.worldPosition.z - pointA.worldPosition.z;

  const localAngle = Math.atan2(localDx, -localDz);
  const worldAngle = Math.atan2(worldDx, -worldDz);
  const headingCorrection = worldAngle - localAngle;

  // Compose: rotate then translate
  const rotation = createRotationYMatrix(headingCorrection);
  const translation = createTranslationMatrix(dx, dy, dz);

  return multiplyMatrices(translation, rotation);
}
```

### 3.5 Applying Calibration to Anchors

Once the alignment transform `T_align` is computed, all anchor positions are converted from local to world space:

```typescript
function localToWorld(
  localMatrix: Float32Array,
  alignmentMatrix: Float32Array
): Float32Array {
  return multiplyMatrices(alignmentMatrix, localMatrix);
}

function worldToLocal(
  worldMatrix: Float32Array,
  alignmentMatrix: Float32Array
): Float32Array {
  const inverse = invertMatrix(alignmentMatrix);
  return multiplyMatrices(inverse, worldMatrix);
}
```

---

## 4. 3D Anchor Alignment Algorithms

### 4.1 Single-Point Alignment (Translation Only)

Corrects translational offset when the XR origin is displaced from the true physical origin.

```typescript
function alignTranslation(
  observedOrigin: Vec3,
  trueOrigin: Vec3
): Float32Array {
  return createTranslationMatrix(
    trueOrigin.x - observedOrigin.x,
    trueOrigin.y - observedOrigin.y,
    trueOrigin.z - observedOrigin.z
  );
}

// Usage:
// User stands at known position (2.0, 0.0, -3.0)
// XR reports their position as (0.5, 0.0, -1.2)
const alignment = alignTranslation(
  { x: 0.5, y: 0.0, z: -1.2 },
  { x: 2.0, y: 0.0, z: -3.0 }
);
// alignment translates by (+1.5, 0.0, -1.8)
```

### 4.2 Two-Point Rigid Alignment

Corrects both translation and rotation using two reference points. Minimizes reprojection error via rigid-body transform.

```typescript
interface AlignmentResult {
  transform: Float32Array;
  reprojectionError: number;  // metres
}

function twoPointRigidAlignment(
  observedA: Vec3, knownA: Vec3,
  observedB: Vec3, knownB: Vec3
): AlignmentResult {
  // Centroids
  const observedCenter: Vec3 = {
    x: (observedA.x + observedB.x) / 2,
    y: (observedA.y + observedB.y) / 2,
    z: (observedA.z + observedB.z) / 2,
  };
  const knownCenter: Vec3 = {
    x: (knownA.x + knownB.x) / 2,
    y: (knownA.y + knownB.y) / 2,
    z: (knownA.z + knownB.z) / 2,
  };

  // Centered vectors
  const vObsA = { x: observedA.x - observedCenter.x, y: observedA.y - observedCenter.y, z: observedA.z - observedCenter.z };
  const vObsB = { x: observedB.x - observedCenter.x, y: observedB.y - observedCenter.y, z: observedB.z - observedCenter.z };
  const vKnoA = { x: knownA.x - knownCenter.x, y: knownA.y - knownCenter.y, z: knownA.z - knownCenter.z };
  const vKnoB = { x: knownB.x - knownCenter.x, y: knownB.y - knownCenter.y, z: knownB.z - knownCenter.z };

  // Heading angles (Y-axis rotation)
  const obsAngle = Math.atan2(vObsA.x, -vObsA.z);
  const knoAngle = Math.atan2(vKnoA.x, -vKnoA.z);
  const angleDiff = knoAngle - obsAngle;

  const rotation = createRotationYMatrix(angleDiff);
  const translation = createTranslationMatrix(
    knownCenter.x - observedCenter.x,
    knownCenter.y - observedCenter.y,
    knownCenter.z - observedCenter.z
  );

  const transform = multiplyMatrices(translation, rotation);

  // Compute reprojection error
  const reprojectedA = transformPoint(transform, observedA);
  const reprojectedB = transformPoint(transform, observedB);

  const errorA = Math.sqrt(
    (reprojectedA.x - knownA.x) ** 2 +
    (reprojectedA.y - knownA.y) ** 2 +
    (reprojectedA.z - knownA.z) ** 2
  );
  const errorB = Math.sqrt(
    (reprojectedB.x - knownB.x) ** 2 +
    (reprojectedB.y - knownB.y) ** 2 +
    (reprojectedB.z - knownB.z) ** 2
  );

  return {
    transform,
    reprojectionError: (errorA + errorB) / 2,
  };
}
```

### 4.3 Multi-Point SVD Alignment (Least-Squares)

For three or more calibration points, use Singular Value Decomposition to find the optimal rigid transform that minimizes total reprojection error.

```typescript
interface MultiPointResult {
  transform: Float32Array;
  meanError: number;
  maxError: number;
}

function multiPointAlignment(
  observed: Vec3[],
  known: Vec3[]
): MultiPointResult {
  if (observed.length !== known.length || observed.length < 3) {
    throw new Error("Need at least 3 point pairs");
  }

  const n = observed.length;

  // Compute centroids
  const obsCentroid = { x: 0, y: 0, z: 0 };
  const knoCentroid = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    obsCentroid.x += observed[i].x;
    obsCentroid.y += observed[i].y;
    obsCentroid.z += observed[i].z;
    knoCentroid.x += known[i].x;
    knoCentroid.y += known[i].y;
    knoCentroid.z += known[i].z;
  }
  obsCentroid.x /= n; obsCentroid.y /= n; obsCentroid.z /= n;
  knoCentroid.x /= n; knoCentroid.y /= n; knoCentroid.z /= n;

  // Build cross-covariance matrix H (3×3)
  let h00 = 0, h01 = 0, h02 = 0;
  let h10 = 0, h11 = 0, h12 = 0;
  let h20 = 0, h21 = 0, h22 = 0;

  for (let i = 0; i < n; i++) {
    const ox = observed[i].x - obsCentroid.x;
    const oy = observed[i].y - obsCentroid.y;
    const oz = observed[i].z - obsCentroid.z;
    const kx = known[i].x - knoCentroid.x;
    const ky = known[i].y - knoCentroid.y;
    const kz = known[i].z - knoCentroid.z;

    h00 += kx * ox; h01 += kx * oy; h02 += kx * oz;
    h10 += ky * ox; h11 += ky * oy; h12 += ky * oz;
    h20 += kz * ox; h21 += kz * oy; h22 += kz * oz;
  }

  // Simplified 3×3 SVD via Jacobi rotations
  // (For production, use a dedicated linear algebra library)
  const H = [[h00, h01, h02], [h10, h11, h12], [h20, h21, h22]];
  const { U, V } = svd3x3(H);

  // Rotation R = V * U^T
  const R = multiplyMatrices3(V, transposeMatrix3(U));

  // Ensure proper rotation (det = +1)
  const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
            - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
            + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (det < 0) {
    R[0][2] *= -1; R[1][2] *= -1; R[2][2] *= -1;
  }

  // Translation t = knownCentroid - R * observedCentroid
  const t = {
    x: knoCentroid.x - (R[0][0] * obsCentroid.x + R[0][1] * obsCentroid.y + R[0][2] * obsCentroid.z),
    y: knoCentroid.y - (R[1][0] * obsCentroid.x + R[1][1] * obsCentroid.y + R[1][2] * obsCentroid.z),
    z: knoCentroid.z - (R[2][0] * obsCentroid.x + R[2][1] * obsCentroid.y + R[2][2] * obsCentroid.z),
  };

  // Compose 4×4 matrix
  const transform = new Float32Array([
    R[0][0], R[1][0], R[2][0], 0,
    R[0][1], R[1][1], R[2][1], 0,
    R[0][2], R[1][2], R[2][2], 0,
    t.x,     t.y,     t.z,     1,
  ]);

  // Compute per-point errors
  let totalError = 0, maxErr = 0;
  for (let i = 0; i < n; i++) {
    const reprojected = transformPoint(transform, observed[i]);
    const err = Math.sqrt(
      (reprojected.x - known[i].x) ** 2 +
      (reprojected.y - known[i].y) ** 2 +
      (reprojected.z - known[i].z) ** 2
    );
    totalError += err;
    maxErr = Math.max(maxErr, err);
  }

  return {
    transform,
    meanError: totalError / n,
    maxError: maxErr,
  };
}
```

> **Note:** The `svd3x3` helper decomposes a 3×3 matrix into `U * Σ * V^T`. For production use, integrate a lightweight SVD library such as `ml-matrix` or implement Jacobi eigenvalue iteration. The algorithm above describes the mathematical flow.

### 4.4 Alignment Quality Validation

```typescript
interface AlignmentQuality {
  passed: boolean;
  meanErrorCm: number;
  maxErrorCm: number;
  warnings: string[];
}

function validateAlignment(
  result: MultiPointResult,
  thresholdCm: number = 5.0
): AlignmentQuality {
  const meanCm = result.meanError * 100;
  const maxCm = result.maxError * 100;
  const warnings: string[] = [];

  if (meanCm > thresholdCm) {
    warnings.push(
      `Mean reprojection error ${meanCm.toFixed(1)} cm exceeds ${thresholdCm} cm threshold`
    );
  }

  if (maxCm > thresholdCm * 2) {
    warnings.push(
      `Max error ${maxCm.toFixed(1)} cm is more than 2x threshold — check calibration points`
    );
  }

  if (result.meanError < 0.01) {
    warnings.push("Suspiciously low error — verify points are not identical");
  }

  return {
    passed: warnings.length === 0,
    meanErrorCm: meanCm,
    maxErrorCm: maxCm,
    warnings,
  };
}
```

### 4.5 Drift Correction

Over time, SLAM tracking accumulates drift. Correct it by periodically re-anchoring against known reference markers.

```typescript
function computeDriftCorrection(
  currentPose: Vec3,
  expectedPose: Vec3,
  confidence: number
): Float32Array {
  // Only correct when confidence is high enough
  if (confidence < 0.7) {
    return createIdentityMatrix();
  }

  const correction = createTranslationMatrix(
    expectedPose.x - currentPose.x,
    expectedPose.y - currentPose.y,
    expectedPose.z - currentPose.z
  );

  // Smooth the correction to avoid jitter
  const smoothing = 0.1;
  return lerpMatrix(createIdentityMatrix(), correction, smoothing);
}

function lerpMatrix(
  a: Float32Array, b: Float32Array, t: number
): Float32Array {
  const result = new Float32Array(16);
  for (let i = 0; i < 16; i++) {
    result[i] = a[i] + (b[i] - a[i]) * t;
  }
  return result;
}
```

---

## 5. 3D AR Marker Rendering

### 5.1 Marker Type Specifications

| Marker Type | Primary Color | Geometry | Indicator | Use Case |
|-------------|---------------|----------|-----------|----------|
| Available Desk | Green (`#22c55e`) | Ring + circle | Pulsing glow | Bookable workspace |
| Occupied Desk | Red (`#ef4444`) | Ring + circle | Static | In-use workspace |
| Reserved Desk | Yellow (`#eab308`) | Ring + circle | Breathing pulse | User-reserved |
| Waypoint | Blue (`#3b82f6`) | Cone (forward-facing) | Bobbing animation | Navigation path |
| Exit | Gray (`#6b7280`) | Door icon | Flashing | Emergency exit |
| Calibration Point | Cyan (`#06b6d4`) | Crosshair + ring | Spinning | Active calibration |

### 5.2 Three.js Marker Factory

```typescript
import * as THREE from "three";

type MarkerType =
  | "available"
  | "occupied"
  | "reserved"
  | "waypoint"
  | "exit"
  | "calibration";

const MARKER_COLORS: Record<MarkerType, number> = {
  available:    0x22c55e,
  occupied:     0xef4444,
  reserved:     0xeab308,
  waypoint:     0x3b82f6,
  exit:         0x6b7280,
  calibration:  0x06b6d4,
};

function createMarker(
  type: MarkerType,
  size: number = 0.3
): THREE.Group {
  const group = new THREE.Group();
  group.userData.markerType = type;

  const color = MARKER_COLORS[type];

  if (type === "waypoint") {
    return createWaypointMarker(color, size);
  }

  if (type === "exit") {
    return createExitMarker(color, size);
  }

  if (type === "calibration") {
    return createCalibrationMarker(color, size);
  }

  // Ring + circle for desk markers
  const ringGeometry = new THREE.RingGeometry(
    size, size + 0.05, 64
  );
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.name = "ring";
  group.add(ring);

  const circleGeometry = new THREE.CircleGeometry(
    size - 0.02, 64
  );
  const circleMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
  });
  const circle = new THREE.Mesh(circleGeometry, circleMaterial);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.001;
  circle.name = "circle";
  group.add(circle);

  return group;
}

function createWaypointMarker(
  color: number, size: number
): THREE.Group {
  const group = new THREE.Group();

  const geometry = new THREE.ConeGeometry(
    size * 0.35, size, 32
  );
  geometry.rotateX(Math.PI / 2);

  const material = new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: 0.8,
    shininess: 100,
  });

  const arrow = new THREE.Mesh(geometry, material);
  arrow.name = "arrow";
  group.add(arrow);

  return group;
}

function createExitMarker(
  color: number, size: number
): THREE.Group {
  const group = new THREE.Group();

  // Door frame
  const frameGeometry = new THREE.BoxGeometry(
    size * 0.8, size, 0.02
  );
  const frameMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.y = size / 2;
  frame.name = "frame";
  group.add(frame);

  // Arrow indicator
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, size * 0.15);
  arrowShape.lineTo(size * 0.15, 0);
  arrowShape.lineTo(0, -size * 0.15);
  arrowShape.lineTo(0, size * 0.05);
  arrowShape.lineTo(-size * 0.05, size * 0.05);
  arrowShape.lineTo(-size * 0.05, -size * 0.05);
  arrowShape.lineTo(0, -size * 0.05);

  const arrowGeometry = new THREE.ShapeGeometry(arrowShape);
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
  arrow.position.set(0, size * 0.5, 0.011);
  arrow.name = "arrow";
  group.add(arrow);

  return group;
}

function createCalibrationMarker(
  color: number, size: number
): THREE.Group {
  const group = new THREE.Group();

  // Outer ring
  const ringGeometry = new THREE.RingGeometry(
    size * 0.8, size, 64
  );
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.name = "ring";
  group.add(ring);

  // Crosshair lines
  const lineMaterial = new THREE.LineBasicMaterial({ color });

  const horizontalPoints = [
    new THREE.Vector3(-size * 0.5, 0.001, 0),
    new THREE.Vector3(size * 0.5, 0.001, 0),
  ];
  const hGeometry = new THREE.BufferGeometry().setFromPoints(horizontalPoints);
  group.add(new THREE.Line(hGeometry, lineMaterial));

  const verticalPoints = [
    new THREE.Vector3(0, 0.001, -size * 0.5),
    new THREE.Vector3(0, 0.001, size * 0.5),
  ];
  const vGeometry = new THREE.BufferGeometry().setFromPoints(verticalPoints);
  group.add(new THREE.Line(vGeometry, lineMaterial));

  return group;
}
```

### 5.3 Marker Animation System

```typescript
function animateMarker(
  marker: THREE.Group,
  time: number,
  deltaTime: number
): void {
  const type = marker.userData.markerType as MarkerType;

  switch (type) {
    case "available":
      animatePulse(marker, time);
      break;
    case "reserved":
      animateBreathing(marker, time);
      break;
    case "waypoint":
      animateBobbing(marker, time);
      break;
    case "exit":
      animateFlashing(marker, time);
      break;
    case "calibration":
      animateSpinning(marker, time);
      break;
    case "occupied":
      // Static — no animation
      break;
  }
}

function animatePulse(marker: THREE.Group, time: number): void {
  const ring = marker.getObjectByName("ring") as THREE.Mesh;
  if (!ring) return;

  const scale = 1.0 + Math.sin(time * 0.003) * 0.05;
  ring.scale.set(scale, scale, 1);
  (ring.material as THREE.MeshBasicMaterial).opacity =
    0.6 + Math.sin(time * 0.003) * 0.2;
}

function animateBreathing(marker: THREE.Group, time: number): void {
  const ring = marker.getObjectByName("ring") as THREE.Mesh;
  if (!ring) return;

  const opacity = 0.5 + Math.sin(time * 0.002) * 0.3;
  (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
}

function animateBobbing(marker: THREE.Group, time: number): void {
  marker.position.y = Math.sin(time * 0.003) * 0.05;
}

function animateFlashing(marker: THREE.Group, time: number): void {
  const frame = marker.getObjectByName("frame") as THREE.Mesh;
  if (!frame) return;

  const visible = Math.sin(time * 0.004) > 0;
  frame.visible = visible;
}

function animateSpinning(marker: THREE.Group, time: number): void {
  marker.rotation.y = time * 0.001;
}
```

### 5.4 LOD (Level of Detail) System

Reduces marker complexity at distance to maintain 60 FPS on mobile.

```typescript
enum LODLevel {
  High,   // < 2 m — full geometry
  Medium, // 2–5 m — reduced segments
  Low,    // 5–10 m — flat disc
  Cull,   // > 10 m — not rendered
}

function getMarkerLOD(
  cameraPosition: Vec3,
  markerPosition: Vec3
): LODLevel {
  const dx = cameraPosition.x - markerPosition.x;
  const dy = cameraPosition.y - markerPosition.y;
  const dz = cameraPosition.z - markerPosition.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance < 2)  return LODLevel.High;
  if (distance < 5)  return LODLevel.Medium;
  if (distance < 10) return LODLevel.Low;
  return LODLevel.Cull;
}

const LOD_SEGMENTS: Record<LODLevel, number> = {
  [LODLevel.High]:   64,
  [LODLevel.Medium]: 32,
  [LODLevel.Low]:    8,
  [LODLevel.Cull]:   0,
};
```

---

## 6. Fallback Compass Integration

When WebXR is unsupported or session creation fails, `CompassFallback` provides directional guidance using the device's magnetometer/accelerometer.

### 6.1 Device Orientation Reading

```typescript
function getDeviceHeading(): Promise<number | null> {
  return new Promise((resolve) => {
    if (!window.DeviceOrientationEvent) {
      resolve(null);
      return;
    }

    // iOS 13+ requires permission
    if (
      typeof (DeviceOrientationEvent as any).requestPermission ===
      "function"
    ) {
      (DeviceOrientationEvent as any)
        .requestPermission()
        .then((state: string) => {
          if (state === "granted") {
            listenOrientation(resolve);
          } else {
            resolve(null);
          }
        })
        .catch(() => resolve(null));
    } else {
      listenOrientation(resolve);
    }
  });
}

function listenOrientation(
  resolve: (heading: number | null) => void
): void {
  window.addEventListener(
    "deviceorientation",
    (event: DeviceOrientationEvent) => {
      // iOS provides webkitCompassHeading (degrees from north)
      if (
        "webkitCompassHeading" in event &&
        event.webkitCompassHeading !== undefined
      ) {
        resolve(event.webkitCompassHeading);
        return;
      }

      // Android: alpha is degrees from initial orientation
      if (event.alpha !== null) {
        resolve((360 - event.alpha) % 360);
        return;
      }

      resolve(null);
    },
    { once: true }
  );
}
```

### 6.2 Bearing Calculation

Given current GPS position and destination, compute the compass bearing.

```typescript
function computeBearing(
  currentLat: number, currentLon: number,
  destLat: number, destLon: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const lat1 = toRad(currentLat);
  const lat2 = toRad(destLat);
  const dLon = toRad(destLon - currentLon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
```

### 6.3 Compass-to-Arrow Rotation

```typescript
function compassArrowRotation(
  deviceHeading: number | null,
  destinationBearing: number
): number {
  if (deviceHeading === null) return 0;
  return ((destinationBearing - deviceHeading + 360) % 360);
}
```

### 6.4 Compass Fallback Component

```tsx
function CompassFallback({
  destinationBearing,
  distance,
}: {
  destinationBearing: number;
  distance: number;
}) {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    getDeviceHeading().then(setHeading);
    const interval = setInterval(async () => {
      const h = await getDeviceHeading();
      setHeading(h);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const arrowRotation = compassArrowRotation(
    heading, destinationBearing
  );

  return (
    <div className="compass-fallback">
      <div
        className="compass-arrow"
        style={{
          transform: `rotate(${arrowRotation}deg)`,
        }}
      />
      <div className="compass-distance">
        {distance < 1000
          ? `${Math.round(distance)} m`
          : `${(distance / 1000).toFixed(1)} km`}
      </div>
    </div>
  );
}
```

### 6.5 Compass Accuracy Considerations

| Factor | Impact | Mitigation |
|--------|--------|------------|
| Magnetic interference | ±10–30° deviation | Calibrate on-site; warn user |
| Indoor steel structures | Severe deviation | Prefer WebXR when available |
| Device tilt | Incorrect heading on non-flat hold | Use `alpha` + `beta` + `gamma` fusion |
| Gyroscope drift | Heading drifts over time | Re-calibrate against GPS periodically |
| No magnetometer | Heading unavailable | Show "direction unknown" UI |

---

## 7. Hardware Support Matrix

### 7.1 Browser WebXR Support

| Browser | WebXR immersive-ar | Anchors | Hit-Test | Camera Access | Notes |
|---------|--------------------:|---------|----------|---------------|-------|
| **Chrome 79+ (Android)** | Full | Yes | Yes | Via WebXR | Primary target |
| **Edge 79+ (Windows)** | Full | Yes | Yes | Via WebXR | HoloLens native |
| **Samsung Internet** | Partial | Varies | Varies | Via WebXR | Device-dependent |
| **Firefox** | Behind flag | No | No | No | Experimental |
| **Safari 17+ (iOS)** | Limited | No | No | Via `getUserMedia` | No immersive-ar session |
| **Quest Browser** | Full | Yes | Yes | Via WebXR | Quest 2/3/Pro |
| **Chrome Desktop** | No immersive AR | No | No | N/A | Desktop AR unsupported |

### 7.2 Device Capability Matrix

| Device | Immersive AR | Spatial Anchors | Hit-Test | Camera Pose | Magnetometer | Min Browser |
|--------|:------------:|:---------------:|:--------:|:-----------:|:------------:|-------------|
| **Android (ARCore)** | Full | Full | Full | SLAM | Yes | Chrome 79+ |
| **Android (no ARCore)** | None | None | None | None | Yes | Any |
| **iPhone 12+** | None | None | None | None | Yes | Safari 17+ |
| **iPad Pro (M1+)** | None | None | None | None | Yes | Safari 17+ |
| **Meta Quest 2/3/Pro** | Full | Full | Full | SLAM | Yes | Quest Browser |
| **HoloLens 2** | Full | Full | Full | SLAM | Yes | Edge 79+ |
| **Desktop (no XR)** | None | None | None | None | No | Any |

### 7.3 Sensor Availability

| Sensor | Android Chrome | iOS Safari | Quest | HoloLens | Fallback |
|--------|:-:|:-:|:-:|:-:|-----------|
| Accelerometer | Yes | Yes | Yes | Yes | — |
| Gyroscope | Yes | Yes | Yes | Yes | — |
| Magnetometer | Yes | Yes | Yes | Yes | GPS heading |
| GPS/GNSS | Yes | Yes | No | No | Wi-Fi positioning |
| Camera (AR) | Via WebXR | Via `getUserMedia` | Via WebXR | Via WebXR | 2D compass |
| Depth Sensor | Via WebXR (ARCore) | No | Via WebXR | Via WebXR | — |

### 7.4 Feature Detection Code

```typescript
interface ARCapabilities {
  webxrAvailable: boolean;
  immersiveArSupported: boolean;
  anchorsSupported: boolean;
  hitTestSupported: boolean;
  deviceOrientationAvailable: boolean;
  magnetometerAvailable: boolean;
  cameraAvailable: boolean;
}

async function detectARCapabilities(): Promise<ARCapabilities> {
  const webxrAvailable = "xr" in navigator;

  let immersiveArSupported = false;
  if (webxrAvailable) {
    immersiveArSupported = await navigator.xr!.isSessionSupported(
      "immersive-ar"
    );
  }

  const deviceOrientationAvailable =
    "DeviceOrientationEvent" in window;

  let magnetometerAvailable = false;
  if ("Sensor" in window) {
    try {
      const magnetometer = new (window as any).Magnetometer();
      magnetometer.start();
      magnetometerAvailable = true;
      magnetometer.stop();
    } catch {
      magnetometerAvailable = false;
    }
  }

  const cameraAvailable =
    "mediaDevices" in navigator &&
    "getUserMedia" in navigator.mediaDevices;

  return {
    webxrAvailable,
    immersiveArSupported,
    anchorsSupported: immersiveArSupported,
    hitTestSupported: immersiveArSupported,
    deviceOrientationAvailable,
    magnetometerAvailable,
    cameraAvailable,
  };
}
```

### 7.5 Graceful Degradation Flow

```text
Feature Detection
      |
      v
immersive-ar supported?
  | yes              | no
  v                  v
Full AR mode    DeviceOrientation available?
                  | yes          | no
                  v              v
            Compass fallback    Static 2D map
            with bearing        with last known
                                heading
```

---

## 8. Performance Guidelines

### 8.1 AR Rendering Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Frame rate | 60 FPS | `XRFrame` timing |
| Draw calls | < 20 / frame | GPU profiler |
| Triangles per marker | < 500 | Geometry count |
| Total triangle count | < 10,000 | Scene graph |
| Anchor creation latency | < 50 ms | `performance.now()` |
| Matrix computation | < 5 ms | Render loop timing |
| Calibration alignment | < 200 ms | SVD computation |
| Memory per anchor | < 2 KB | Heap snapshot |

### 8.2 Mobile Optimization Strategies

1. **Object pooling** — Reuse `THREE.Group` marker instances instead of creating/destroying.
2. **Frustum culling** — Only render markers within the camera's view frustum.
3. **LOD system** — Reduce polygon count for distant markers (Section 5.4).
4. **Batch updates** — Group multiple anchor matrix updates into a single frame.
5. **Web Workers** — Offload SVD alignment and matrix inversions to a worker thread.
6. **Quantized storage** — Use `Float32Array` (64 B) for runtime, `Int16` quantized (32 B) for IndexedDB storage.

### 8.3 Calibration Performance

| Calibration Method | Computation Time (Mobile) | Computation Time (Desktop) |
|--------------------|--------------------------:|---------------------------:|
| Single-point (translation) | < 1 ms | < 1 ms |
| Two-point (rigid) | < 5 ms | < 2 ms |
| Multi-point SVD (5 points) | < 50 ms | < 20 ms |
| Multi-point SVD (10 points) | < 150 ms | < 60 ms |

---

## 9. Integration Checklist

Use the following checklist when implementing spatial anchor tracking and calibration in the WorkSphere codebase.

- [ ] Add matrix utility functions to `src/lib/webxr/matrixUtils.ts` (invert, multiply, decompose, compose).
- [ ] Implement calibration module at `src/lib/webxr/calibration.ts` (hit-test, pair, multi-point alignment).
- [ ] Create `src/lib/webxr/featureDetection.ts` for device capability detection.
- [ ] Extend `src/hooks/useWebXR.ts` to request `anchors` and `hit-test` features.
- [ ] Implement marker factory at `src/components/ar/MarkerFactory.tsx` following the Three.js patterns in `ARNavigation.tsx`.
- [ ] Create `src/components/ar/CalibrationOverlay.tsx` for visual calibration UI.
- [ ] Add marker LOD system to the render loop in `ARNavigation.tsx`.
- [ ] Create `src/lib/webxr/compassFallback.ts` for device orientation and bearing calculation.
- [ ] Update `src/components/ar/CompassFallback.tsx` with bearing-based arrow rotation.
- [ ] Add drift correction to the render loop using periodic re-anchoring.
- [ ] Document device-specific quirks in the browser compatibility section.
- [ ] Update `TODO.md` to mark completed implementation items.

---

## References

- [WebXR Device API Specification](https://www.w3.org/TR/webxr/)
- [WebXR Anchors Module](https://immersive-web.github.io/webxr-anchors/)
- [WebXR Hit Test Module](https://immersive-web.github.io/webxr-hit-test/)
- [Three.js Documentation](https://threejs.org/docs/)
- [WorkXR Spatial Anchor Persistence Specification](./WEBXR_SPATIAL_ANCHOR_SPECIFICATION.md)
- [WebXR AR Navigation Manual](./WEBXR_AR_NAVIGATION_MANUAL.md)
