# WebXR AR Desk Navigation Guide

This document describes how WorkSphere uses the WebXR Device API and Three.js to
overlay interactive 3D direction arrows and desk markers onto a real-world camera
view, helping users navigate to their booked desk inside a co-working venue.

---

## Architecture Overview

```
User opens venue detail page
       │
       ▼
XRSupportChecker  ← checks navigator.xr.isSessionSupported("immersive-ar")
  │              ← renders <FallbackMap> on unsupported devices
  │
  ▼ (WebXR supported)
NavigationContainer  ← requests immersive-ar XR session
  │
  ▼
ARNavigation  ← main XR render loop (Three.js + XRSession)
  │
  ├── ARScene          ← Three.js WebGLRenderer on the XR canvas
  ├── DirectionArrow   ← 3D arrow mesh pointing at booked desk
  ├── DeskOverlay      ← UI overlay above desk anchor point
  └── CompassFallback  ← 2D compass when device heading is unavailable
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/components/ar/XRSupportChecker.tsx` | Checks WebXR availability; renders fallback UI |
| `src/components/ar/NavigationContainer.tsx` | Requests XR session and passes it to `ARNavigation` |
| `src/components/ar/ARNavigation.tsx` | Main render loop — Three.js + XRFrame processing |
| `src/components/ar/ARScene.tsx` | Three.js renderer setup for an XR canvas |
| `src/components/ar/DirectionArrow.tsx` | Animated 3D arrow mesh |
| `src/components/ar/DeskOverlay.tsx` | 2D HTML overlay anchored to desk position |
| `src/components/ar/FallbackMap.tsx` | 2D map shown when WebXR is unsupported |
| `src/components/ar/CompassFallback.tsx` | 2D compass for heading when sensors unavailable |
| `src/app/api/ar/anchors/route.ts` | CRUD for persistent XR anchor positions |

---

## Session Lifecycle

### 1. Capability Check (`XRSupportChecker`)

```typescript
const isSupported = await navigator.xr?.isSessionSupported("immersive-ar");
```

If `false` (desktop, unsupported browser, or privacy block), renders `<FallbackMap>`.

### 2. Session Request (`NavigationContainer`)

```typescript
const session = await navigator.xr.requestSession("immersive-ar", {
  requiredFeatures: ["hit-test", "dom-overlay"],
  domOverlay: { root: overlayRef.current },
});
```

The `dom-overlay` feature is required for the `DeskOverlay` HTML badge to render above the XR canvas.

### 3. Render Loop (`ARNavigation`)

Each frame is driven by `session.requestAnimationFrame()`. The `XRFrame` provides:
- **Viewer pose** via `frame.getViewerPose(referenceSpace)` — camera position/orientation
- **Hit test results** — for tap-to-place anchor creation

```typescript
session.requestAnimationFrame((timestamp, frame) => {
  const pose = frame.getViewerPose(referenceSpace);
  if (pose) {
    renderer.render(scene, camera); // Three.js render
    updateArrowDirection(pose);
  }
});
```

---

## Anchor Placement Protocol

Anchors store the exact 6DOF position of a booked desk in the real world so users
can resume navigation on future visits.

### Placing an Anchor

1. User taps the screen → hit-test against real surfaces via `frame.getHitTestResults()`
2. The hit pose is extracted into a 4×4 matrix (`Float32Array`, column-major)
3. `POST /api/ar/anchors` saves `{ anchorPersistId, seatId, bookingId, matrix, label }`
4. On subsequent visits, anchors are fetched and recreated via `XRAnchor.createAnchor()`

### Anchor Data Model

```typescript
interface AnchorData {
  id: string;           // database row ID
  anchorPersistId: string; // XRPersistentAnchor UUID
  seatId: string | null;
  bookingId: string | null;
  matrix: number[];     // 16-element column-major Float32Array (4×4 transform)
  label: string | null; // display label above arrow
}
```

---

## Direction Arrow

`DirectionArrow.tsx` renders an animated Three.js cone+cylinder composite pointing
from the camera's current position toward the anchor.

- Uses `THREE.Vector3.subVectors(anchorWorldPos, cameraPos).normalize()` for direction
- Arrow floats at `y = 1.6m` (eye height) to stay in the user's field of view
- Pulses with a `Math.sin(time)` scale animation to draw attention
- Seat type is color-coded:

| Seat type | Color |
|-----------|-------|
| HOT_DESK | 🔵 `#3b82f6` |
| FIXED_DESK | 🟢 `#22c55e` |
| MEETING_ROOM | 🟡 `#f59e0b` |
| PHONE_BOOTH | 🟣 `#a855f7` |

---

## Fallback Behaviour

| Scenario | Fallback |
|----------|---------|
| WebXR not supported | `FallbackMap` — 2D floor-plan with "You" + "Desk" indicators |
| Device compass unavailable | `CompassFallback` — 360° spinning indicator |
| Anchor load fails | Arrow hidden; overlay shows "Location unavailable" |
| Session ends (user closes) | `onEndSession()` callback cleans up Three.js resources |

---

## API Reference

### `POST /api/ar/anchors`

Creates or updates a persistent anchor.

**Request body:**
```json
{
  "anchorPersistId": "uuid",
  "seatId": "seat-123",
  "bookingId": "booking-456",
  "matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.5,1.2,3.0,1],
  "label": "Desk A3"
}
```

### `GET /api/ar/anchors?venueId=<id>`

Returns all anchors for the authenticated user at the given venue.

### `DELETE /api/ar/anchors/[id]`

Removes a specific anchor by database ID.

---

## Further Reading

- [WebXR Device API Specification](https://immersive-web.github.io/webxr/)
- [WebXR Hit Testing](https://immersive-web.github.io/hit-test/)
- [Three.js XR Guide](https://threejs.org/docs/#manual/en/introduction/How-to-create-VR-content)
- `src/components/ar/` — all AR component implementations
- `src/app/venues/[id]/page.tsx` — where `XRSupportChecker` is mounted
