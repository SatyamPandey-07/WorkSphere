# WebXR Spatial Tracking & AR Navigation Manual

This manual documents WorkSphere's WebXR navigation flow, camera-based spatial
tracking, Three.js arrow rendering, and the 2D compass fallback.

Relevant files:

- `src/hooks/useWebXR.ts` — support check and `immersive-ar` session request
- `src/components/ar/NavigationContainer.tsx` — session and fallback selection
- `src/components/ar/ARNavigation.tsx` — Three.js scene and XR render loop
- `src/hooks/useDeviceOrientation.ts` — device heading
- `src/components/ar/CompassFallback.tsx` — non-WebXR compass UI

## 1. Navigation flow

```text
NavigationContainer
        |
        v
navigator.xr available?
   | yes                 | no
   v                     v
isSessionSupported       CompassFallback
("immersive-ar")
   |
   v
User selects Start AR Session
   |
   v
requestSession("immersive-ar")
   | success             | denied / failed
   v                     v
ARNavigation             CompassFallback
   |
   v
Three.js XR render loop
   |
   v
session.end() -> return to launcher
```

The session request must follow a user gesture. Browsers normally reject
`requestSession()` when it is called automatically during page load.

## 2. WebXR session lifecycle

WorkSphere requests an immersive AR session with a local reference space and an
optional DOM overlay:

```ts
const supported = await navigator.xr.isSessionSupported("immersive-ar");

if (supported) {
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: document.body },
  });

  session.addEventListener("end", () => {
    setSession(null);
  });
}
```

The implementation in `useWebXR` returns `null` when support detection fails,
permission is denied, or session creation throws. `NavigationContainer` then
switches to the compass fallback.

### Three.js setup

`ARNavigation` creates a transparent WebGL renderer so the device camera remains
visible behind the virtual scene:

```ts
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
});

renderer.xr.enabled = true;
await renderer.xr.setSession(session);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

`setAnimationLoop` must be used instead of `requestAnimationFrame`; Three.js
binds it to the active `XRSession` and supplies the correct display cadence.

### Ending and cleanup

The overlay button calls `session.end()`. The session's `end` listener clears
the React state. When the renderer component unmounts, it:

1. removes the resize listener;
2. stops the animation loop;
3. removes the renderer canvas; and
4. disposes the WebGL renderer.

## 3. Camera-frame spatial tracking

WebXR performs camera pose estimation in the browser/runtime. Application code
does not process raw camera pixels. For each `XRFrame`, the runtime estimates
the viewer pose relative to a reference space:

```ts
const referenceSpace = await session.requestReferenceSpace("local");

session.requestAnimationFrame(function draw(time, frame) {
  const pose = frame.getViewerPose(referenceSpace);

  if (pose) {
    const { position, orientation } = pose.transform;
    // position: x, y, z in metres
    // orientation: quaternion x, y, z, w
  }

  session.requestAnimationFrame(draw);
});
```

Three.js handles this pose update internally after `renderer.xr.setSession()`.
Virtual objects placed in the scene therefore remain in the local XR coordinate
system while the camera moves.

### Coordinate system

WebXR uses a right-handed coordinate system:

- `+X` points right;
- `+Y` points up; and
- `-Z` points forward from the initial viewer pose.

The current WorkSphere scene places arrows at `(0, 0, -1.5)`,
`(0, 0, -3.0)`, and `(0, 0, -4.5)` metres. These are demonstration markers in
front of the starting pose; they are not yet bound to venue route coordinates.

## 4. Spatial anchor calculations

For a route waypoint expressed in the same local reference space, let:

```text
Viewer position:   V = (vx, vy, vz)
Waypoint position: W = (wx, wy, wz)
```

The vector from viewer to waypoint is:

```text
D = W - V = (wx - vx, wy - vy, wz - vz)
```

The straight-line distance is:

```text
distance = sqrt(Dx² + Dy² + Dz²)
```

For navigation along the floor plane, ignore height:

```text
horizontalDistance = sqrt(Dx² + Dz²)
```

The heading around the Y axis is:

```text
yaw = atan2(Dx, -Dz)
```

An arrow can be positioned a fixed distance `s` in front of the viewer while
still pointing toward the waypoint:

```text
N = D / |D|
arrowPosition = V + N * s
arrowYaw = atan2(Nx, -Nz)
```

In Three.js:

```ts
const direction = waypoint.clone().sub(viewerPosition).normalize();
arrow.position.copy(viewerPosition).addScaledVector(direction, 1.5);
arrow.rotation.y = Math.atan2(direction.x, -direction.z);
```

### Geographic coordinates to a local anchor

Latitude/longitude must be converted before placing an XR object. For short
indoor distances, an equirectangular approximation is sufficient:

```text
R = 6,371,000 metres
lat0, lon0 = origin in radians
lat, lon   = destination in radians

