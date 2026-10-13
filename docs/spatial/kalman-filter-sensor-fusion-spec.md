# KalmanFilterSmoother Sensor Fusion State Space Equations & Tuning Specification

## 1. Executive Summary & Problem Context

Indoor pedestrian wayfinding and Augmented Reality (AR) desk positioning within complex multi-story co-working venues cannot rely on raw satellite GPS signals due to severe building attenuation, multipath reflections, and signal loss. WorkSphere's spatial navigation stack (`src/core/spatial/KalmanFilterSmoother.ts` and `src/lib/spatial/arWayfindingEngine.ts`) implements a discrete linear Kalman filter that fuses Pedestrian Dead Reckoning (PDR), inertial measurement units (IMUs), WiFi RSSI beacons, and AR visual odometry.

This specification documents the state-space formulation, analytical derivations for state transition matrices, process noise covariance ($\mathbf{Q}$), measurement noise covariance ($\mathbf{R}$), Kalman gain, and empirical parameter tuning for indoor dead reckoning.

```
+-----------------------------------------------------------------------------------------+
|                                    SENSOR INPUTS                                        |
|   - IMU Accelerometer / Gyroscope (Step Cadence & Heading)                              |
|   - WiFi RSSI Trilateration & Bluetooth Low Energy (BLE) Beacons                        |
|   - WebXR Visual Inertial Odometry (VIO)                                                |
+--------------------------------------------+--------------------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                         PREDICT STEP (PRIOR STATE ESTIMATE)                             |
|   \hat{x}_{k|k-1} = F_k \hat{x}_{k-1|k-1} + B_k u_k                                     |
|   P_{k|k-1}       = F_k P_{k-1|k-1} F_k^T + Q_k                                         |
+--------------------------------------------+--------------------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                         UPDATE STEP (POSTERIOR CORRECTION)                              |
|   y_k = z_k - H_k \hat{x}_{k|k-1}               (Innovation)                            |
|   S_k = H_k P_{k|k-1} H_k^T + R_k               (Innovation Covariance)                 |
|   K_k = P_{k|k-1} H_k^T S_k^{-1}                (Optimal Kalman Gain)                   |
|   \hat{x}_{k|k} = \hat{x}_{k|k-1} + K_k y_k     (Updated State)                         |
|   P_{k|k}       = (I - K_k H_k) P_{k|k-1}       (Updated Error Covariance)              |
+-----------------------------------------------------------------------------------------+
```

---

## 2. State-Space Representation & Kinematic Motion Model

### 2.1 State Vector Formulation

The system operates in a two-dimensional local metric coordinate frame $(x, y)$ with continuous Cartesian coordinates and instantaneous velocities. The state vector $\mathbf{x}_k \in \mathbb{R}^4$ at discrete time step $k$ is defined as:

$$\mathbf{x}_k = \begin{bmatrix} x_k \\ y_k \\ v_{x,k} \\ v_{y,k} \end{bmatrix}$$

where:
- $x_k, y_k$: 2D position in meters relative to the venue origin.
- $v_{x,k}, v_{y,k}$: 2D velocities along the respective axes in meters per second ($\text{m/s}$).

### 2.2 Constant Velocity (CV) Kinematic Model

Assuming constant velocity across sampling intervals $\Delta t = t_k - t_{k-1}$ subject to zero-mean white noise acceleration disturbances $\mathbf{w}_k \sim \mathcal{N}(0, \mathbf{Q})$:

$$x_k = x_{k-1} + v_{x,k-1} \Delta t + \frac{1}{2} w_{x} \Delta t^2$$
$$y_k = y_{k-1} + v_{y,k-1} \Delta t + \frac{1}{2} w_{y} \Delta t^2$$
$$v_{x,k} = v_{x,k-1} + w_{x} \Delta t$$
$$v_{y,k} = v_{y,k-1} + w_{y} \Delta t$$

In matrix form:

$$\mathbf{x}_k = \mathbf{F} \mathbf{x}_{k-1} + \mathbf{G} \mathbf{w}_k$$

### 2.3 State Transition Matrix ($\mathbf{F}$)

The state transition matrix $\mathbf{F} \in \mathbb{R}^{4 \times 4}$ maps the prior state estimate forward in time:

$$\mathbf{F} = \begin{bmatrix} 1 & 0 & \Delta t & 0 \\ 0 & 1 & 0 & \Delta t \\ 0 & 0 & 1 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

The control input coupling matrix $\mathbf{G} \in \mathbb{R}^{4 \times 2}$ maps unmodeled accelerations to the state:

$$\mathbf{G} = \begin{bmatrix} \frac{\Delta t^2}{2} & 0 \\ 0 & \frac{\Delta t^2}{2} \\ \Delta t & 0 \\ 0 & \Delta t \end{bmatrix}$$

