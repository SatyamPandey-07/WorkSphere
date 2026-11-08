# WebXR Coordinate Space Mapping & Device Orientation Fallback Pipeline

This document details the architecture, browser capability detection cascade, coordinate reference space hierarchy, mathematical quaternion transformations, and device sensor fallbacks in WorkSphere's Augmented Reality (AR) navigation subsystem ([`src/components/ar/`](file:///c:/Users/admin/Desktop/workfere/src/components/ar/)).

---

## 1. Executive Summary & Architecture

WorkSphere enables remote workers and digital nomads to navigate complex indoor coworking venues, open-plan offices, and multi-floor campuses directly to their reserved desk, booth, or meeting pod.

Because mobile browsers possess wildly divergent hardware and software support (ranging from Chrome on Android with full ARCore 6-DOF tracking, to iOS Safari with strict sensor permission models, to laptops lacking gyroscopes), WorkSphere implements a **multi-tiered capability detection cascade**:

1. **Tier 1 — WebXR Immersive AR (`immersive-ar`):** Full 6-DOF SLAM camera tracking with persistent spatial anchors, real-world hit testing, and Three.js 3D directional guidance overlays.
2. **Tier 2 — Extended Kalman Filter Indoor PDR (`IndoorPositioningMap`):** Dead-reckoning map using accelerometer step detection, beacon trilateration, and heading fusion.
3. **Tier 3 — 2D Compass Heading & DeviceOrientation Overlay (`CompassFallback`):** Real-time bearing calculation, camera background video feed, and 1D circular Kalman smoothing.
4. **Tier 4 — 2D Static / Interactive Floorplan (`FallbackMap`):** High-contrast schematic desk selector for desktop browsers and devices without motion sensors.

---

## 2. Browser Capability Decision Tree

The following diagram illustrates how WorkSphere evaluates client capabilities, requests permissions, and cascades down through fallback modes:

```mermaid
flowchart TD
    Start["User Clicks 'Navigate to Desk'"] --> SecureContextCheck{"Secure Context?<br/>(isSecureContext / HTTPS)"}
    
    SecureContextCheck -->|No| ForceHTTPS["Fail / Warning:<br/>WebXR & Sensors require HTTPS"]
    SecureContextCheck -->|Yes| WebXRCheck{"navigator.xr exists &<br/>isSessionSupported('immersive-ar')?"}
    
    WebXRCheck -->|Supported| RequestXR["navigator.xr.requestSession('immersive-ar', {<br/>requiredFeatures: ['local'],<br/>optionalFeatures: ['hit-test', 'anchors', 'dom-overlay']<br/>})"]
    
    RequestXR -->|Session Granted| SetupXRSpace{"Request Reference Space"}
    SetupXRSpace -->|'local' Space Success| RunXRLocal["Run WebXR AR with 'local' Space<br/>(Origin fixed near initial viewer pose)"]
    SetupXRSpace -->|'local' Fails| SetupViewerSpace{"Fallback: Request 'viewer' Space"}
    SetupViewerSpace -->|'viewer' Success| RunXRViewer["Run WebXR AR with 'viewer' Space<br/>(Relative to camera ray)"]
    
    RequestXR -->|User Denied / Hardware Unsupported| FallbackEntry["Enter Fallback Cascade<br/>(NavigationContainer.tsx)"]
    WebXRCheck -->|Unsupported (e.g. iOS Safari / Desktop)| FallbackEntry
    
    FallbackEntry --> SensorSupportCheck{"DeviceOrientationEvent<br/>supported in window?"}
    
    SensorSupportCheck -->|Yes| CheckIOSPermission{"iOS 13+ DeviceOrientationEvent.<br/>requestPermission exists?"}
    
    CheckIOSPermission -->|Yes (iOS Safari)| PromptUserGesture["Show 'Enable Compass' UI Button<br/>(Requires direct user gesture)"]
    PromptUserGesture --> UserTaps["User Taps Button"]
    UserTaps --> RequestIOS{"DeviceOrientationEvent.requestPermission()"}
    RequestIOS -->|'granted'| ReadIOSCompass["Listen to 'deviceorientation'<br/>Read webkitCompassHeading"]
    RequestIOS -->|'denied'| StaticMapFallback["Fallback to Tier 4: Static 2D Floorplan"]
    
    CheckIOSPermission -->|No (Standard Android/Chrome)| ReadStandardOrientation["Attach 'deviceorientationabsolute'<br/>or 'deviceorientation' (alpha)"]
    
    ReadIOSCompass --> KalmanSmoothing["Apply CompassKalmanFilter<br/>(1D Circular Modulo 360 Smoothing)"]
    ReadStandardOrientation --> KalmanSmoothing
    
    KalmanSmoothing --> BearingCalculation["Compute Great-Circle Bearing &<br/>Relative Heading to Desk"]
    BearingCalculation --> RenderCompassUI["Render CompassFallback Overlay<br/>(Rotating HUD Arrow, Distance Badge)"]
    
    SensorSupportCheck -->|No| StaticMapFallback
```