east  = R * (lon - lon0) * cos((lat + lat0) / 2)
north = R * (lat - lat0)
```

Map the result into WebXR space:

```text
x = east
y = measured floor / marker height
z = -north
```

This approximation should only be used after the XR origin has been calibrated
against a known real-world point and heading. GPS alone is not accurate enough
for indoor placement. A QR marker, known entrance point, or surveyed anchor is
needed to align geographic and local XR coordinates.

### Persistent anchors

If the runtime supports the WebXR Anchors module, create an anchor from a pose:

```ts
const anchor = await frame.createAnchor(anchorPose, referenceSpace);
```

Anchor support is not currently requested by `useWebXR`. It should remain an
optional feature and fall back to local-space objects when unavailable.

## 5. Rendering 3D navigation arrows

WorkSphere uses a cone mesh rotated toward negative Z:

```ts
const geometry = new THREE.ConeGeometry(0.1, 0.3, 32);
geometry.rotateX(Math.PI / 2);

const material = new THREE.MeshPhongMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.8,
  shininess: 100,
});

const arrow = new THREE.Mesh(geometry, material);
arrow.position.set(0, 0, -1.5);
scene.add(arrow);
```

The render loop applies a small vertical bob:

```text
y = sin(time * 0.003) * 0.05
```

Keep navigation geometry simple. Mobile AR performance is sensitive to polygon
count, transparent overdraw, high pixel ratios, and allocations inside the
render loop.

## 6. 2D compass fallback

When immersive AR is unsupported or the session request fails,
`NavigationContainer` renders `CompassFallback`.

`useDeviceOrientation` reads:

1. `webkitCompassHeading` on supporting iOS browsers; otherwise
2. `360 - event.alpha`.

The current compass points north:

```ts
const rotation = heading === null ? 0 : -heading;
```

To point toward a destination, first calculate its bearing. With all latitude
and longitude values in radians:

```text
Δlon = destinationLon - currentLon

y = sin(Δlon) * cos(destinationLat)
x = cos(currentLat) * sin(destinationLat)
    - sin(currentLat) * cos(destinationLat) * cos(Δlon)

bearing = (atan2(y, x) * 180 / π + 360) mod 360
```

Then rotate the navigation arrow relative to the device heading:

```text
arrowRotation = (bearing - heading + 360) mod 360
```

Device orientation may be relative rather than true north and is affected by
magnetic interference. The fallback should be treated as directional guidance,
not centimetre-accurate indoor positioning.

## 7. Device compatibility

| Platform | Immersive WebXR AR | Device orientation fallback | Notes |
|----------|--------------------|-----------------------------|-------|
| Android Chrome | Supported on ARCore-capable devices | Supported | Primary WebXR target; requires HTTPS and camera permission |
| Android Chromium browsers | Varies by browser and device | Usually supported | Check `isSessionSupported("immersive-ar")` at runtime |
| Samsung Internet | Device/version dependent | Usually supported | Do not assume WebXR from user agent alone |
| iPhone / iPad Safari | Not generally available through standard immersive WebXR | Supported, permission may be required | Use the 2D compass fallback |
| Desktop Chrome / Edge | Usually no immersive AR session | Orientation generally unavailable | Show fallback/error UI; desktop may support other XR modes |
| Firefox | No general immersive AR support | Device dependent | Use feature detection |
| WebView / embedded browser | Often unavailable or restricted | Varies | Camera, sensors, and permissions may be blocked by host app |

Compatibility must always be determined with feature detection, not the user
agent:

```ts
const available =
  "xr" in navigator &&
  (await navigator.xr.isSessionSupported("immersive-ar"));
```

## 8. Permissions and security

- Serve AR pages over HTTPS (localhost is allowed during development).
- Request the XR session only after an explicit user action.
- Explain why camera access is needed before prompting.
- Do not capture, upload, or store camera frames unless a separate feature
  explicitly requires it and the user consents.
- Treat pose and location data as sensitive. Keep only the precision and
  duration required for navigation.
- Handle denied camera/sensor permissions by moving to the 2D fallback.
- Stop the XR session and dispose of WebGL resources when navigation ends.

On iOS, `DeviceOrientationEvent.requestPermission()` may be required from a
user gesture before orientation events are delivered. The current hook listens
for events directly, so callers should expect a missing heading when permission
has not been granted.

## 9. Current scope

Implemented:

- runtime detection of `immersive-ar`;
- local reference-space session request;
- transparent Three.js XR renderer;
- fixed 3D wayfinding arrows;
- DOM-overlay end control; and
- device-orientation compass fallback.

Not currently implemented:

- route-derived waypoint placement;
- geographic-to-XR calibration;
- WebXR persistent anchors;
- hit-test-based floor placement; or
- destination bearing in the compass component.

These limitations are documented to keep the manual aligned with the code. They
are not additional requirements for issue #1042.