---

## 3. Derivation of Process Noise Covariance Matrix ($\mathbf{Q}$)

Process noise models uncertainty in the kinematic assumption (e.g., sudden pedestrian turns, acceleration bursts, stops, or stair navigation).

### 3.1 Continuous White Noise Acceleration (CWNA) Derivation

Let continuous acceleration spectral density variance be $\sigma_a^2$ ($\text{m}^2/\text{s}^3$ or $\text{m}^2/\text{s}^4$). The discrete process noise covariance $\mathbf{Q}$ is derived via the continuous-to-discrete integral:

$$\mathbf{Q} = \int_{0}^{\Delta t} \mathbf{F}(\tau) \mathbf{G}_c \mathbf{Q}_c \mathbf{G}_c^T \mathbf{F}(\tau)^T d\tau = \sigma_a^2 \cdot \begin{bmatrix} \frac{\Delta t^4}{4} & 0 & \frac{\Delta t^3}{2} & 0 \\ 0 & \frac{\Delta t^4}{4} & 0 & \frac{\Delta t^3}{2} \\ \frac{\Delta t^3}{2} & 0 & \Delta t^2 & 0 \\ 0 & \frac{\Delta t^3}{2} & 0 & \Delta t^2 \end{bmatrix}$$

### 3.2 Diagonal Simplification in `KalmanFilterSmoother`

In resource-constrained mobile and Web Worker runtimes (`src/core/spatial/KalmanFilterSmoother.ts`), cross-axis correlations are decoupled to ensure sub-millisecond execution:

$$\mathbf{Q} \approx \begin{bmatrix} q_p & 0 & 0 & 0 \\ 0 & q_p & 0 & 0 \\ 0 & 0 & q_v & 0 \\ 0 & 0 & 0 & q_v \end{bmatrix}$$

where $q_p = \text{processNoise}$ accounts for positional variance accumulation during the prediction cycle:

$$\mathbf{P}_{xx, k|k-1} = \mathbf{P}_{xx, k-1|k-1} + q_p$$
$$\mathbf{P}_{yy, k|k-1} = \mathbf{P}_{yy, k-1|k-1} + q_p$$

---

## 4. Measurement Model & Noise Covariance Matrix ($\mathbf{R}$)

### 4.1 Measurement Vector ($\mathbf{z}_k$) and Observation Matrix ($\mathbf{H}$)

Direct observations originate from sensory fixes (WiFi triangulation coordinates, GPS outdoor fixes, or BLE trilateration centroids):

$$\mathbf{z}_k = \begin{bmatrix} z_{x,k} \\ z_{y,k} \end{bmatrix} \in \mathbb{R}^2$$

The linear observation matrix $\mathbf{H} \in \mathbb{R}^{2 \times 4}$ extracts position components from the 4D state vector:

$$\mathbf{H} = \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \end{bmatrix}$$

### 4.2 Measurement Noise Covariance Matrix ($\mathbf{R}$)

The measurement noise covariance captures sensor measurement uncertainty:

$$\mathbf{R} = \begin{bmatrix} \sigma_{x}^2 & \sigma_{xy} \\ \sigma_{yx} & \sigma_{y}^2 \end{bmatrix} \approx \begin{bmatrix} r & 0 \\ 0 & r \end{bmatrix}$$

where $r = \text{measurementNoise}$.

### 4.3 Dynamic Sensor Uncertainty Weighting

WorkSphere dynamically adjusts $\mathbf{R}$ based on sensor environmental confidence metrics:

1. **Outdoor GPS:** Scaled by Horizontal Dilution of Precision ($\text{HDOP}$):
   $$r_{\text{GPS}} = \sigma_{\text{base}}^2 \cdot \max(1.0, \text{HDOP}^2)$$
   - Clear sky: $\text{HDOP} \approx 1.0 \implies r \approx 4.0\text{ m}^2$
   - Indoor degraded: $\text{HDOP} \ge 5.0 \implies r \ge 100.0\text{ m}^2$ (forces filter to discount GPS).

2. **Indoor WiFi RSSI / BLE Beacons:** Scaled by signal variance and visible AP count ($N$):
   $$r_{\text{WiFi}} = \frac{\sigma_{\text{RSSI}}^2}{\sqrt{N}}$$
   - Typical indoor WiFi positioning: $r \in [2.25, 9.0]\text{ m}^2$ ($\sigma \in [1.5, 3.0]\text{ m}$).

---

## 5. Innovation, Kalman Gain & Posterior State Update

For each observation $\mathbf{z}_k$:

### 5.1 Innovation (Measurement Residual)
$$\mathbf{y}_k = \mathbf{z}_k - \mathbf{H} \hat{\mathbf{x}}_{k|k-1} = \begin{bmatrix} z_{x,k} - \hat{x}_{k|k-1} \\ z_{y,k} - \hat{y}_{k|k-1} \end{bmatrix}$$