---

## 3. WebXR Reference Space Setup: `local` vs. `viewer`

In WebXR, coordinate systems are represented by `XRReferenceSpace` instances. WorkSphere requests spaces inside `src/components/ar/ARNavigation.tsx`:

```typescript
const setupSession = async () => {
  try {
    await renderer.xr.setSession(session);
    try {
      // Primary choice for indoor room-scale navigation
      referenceSpaceRef.current = await session.requestReferenceSpace("local");
    } catch {
      // Graceful fallback for devices not supporting fixed world anchors
      referenceSpaceRef.current = await session.requestReferenceSpace("viewer");
    }
    setReferenceReady(true);
  } catch (err) {
    console.error("Failed to set up XR session on renderer:", err);
  }
};
```

### Reference Space Comparison

| Attribute | `local` Reference Space | `viewer` Reference Space |
| :--- | :--- | :--- |
| **Origin Point** | Set near the viewer's head position upon session launch. Remains fixed in the physical environment. | Continuously attached to the viewer's camera. Moves and rotates with the phone. |
| **Tracking Stability** | High (6-DOF with visual-inertial odometry). Objects stay anchored to physical desks as the user walks. | Relative only. Used for head-locked HUD elements or when external tracking is unavailable. |
| **Use Case in WorkSphere** | Primary world frame for desks, seating badges, and 3D floor pathway breadcrumbs. | Emergency fallback when device cannot establish world odometry. |

---

## 4. Mathematical Coordinate Mapping & Quaternion Transformations

### 4.1 Coordinate Reference Frames

WorkSphere manages transformations across three distinct coordinate spaces:
1. **World / Reference Space ($\mathbb{R}^3$):** Right-handed Cartesian frame where $+X$ points East/Right, $+Y$ points Up, and $-Z$ points Forward.
2. **Device / Sensor Space:** Accelerometer and gyroscope frame defined relative to the phone chassis ($X$ across screen width, $Y$ screen length, $Z$ orthogonal to screen).
3. **Camera Projection Space:** Pinhole perspective projection transforming 3D world coordinates into Normalized Device Coordinates (NDC) $[-1, 1]$.

### 4.2 Matrix Decomposition & Anchor Pose Extraction

Persistent seat anchors are stored as $4 \times 4$ column-major transformation matrices (`number[16]`). When rendering desks in Three.js:

$$\mathbf{M}_{\text{anchor}} = \begin{bmatrix}
R_{00} & R_{01} & R_{02} & T_x \\
R_{10} & R_{11} & R_{12} & T_y \\
R_{20} & R_{21} & R_{22} & T_z \\
0 & 0 & 0 & 1
\end{bmatrix}$$

Decomposing into translation vector $\mathbf{p}$, rotation quaternion $\mathbf{q}$, and scale vector $\mathbf{s}$:

```typescript
const deskMatrix = new THREE.Matrix4().fromArray(anchorData.matrix);
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scale = new THREE.Vector3();

deskMatrix.decompose(pos, quat, scale);
badge.position.copy(pos);
badge.quaternion.copy(quat);
```

### 4.3 3D Direction Arrow Quaternion Orientation

To aim the floating navigation arrow from user camera $\mathbf{p}_{\text{cam}}$ to target desk $\mathbf{p}_{\text{desk}}$:

1. Compute direction unit vector:
   $$\hat{\mathbf{d}} = \frac{\mathbf{p}_{\text{desk}} - \mathbf{p}_{\text{cam}}}{\|\mathbf{p}_{\text{desk}} - \mathbf{p}_{\text{cam}}\|}$$
2. Compute rotation quaternion $\mathbf{q}$ rotating default mesh forward vector $\mathbf{v}_{\text{fwd}} = (0, 0, 1)^T$ into $\hat{\mathbf{d}}$:
   $$\mathbf{q} = \text{Quaternion.setFromUnitVectors}(\mathbf{v}_{\text{fwd}}, \hat{\mathbf{d}})$$
