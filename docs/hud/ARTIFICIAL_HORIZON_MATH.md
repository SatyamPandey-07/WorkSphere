# Artificial Horizon Mathematics & Euler-Quaternion Transformations

This document outlines the geometric foundations, rotation kinematics, and interpolation mathematics utilized to project and render the WorkSphere Cockpit Artificial Horizon and attitude indicator symbology.

---

## 1. Flight Dynamics Coordinate System

We adopt the standard aerospace right-handed Cartesian frame:
- **X-axis**: Lateral axis (Right wing positive)
- **Y-axis**: Vertical axis (Upward positive)
- **Z-axis**: Longitudinal axis (Nose forward positive)

### Attitude Angles (Tait-Bryan Angles)
- **Roll ($\phi$)**: Rotation about the longitudinal axis $Z$ ($\phi \in [-\pi, \pi]$).
- **Pitch ($\theta$)**: Rotation about the lateral axis $X$ ($\theta \in [-\pi/2, \pi/2]$).
- **Yaw / Heading ($\psi$)**: Rotation about the vertical axis $Y$ ($\psi \in [0, 2\pi)$).

---

## 2. 2D Screen Horizon Line Projection

The artificial horizon line transforms in 2D viewport coordinates $(\Delta x, \Delta y)$ according to pitch displacement and roll counter-rotation.

### Pitch Linear Displacement
Given the vertical field of view ($FOV_v$) and viewport screen height ($H$ in pixels), the pitch scaling constant $k_p$ (pixels per radian) is:

$$k_p = \frac{H}{2 \cdot \tan\left(\frac{FOV_v}{2}\right)}$$

For small to moderate pitch angles $\theta$, the vertical ladder shift $d_y$ is modeled as:

$$d_y = k_p \cdot \sin(\theta)$$

### Roll Affine Transformation
To keep the horizon parallel to the Earth's true horizon regardless of aircraft bank angle, the projected HUD symbols undergo an inverse roll rotation:

$$\begin{bmatrix} x' \\ y' \end{bmatrix} = \begin{bmatrix} \cos(-\phi) & -\sin(-\phi) \\ \sin(-\phi) & \cos(-\phi) \end{bmatrix} \begin{bmatrix} x \\ y - d_y \end{bmatrix}$$

---

## 3. Direction Cosine Matrix (Euler Rotation)

Applying successive intrinsic rotations in $Z$-$X$-$Y$ order (Roll $\to$ Pitch $\to$ Yaw) yields the composite rotation matrix $\mathbf{R} = \mathbf{R}_y(\psi)\mathbf{R}_x(\theta)\mathbf{R}_z(\phi)$:

$$\mathbf{R} = \begin{bmatrix}
\cos\psi\cos\phi - \sin\psi\sin\theta\sin\phi & -\cos\psi\sin\phi - \sin\psi\sin\theta\cos\phi & \sin\psi\cos\theta \\
\cos\theta\sin\phi & \cos\theta\cos\phi & \sin\theta \\
-\sin\psi\cos\phi - \cos\psi\sin\theta\sin\phi & \sin\psi\sin\phi - \cos\psi\sin\theta\cos\phi & \cos\psi\cos\theta
\end{bmatrix}$$

### Gimbal Lock Singularity
When pitch reaches extreme attitude ($\theta = \pm 90^\circ$ or $\pm \frac{\pi}{2}$), $\cos\theta = 0$, collapsing roll and yaw into a single degree of freedom ($\phi \pm \psi$). To avoid this singular state during extreme flight envelope dynamics, spatial orientations are tracked internally via unit quaternions.

---

## 4. Euler Angles to Unit Quaternion Conversion

A unit quaternion $\mathbf{q} = [w, x, y, z]^T$ satisfies $w^2 + x^2 + y^2 + z^2 = 1$. The conversion from half-angles yields:

$$\begin{aligned}
w &= \cos(\phi/2)\cos(\theta/2)\cos(\psi/2) + \sin(\phi/2)\sin(\theta/2)\sin(\psi/2) \\
x &= \sin(\phi/2)\cos(\theta/2)\cos(\psi/2) - \cos(\phi/2)\sin(\theta/2)\sin(\psi/2) \\
y &= \cos(\phi/2)\sin(\theta/2)\cos(\psi/2) + \sin(\phi/2)\cos(\theta/2)\sin(\psi/2) \\
z &= \cos(\phi/2)\cos(\theta/2)\sin(\psi/2) - \sin(\phi/2)\sin(\theta/2)\cos(\psi/2)
\end{aligned}$$

---

## 5. Spherical Linear Interpolation (SLERP) Implementation

To ensure smooth attitude transitions without angular acceleration distortion, quaternions are interpolated along the shortest geodesic path on the 4D unit hypersphere.

$$\text{SLERP}(\mathbf{q}_0, \mathbf{q}_1; t) = \frac{\sin((1 - t)\Omega)}{\sin\Omega} \mathbf{q}_0 + \frac{\sin(t\Omega)}{\sin\Omega} \mathbf{q}_1$$

where $\cos\Omega = \mathbf{q}_0 \cdot \mathbf{q}_1$.

### Sample TypeScript Implementation

```typescript
export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Computes spherical linear interpolation between two unit quaternions.
 * @param q0 Initial orientation quaternion (must be normalized)
 * @param q1 Target orientation quaternion (must be normalized)
 * @param t Interpolation alpha in range [0, 1]
 */
export function slerpQuaternion(q0: Quaternion, q1: Quaternion, t: number): Quaternion {
  let cosHalfTheta = q0.w * q1.w + q0.x * q1.x + q0.y * q1.y + q0.z * q1.z;

  // Take the shortest hyperspherical path
  let target = { ...q1 };
  if (cosHalfTheta < 0) {
    target = { w: -q1.w, x: -q1.x, y: -q1.y, z: -q1.z };
    cosHalfTheta = -cosHalfTheta;
  }

  // Fallback to linear interpolation (LERP) when quaternions are near-collinear
  if (cosHalfTheta > 0.9995) {
    const w = q0.w + t * (target.w - q0.w);
    const x = q0.x + t * (target.x - q0.x);
    const y = q0.y + t * (target.y - q0.y);
    const z = q0.z + t * (target.z - q0.z);
    const len = Math.hypot(w, x, y, z) || 1;
    return { w: w / len, x: x / len, y: y / len, z: z / len };
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  return {
    w: q0.w * ratioA + target.w * ratioB,
    x: q0.x * ratioA + target.x * ratioB,
    y: q0.y * ratioA + target.y * ratioB,
    z: q0.z * ratioA + target.z * ratioB,
  };
}