### 5.2 Innovation Covariance
$$\mathbf{S}_k = \mathbf{H} \mathbf{P}_{k|k-1} \mathbf{H}^T + \mathbf{R}_k = \begin{bmatrix} \mathbf{P}_{xx, k|k-1} + r_x & 0 \\ 0 & \mathbf{P}_{yy, k|k-1} + r_y \end{bmatrix}$$

### 5.3 Optimal Kalman Gain ($\mathbf{K}_k$)
$$\mathbf{K}_k = \mathbf{P}_{k|k-1} \mathbf{H}^T \mathbf{S}_k^{-1}$$

For decoupled 2D axes:
$$K_{x} = \frac{\mathbf{P}_{xx, k|k-1}}{\mathbf{P}_{xx, k|k-1} + r_x}, \quad K_{y} = \frac{\mathbf{P}_{yy, k|k-1}}{\mathbf{P}_{yy, k|k-1} + r_y}$$

### 5.4 Posterior State & Covariance Update
$$\hat{x}_{k|k} = \hat{x}_{k|k-1} + K_x (z_{x,k} - \hat{x}_{k|k-1})$$
$$\hat{y}_{k|k} = \hat{y}_{k|k-1} + K_y (z_{y,k} - \hat{y}_{k|k-1})$$

$$\mathbf{P}_{xx, k|k} = (1 - K_x) \mathbf{P}_{xx, k|k-1}$$
$$\mathbf{P}_{yy, k|k} = (1 - K_y) \mathbf{P}_{yy, k|k-1}$$

Velocity estimate derivation via finite differencing across sample step $\Delta t$:
$$v_{x,k} = \frac{\hat{x}_{k|k} - \hat{x}_{k-1|k-1}}{\Delta t}$$
$$v_{y,k} = \frac{\hat{y}_{k|k} - \hat{y}_{k-1|k-1}}{\Delta t}$$

---

## 6. Empirical Parameter Tuning Guide

Selecting optimal ratios for $\mathbf{Q}$ and $\mathbf{R}$ balances tracking responsiveness against jitter reduction:

$$\text{Tuning Ratio} = \frac{Q}{R}$$

- **High $Q/R$ Ratio ($> 1.0$):** High filter trust in noisy measurements. Yields fast tracking response but transmits significant visual jitter and sensor noise.
- **Low $Q/R$ Ratio ($< 0.01$):** High trust in kinematic motion model. Smooth path display but introduces latency/lag during abrupt changes in walking direction.

### 6.1 Recommended Tuning Presets

| Environment / Sensor Profile | $Q$ (`processNoise`) | $R$ (`measurementNoise`) | $\Delta t$ | Target Performance |
| :--- | :--- | :--- | :--- | :--- |
| **Indoor Office (WiFi Beacons)** | `0.1` | `1.5 - 2.5` | `1.0s` | Dampens RSSI jitter while smoothly tracking normal walking speed ($1.2\text{ m/s}$). |
| **AR Desk Finder (WebXR / VIO)** | `0.05` | `0.2 - 0.5` | `0.016s` ($60\text{ Hz}$) | Real-time $60\text{ FPS}$ spatial marker stability without jitter. |
| **Indoor-Outdoor Transition** | Adaptive: `0.2` | Adaptive: `4.0` (out) $\rightarrow$ `100.0` (in) | `1.0s` | Suppresses degraded GPS jumps upon entering venue buildings. |
| **High Cadence PDR (IMU Steps)** | `0.25` | `1.0` | Variable ($\sim 0.5\text{s}$) | Fast heading adjustment during corridor turns. |

---

## 7. TypeScript Implementation Reference

```typescript
import { KalmanFilterSmoother } from '@/core/spatial/KalmanFilterSmoother';

// Initialize filter at venue entrance with tuned indoor parameters
const smoother = new KalmanFilterSmoother(
  0.0,   // initialX (meters)
  0.0,   // initialY (meters)
  0.1,   // processNoise (Q)
  1.5,   // measurementNoise (R)
  1.0    // dt (seconds)
);

// Navigation loop
function onPositionUpdate(rawBeaconX: number, rawBeaconY: number) {
  // Step 1: Predict kinematic state
  smoother.predict();

  // Step 2: Correct with sensor measurement
  const smoothedState = smoother.update(rawBeaconX, rawBeaconY);

  console.log(`Smoothed Position: (${smoothedState.x.toFixed(2)}, ${smoothedState.y.toFixed(2)})`);
  console.log(`Estimated Velocity: (${smoothedState.vx.toFixed(2)}, ${smoothedState.vy.toFixed(2)}) m/s`);
}
```