3. Place arrow $1.2\text{m}$ in front of camera along line-of-sight:
   $$\mathbf{p}_{\text{arrow}} = \mathbf{p}_{\text{cam}} + \min(1.2, 0.4 \times D) \cdot \hat{\mathbf{d}}$$

---

## 5. Device Orientation Fallback Pipeline & Sensor Quirks

When WebXR is unavailable, `CompassFallback.tsx` and `useDeviceOrientation.ts` activate.

### 5.1 Platform Discrepancies: iOS Safari vs. Standard Android

Different mobile browsers calculate heading using different sensor conventions:

```typescript
// src/hooks/useDeviceOrientation.ts
if ((event as any).webkitCompassHeading !== undefined) {
  // iOS Safari: True North heading directly in degrees [0, 360)
  h = (event as any).webkitCompassHeading;
} else if (event.alpha !== null && Number.isFinite(event.alpha)) {
  // Standard Android/Chrome: alpha is counter-clockwise rotation around Z
  // True compass heading = (360 - alpha) % 360
  h = ((360 - event.alpha) % 360 + 360) % 360;
} else {
  // Fallback for devices lacking magnetometer
  h = 0;
}
```

### 5.2 iOS Safari Permission Quirks (iOS 13+)

1. **Transient User Gesture Requirement:**
   - Calling `DeviceOrientationEvent.requestPermission()` unconditionally on page load will reject immediately.
   - It **MUST** be initiated by a direct user gesture (e.g. `onClick` or `onTouchEnd` on an explicit button).
2. **Secure Context Requirement (HTTPS):**
   - Both WebXR and sensor APIs (`DeviceOrientationEvent`, `DeviceMotionEvent`, `navigator.mediaDevices.getUserMedia`) are strictly disabled in insecure contexts (`http://`).
   - For local development, testing on physical phones requires an HTTPS proxy (such as `ngrok` or `mkcert`).

```typescript
const requestPermission = async (): Promise<boolean> => {
  const DeviceOrientation = (window as any).DeviceOrientationEvent;
  if (typeof DeviceOrientation?.requestPermission === "function") {
    try {
      const response = await DeviceOrientation.requestPermission();
      if (response === "granted") {
        setPermissionState("granted");
        attachListener();
        return true;
      }
    } catch (err) {
      console.warn("User dismissed orientation permission prompt:", err);
    }
  }
  return false;
};
```

### 5.3 Kalman Heading Smoothing (1D Circular Modulo)

Indoor magnetometer readings suffer from high-frequency jitter caused by structural steel and electrical wiring. WorkSphere smooths raw heading using `CompassKalmanFilter` (`src/lib/spatial/compassFilter.ts`), which wraps circular angular boundaries:

$$\Delta\theta = \text{atan2}\left(\sin(\theta_{\text{meas}} - \theta_{\text{est}}), \cos(\theta_{\text{meas}} - \theta_{\text{est}})\right)$$

```typescript
const smoothed = kalmanFilterRef.current.update(rawHeading, accuracy);
setFilteredHeading(Math.round(smoothed * 10) / 10);
```

---

## 6. Security, Permissions & Environment Matrix

| Feature / API | HTTPS Required? | Permission Model | Fallback if Denied / Unavailable |
| :--- | :---: | :--- | :--- |
| **WebXR (`immersive-ar`)** | ✅ Yes | Browser prompt on session request | Cascades to `IndoorPositioningMap` / `CompassFallback` |
| **iOS DeviceOrientation** | ✅ Yes | Explicit button tap -> `requestPermission()` | Prompts user with dedicated unlock button; falls back to static map |
| **Android DeviceOrientation** | ✅ Yes | Implicit / Granted by default | Falls back to stationary heading |
| **Camera Feed Overlay** | ✅ Yes | `navigator.mediaDevices.getUserMedia` | Renders compass HUD against clean dark background |
| **PartyKit Room Anchors** | ❌ No | Ephemeral WebSocket sync | Retains locally cached seats |

---

## 7. Contributor Guidelines for AR Development

1. **Test with WebXR Emulation:**
   Use the Chrome DevTools **WebXR** tab to emulate virtual ARCore devices and test reference space switching without physical hardware.
2. **Dispose Geometries & Textures:**
   Always invoke `disposeGroupTextures(group)` when removing dynamic 3D directional arrows or desk markers to prevent WebGL memory leaks on mobile devices.
3. **Respect Camera Distance Thresholds:**
   Arrival at a desk is defined as `distance < 1.0` meter (`setHasArrived(true)`), which triggers the success checkmark and check-in confirmation modal.
