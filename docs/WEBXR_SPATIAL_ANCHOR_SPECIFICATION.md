# WebXR Spatial Anchor Persistence & AR Marker Calibration Specification

## Introduction

This specification documents the design, implementation, and operational
guidelines for WebXR spatial anchor persistence, transformation matrix storage,
AR desk marker rendering, and multi-user calibration within the WorkSphere
platform. It serves as the authoritative reference for developers working with
spatial computing features.

WorkSphere leverages the WebXR Device API to provide immersive augmented
reality experiences for indoor navigation, workspace discovery, and
collaborative AR features. This document covers the complete lifecycle of
spatial anchors—from creation through persistence to multi-user
synchronization.

## Problem Statement

Indoor AR experiences face several technical challenges that this
specification addresses:

1. **Anchor Persistence**: WebXR sessions are ephemeral, but workspace
   markers must survive across sessions, device restarts, and application
   updates.
2. **Coordinate System Alignment**: Different devices and sessions establish
   independent coordinate systems that must be aligned for consistent marker
   placement.
3. **Multi-User Synchronization**: Collaborative AR requires all
   participants to see virtual markers at the same physical locations,
   despite having independent tracking systems.
4. **Device Fragmentation**: WebXR support varies significantly across
   browsers, devices, and operating systems, requiring graceful degradation
   strategies.
5. **Storage Limitations**: Browser storage quotas and XR session
   constraints require efficient persistence strategies for spatial data.

Without a standardized approach to these challenges, each AR feature would
require ad-hoc solutions, leading to inconsistent behavior, poor performance,
and maintenance overhead.

## Goals

The primary goals of this specification are:

- **Define a persistent anchor architecture** that survives session
  boundaries and device restarts
- **Standardize transformation matrix storage** for efficient spatial data
  serialization and retrieval
- **Establish AR desk marker rendering guidelines** for consistent visual
  presentation across devices
- **Enable multi-user calibration** for collaborative AR experiences
- **Provide comprehensive device compatibility guidance** for graceful
  degradation
- **Document security and privacy considerations** for spatial data handling

## Scope

This specification covers:

- WebXR Device API integration for immersive-ar sessions
- Spatial anchor creation, update, and removal workflows
- Transformation matrix computation, storage, and application
- AR desk marker geometry, materials, and animation
- Multi-user calibration protocol and synchronization
- Error handling and recovery strategies
- Performance optimization guidelines
- Security and privacy requirements

This specification does not cover:

- Underlying SLAM algorithm implementations
- Native platform ARCore/ARKit specifics
- Server-side spatial data processing
- Hardware requirements beyond WebXR API capabilities

---

## WebXR Spatial Anchor Architecture

### System Overview

The spatial anchor system consists of several interconnected components
that work together to provide persistent AR experiences:

```mermaid
graph TB
    subgraph "Client Layer"
        A[WebXR Session Manager] --> B[Anchor Controller]
        B --> C[Matrix Transformer]
        B --> D[Marker Renderer]
        B --> E[Sync Coordinator]
    end

    subgraph "Storage Layer"
        F[IndexedDB Store] --> G[Anchor Serializer]
        H[Local Cache] --> F
    end

    subgraph "Network Layer"
        I[PartyKit Channel] --> J[Sync Protocol]
        J --> E
    end

    C --> F
    E --> I
    D --> B
```

### Component Responsibilities

| Component             | Responsibility                                 |
| --------------------- | ---------------------------------------------- |
| WebXR Session Manager | Handles session creation, feature negotiation  |
| Anchor Controller     | Manages anchor CRUD operations and state       |
| Matrix Transformer    | Computes and applies transformation matrices   |
| Marker Renderer       | Creates and animates AR desk marker visuals    |
| Sync Coordinator      | Orchestrates multi-user anchor synchronization |
| IndexedDB Store       | Provides persistent storage for anchor data    |
| PartyKit Channel      | Enables real-time multi-user communication     |

---

## Persistent Anchor Lifecycle

### Lifecycle States

Spatial anchors transition through well-defined states during their
lifetime:

```mermaid
stateDiagram-v2
    [*] --> Detected: Hit-test result
    Detected --> Created: frame.createAnchor()
    Created --> Attached: Session active
    Attached --> Detached: Session ends
    Detached --> Attached: New session starts
    Attached --> Updated: User interaction
    Updated --> Attached: Update persisted
    Attached --> Removed: User deletes
    Removed --> [*]
    Detached --> Persisted: Save to IndexedDB
    Persisted --> Attached: Restore from storage
```

### State Descriptions

| State     | Description                                 | Duration      |
| --------- | ------------------------------------------- | ------------- |
| Detected  | Anchor position identified via hit-test     | Transient     |
| Created   | Anchor object instantiated in XR runtime    | Until session |
| Attached  | Anchor actively tracked in current session  | Session       |
| Detached  | Anchor not tracked but preserved in storage | Indefinite    |
| Persisted | Anchor data saved to IndexedDB              | Until pruned  |
| Updated   | Anchor position modified by user            | Transient     |
| Removed   | Anchor deleted from all storage and runtime | Permanent     |

---

## Anchor Creation Flow

### Step-by-Step Process

1. **Session Initialization**: Request XR session with anchor support
2. **Reference Space Acquisition**: Obtain local reference space
3. **Hit-Test or Calibration**: Determine anchor position
4. **Anchor Instantiation**: Create anchor via XRFrame API
5. **Matrix Extraction**: Extract transformation matrix
6. **Storage Serialization**: Convert matrix to storable format
7. **IndexedDB Persistence**: Save anchor data with metadata

### Code Example

```typescript
// 1. Request session with anchor support
const session = await navigator.xr.requestSession("immersive-ar", {
  requiredFeatures: ["local", "anchors"],
  optionalFeatures: ["hit-test"],
});

// 2. Get reference space
const referenceSpace = await session.requestReferenceSpace("local");

// 3. Create anchor from hit-test result
const hitTestSource = await session.requestHitTestSource({
  space: referenceSpace,
  entityTypes: ["plane"],
});

// In render loop:
const hitResults = frame.getHitTestResults(hitTestSource);

if (hitResults.length > 0) {
  const hit = hitResults[0];
  const pose = hit.getPose(referenceSpace);

  // 4. Create anchor
  const anchor = await frame.createAnchor(
    new XRRigidTransform(
      {
        x: pose.transform.position.x,
        y: pose.transform.position.y,
        z: pose.transform.position.z,
        w: 1,
      },
      pose.transform.orientation,
    ),
    referenceSpace,
  );

  // 5. Extract matrix
  const matrix = anchor.transform.matrix;

  // 6. Serialize and store
  await persistAnchor({
    id: crypto.randomUUID(),
    name: "Desk A-12",
    matrix: Array.from(matrix),
    createdAt: Date.now(),
    markerType: "desk",
  });
}
```

---

## Anchor Update Flow

Anchors may need updating due to:

- User repositioning via drag interaction
- Calibration refinement from multi-user alignment
- Drift correction based on tracking quality
- Metadata changes (name, status, notes)

### Update Process

```typescript
async function updateAnchor(
  anchorId: string,
  newTransform: XRRigidTransform,
): Promise<void> {
  // 1. Retrieve existing anchor
  const existing = await getAnchorById(anchorId);
  if (!existing) {
    throw new Error("Anchor not found");
  }

  // 2. Compute new matrix
  const newMatrix = rigidTransformToMatrix(newTransform);

  // 3. Validate transform
  if (!isValidMatrix(newMatrix)) {
    throw new Error("Invalid transformation matrix");
  }

  // 4. Update storage
  await updateAnchorStorage(anchorId, {
    matrix: Array.from(newMatrix),
    updatedAt: Date.now(),
    version: existing.version + 1,
  });

  // 5. Broadcast update to collaborators
  await broadcastAnchorUpdate(anchorId, newMatrix);
}
```

### Conflict Resolution Strategies

When multiple users update the same anchor
simultaneously:

| Strategy         | Description                   | Use Case           |
| ---------------- | ----------------------------- | ------------------ |
| Last-Writer-Wins | Most recent timestamp wins    | Simple collab.     |
| Vector Clock     | Logical ordering of events    | Causal consistency |
| Manual Merge     | User resolves conflicts       | Critical markers   |
| CRDT             | Conflict-free replicated data | High-concurrency   |

---

## Anchor Removal Flow

### Soft vs Hard Deletion

| Type        | Description                         | Recoverable   |
| ----------- | ----------------------------------- | ------------- |
| Soft Delete | Flag anchor as deleted, retain data | Yes (30 days) |
| Hard Delete | Remove all data from storage        | No            |

### Removal Process

```typescript
async function removeAnchor(
  anchorId: string,
  hard: boolean = false,
): Promise<void> {
  if (hard) {
    // Permanent removal
    await deleteFromIndexedDB(anchorId);
    await broadcastAnchorDeletion(anchorId);
  } else {
    // Soft delete with 30-day grace period
    await updateAnchorStorage(anchorId, {
      deleted: true,
      deletedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
  }
}
```

---

## Persistence Strategy

### Storage Architecture

WorkSphere uses a multi-tier persistence strategy:

```mermaid
graph LR
    A[XR Session] -->|In-Memory| B[Runtime Cache]
    B -->|On Update| C[IndexedDB]
    C -->|On Sync| D[PartyKit]
    D -->|Broadcast| E[Other Clients]
    E -->|Local| F[Client IndexedDB]
```

### IndexedDB Schema

```typescript
interface AnchorRecord {
  key: string;
  value: {
    id: string;
    name: string;
    matrix: number[];
    position: {
      x: number;
      y: number;
      z: number;
    };
    orientation: {
      x: number;
      y: number;
      z: number;
      w: number;
    };
    createdAt: number;
    updatedAt: number;
    deleted?: boolean;
    deletedAt?: number;
    expiresAt?: number;
    venueId: string;
    floor: number;
    markerType: "desk" | "waypoint" | "calibration" | "exit";
    metadata: Record<string, unknown>;
    version: number;
  };
}
```

### Sync Protocol

Anchors synchronize via PartyKit using operational
transforms:

```typescript
interface AnchorOperation {
  type: "create" | "update" | "delete";
  anchorId: string;
  timestamp: number;
  vectorClock: Record<string, number>;
  payload: Partial<AnchorRecord["value"]>;
}
```

---

## REST API Reference (`/api/ar/anchors`)

The `/api/ar/anchors` REST endpoint provides backend persistence, query resolution, transformation normalization, and lifecycle deletion for spatial anchors across client sessions.

### Authentication & Access Token Validation

All requests to `/api/ar/anchors` require bearer token authorization in the HTTP request headers or a valid Clerk session cookie:

```http
Authorization: Bearer <clerk_jwt_token>
Content-Type: application/json
```

#### Token Validation Workflow

1. **Header Parsing**: Server extracts JWT string from `Authorization: Bearer <token>`.
2. **Cryptographic Verification**: Validates signature using `@clerk/backend` `verifyToken()` against `CLERK_SECRET_KEY`.
3. **Role Evaluation**: Verifies `sub` (User ID) has write permissions (`OWNER` / `EDITOR`) for the specified `venueId`. VIEWERS are restricted to `GET` read endpoints.
4. **401/403 Errors**: Returns HTTP 401 `UNAUTHORIZED` if token missing/invalid, or HTTP 403 `FORBIDDEN` if permission evaluation fails.

---

### Request & Response JSON Schemas

#### 1. Create Spatial Anchor (`POST /api/ar/anchors`)

**Request JSON Schema:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CreateSpatialAnchorRequest",
  "type": "object",
  "required": ["venueId", "floor", "name", "markerType", "matrix"],
  "properties": {
    "venueId": { "type": "string", "minLength": 1 },
    "floor": { "type": "integer", "default": 1 },
    "name": { "type": "string", "maxLength": 100 },
    "markerType": {
      "type": "string",
      "enum": ["desk", "waypoint", "calibration", "exit"]
    },
    "matrix": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 16,
      "maxItems": 16,
      "description": "Column-major 4x4 transformation matrix array normalized to unit scale."
    },
    "metadata": { "type": "object", "additionalProperties": true }
  }
}
```

**Success Response (HTTP 201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "anc_9f83a2c0-4e1b-4390-9c21",
    "venueId": "venue_workplace_sf_01",
    "floor": 2,
    "name": "Desk A-12",
    "markerType": "desk",
    "matrix": [
      1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.45, 0.82,
      -2.3, 1.0
    ],
    "position": { "x": 1.45, "y": 0.82, "z": -2.3 },
    "orientation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 },
    "scale": { "x": 1.0, "y": 1.0, "z": 1.0 },
    "version": 1,
    "createdAt": 1784825000000,
    "updatedAt": 1784825000000
  }
}
```

---

#### 2. Query Spatial Anchors (`GET /api/ar/anchors?venueId={id}&floor={floor}`)

**Response JSON Schema (HTTP 200 OK):**

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "anc_9f83a2c0-4e1b-4390-9c21",
      "venueId": "venue_workplace_sf_01",
      "floor": 2,
      "name": "Desk A-12",
      "markerType": "desk",
      "matrix": [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.45, 0.82,
        -2.3, 1.0
      ],
      "position": { "x": 1.45, "y": 0.82, "z": -2.3 },
      "orientation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 },
      "version": 1
    }
  ]
}
```

---

#### 3. Delete Spatial Anchor (`DELETE /api/ar/anchors?id={anchorId}&hard={boolean}`)

**Parameters:**

- `id` (Query String, Required): Target spatial anchor ID.
- `hard` (Query String, Optional): `true` for immediate hard deletion from database; `false` (default) for 30-day soft deletion.

**Success Response (HTTP 200 OK):**

```json
{
  "success": true,
  "message": "Spatial anchor deleted successfully",
  "deletedId": "anc_9f83a2c0-4e1b-4390-9c21",
  "hardDelete": false,
  "expiresAt": 1787417000000
}
```

---

### 4x4 Transformation Matrix Coordinate Normalization

Transformation matrices submitted to `/api/ar/anchors` must adhere to column-major 4x4 layout in a right-handed WebXR coordinate system (+X right, +Y up, -Z forward).

#### Matrix Normalization Algorithm:

1. **Decomposition**: Extract translation vector $\vec{T} = [m_{12}, m_{13}, m_{14}]$, scale factors $S_x = \|\vec{C}_0\|, S_y = \|\vec{C}_1\|, S_z = \|\vec{C}_2\|$, and rotation submatrix $R$.
2. **Orthogonalization**: Normalize basis column vectors to prevent shear deformation:
   $$\hat{C}_0 = \frac{\vec{C}_0}{\|\vec{C}_0\|}, \quad \hat{C}_1 = \frac{\vec{C}_1}{\|\vec{C}_1\|}, \quad \hat{C}_2 = \hat{C}_0 \times \hat{C}_1$$
3. **Unit Scale Enforcement**: Scale factors $S_x, S_y, S_z$ are normalized to unit vector scale ($1.0$) for spatial anchor anchoring, storing unscaled rigid orientation quaternions ($q_x, q_y, q_z, q_w$).
4. **Validation Check**: Reject matrices containing `NaN`, `Infinity`, non-affine elements ($m_3 \ne 0, m_7 \ne 0, m_{11} \ne 0, m_{15} \ne 1$), or determinant $\det(R) \le 0$.

---

## Transformation Matrix Storage

### Matrix Format

WebXR uses 4x4 transformation matrices in
column-major order:

```text
Column-major 4x4 Matrix:
┌─────────────────────────────────────┐
│  m[0]   m[4]   m[8]    m[12]       │
│  m[1]   m[5]   m[9]    m[13]       │
│  m[2]   m[6]   m[10]   m[14]       │
│  m[3]   m[7]   m[11]   m[15]       │
└─────────────────────────────────────┘

Translation: [m[12], m[13], m[14]]
Scale: [m[0], m[5], m[10]]
Rotation: 3x3 submatrix
```

### Storage Optimization

| Format          | Size  | Precision          | Use Case        |
| --------------- | ----- | ------------------ | --------------- |
| Float32Array    | 64 B  | ~7 decimal digits  | Runtime, GPU    |
| Float64Array    | 128 B | ~15 decimal digits | Calibration     |
| Quantized Int16 | 32 B  | ±32767 range       | Storage-limited |
| Quaternion+Pos  | 28 B  | Full precision     | Compact storage |

---

## Matrix Examples

### Identity Transform

```typescript
const identityMatrix = new Float32Array([
  1,
  0,
  0,
  0, // Column 0: X-axis
  0,
  1,
  0,
  0, // Column 1: Y-axis
  0,
  0,
  1,
  0, // Column 2: Z-axis
  0,
  0,
  0,
  1, // Column 3: Translation
]);
```

### Translation Only

```typescript
// Translate 2m right, 1m up, 3m forward
const translationMatrix = new Float32Array([
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  2,
  1,
  -3,
  1, // Note: -Z is forward
]);
```

### Rotation + Translation

```typescript
// 90° rotation around Y-axis + translation
const rotY90 = new Float32Array([
  0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 5, 0, -2, 1,
]);
```

---

## Coordinate Systems & Transformation Matrix Diagrams

### WebXR Coordinate System

WebXR uses a right-handed Cartesian coordinate system:

- **+X**: Right (lateral axis)
- **+Y**: Up (vertical elevation axis)
- **-Z**: Forward (line of sight / depth into the scene)

```mermaid
graph LR
    subgraph "WebXR Right-Handed Coordinate System"
        X["+X Right (Horizontal)"] --- Origin((0,0,0 Origin))
        Y["+Y Up (Altitude)"] --- Origin
        Z["-Z Forward (Depth / View Target)"] --- Origin
    end
```

### Coordinate Frame Transformation Chain

In WorkSphere, spatial anchors and AR markers are positioned by resolving transformations across five distinct coordinate frames:

```mermaid
graph TD
    V["Venue / CAD Building Frame (V)"] -->|"T_V_to_W (Calibration Origin Offset)"| W["WebXR World / Reference Frame (W)"]
    W -->|"T_W_to_C (XRViewerPose.transform)"| C["Camera / Device View Frame (C)"]
    C -->|"T_C_to_M (Fiducial / Image Tracking PnP)"| M["Physical AR Marker Frame (M)"]
    M -->|"T_M_to_A (Known Physical Desk CAD Offset)"| A["Desk Spatial Anchor Frame (A)"]
    W -.->|"T_W_to_A = T_W_to_C * T_C_to_M * T_M_to_A"| A
```

#### Coordinate Frame Definitions:

1. **Venue Frame ($\mathcal{V}$)**: The global building coordinate space (meters from architectural origin / CAD datum).
2. **World Frame ($\mathcal{W}$)**: WebXR reference space (`'local-floor'` or `'unbounded'`), established when the XR session begins.
3. **Camera Frame ($\mathcal{C}$)**: Dynamic viewer pose tracked by visual-inertial odometry (`XRViewerPose`).
4. **Marker Frame ($\mathcal{M}$)**: Coordinate system centered on the physical QR/AprilTag/ArUco marker on the desk surface (+Z normal to desk surface).
5. **Anchor Frame ($\mathcal{A}$)**: Coordinate frame of the persistent virtual asset / desk UI overlay.

### Transformation Matrix Math & Derivation

The transformation matrix $T_{A \to B}$ is represented as a $4 \times 4$ homogeneous transformation matrix:

$$
T_{A \to B} = \begin{bmatrix} 
R_{11} & R_{12} & R_{13} & t_x \\
R_{21} & R_{22} & R_{23} & t_y \\
R_{31} & R_{32} & R_{33} & t_z \\
0 & 0 & 0 & 1 
\end{bmatrix}
$$

#### 1. Spatial Anchor Pose from AR Marker Detection
When a user scans a physical desk marker, computer vision (WebXR Image Tracking or OpenCV/ZXing) solves Perspective-n-Point (PnP) to yield $T_{\mathcal{C} \to \mathcal{M}}$. The persistent world anchor pose $T_{\mathcal{W} \to \mathcal{A}}$ is computed as:

$$T_{\mathcal{W} \to \mathcal{A}} = T_{\mathcal{W} \to \mathcal{C}} \cdot T_{\mathcal{C} \to \mathcal{M}} \cdot T_{\mathcal{M} \to \mathcal{A}}$$

Where:
- $T_{\mathcal{W} \to \mathcal{C}}$ is obtained directly from `XRFrame.getViewerPose(referenceSpace).transform.matrix`.
- $T_{\mathcal{C} \to \mathcal{M}}$ is the detected relative marker transform.
- $T_{\mathcal{M} \to \mathcal{A}}$ is the predefined CAD offset from the physical marker to the center of the desk.

#### 2. Relative View Transform for Rendering
To render the virtual desk bounding box and availability badge relative to the camera in each frame:

$$T_{\mathcal{C} \to \mathcal{A}} = (T_{\mathcal{W} \to \mathcal{C}})^{-1} \cdot T_{\mathcal{W} \to \mathcal{A}}$$

```mermaid
sequenceDiagram
    autonumber
    participant Camera as Device Camera (Frame C)
    participant Tracker as WebXR Image / Marker Tracker
    participant Session as XRFrame / Reference Space (Frame W)
    participant Store as Anchor Persistence (IndexedDB)
    participant Renderer as Three.js / WebGL Scene

    Camera->>Tracker: Feed video frame with AR fiducial marker
    Tracker->>Tracker: Solve PnP -> Compute T_C_to_M
    Session->>Tracker: Query Viewer Pose -> T_W_to_C
    Tracker->>Session: Compute T_W_to_A = T_W_to_C * T_C_to_M * T_M_to_A
    Session->>Session: frame.createAnchor(T_W_to_A, referenceSpace)
    Session->>Store: Serialize and persist normalized 4x4 matrix
    loop Every Render Frame (60-90Hz)
        Session->>Renderer: frame.getPose(anchor.anchorSpace, referenceSpace)
        Renderer->>Renderer: Update desk model matrix (T_C_to_A)
        Renderer->>Renderer: Draw WebGL desk indicator & occupancy ring
    end
```

### Reference Space Types

| Space Type      | Origin                      | Continuity | Use Case                          |
| --------------- | --------------------------- | ---------- | --------------------------------- |
| `local`         | Viewer pose at session init | Discontinuous on reset | Seated or standing AR preview |
| `local-floor`   | Floor level below init pose | Stable ground plane | Room-scale indoor AR desk check-in |
| `bounded-floor` | Floor center with play area | Strict perimeter boundary | Booths and enclosed meeting rooms |
| `unbounded`     | Visual-Inertial Odometry origin | Continuous SLAM drift correction | Multi-room & venue-wide navigation |

---

## World Space vs Local Space

### Definitions

| Space        | Description                  | Persistence     |
| ------------ | ---------------------------- | --------------- |
| World Space  | Global coordinate system     | Requires calib. |
| Local Space  | Device-relative per session  | Session-only    |
| Anchor Space | Per-anchor coordinate system | Persistent      |

### Conversion Between Spaces

```typescript
function worldToAnchor(
  worldPoint: DOMPointReadOnly,
  anchorMatrix: Float32Array,
): DOMPointReadOnly {
  const invMatrix = invertMatrix(anchorMatrix);
  return transformPoint(invMatrix, worldPoint);
}

function anchorToWorld(
  anchorPoint: DOMPointReadOnly,
  anchorMatrix: Float32Array,
): DOMPointReadOnly {
  return transformPoint(anchorMatrix, anchorPoint);
}
```

### Calibration for World Space

World space requires calibration against known physical points:

1. **QR / AprilTag Marker Calibration**: Optical fiducial scan with known physical dimensions
2. **Spatial Feature Calibration**: Point cloud alignment against pre-mapped 3D point clouds
3. **Multi-User Calibration**: Peer-to-peer relative pose triangulation
4. **Geographic Calibration**: High-precision indoor BLE beacons + GPS floor plan projection

---

## AR Desk Marker Rendering

### Marker Types

| Type      | Geometry           | Purpose          |
| --------- | ------------------ | ---------------- |
| Available | Green ring+circle  | Bookable desk    |
| Occupied  | Red ring+circle    | In use           |
| Reserved  | Yellow ring+circle | User reserved    |
| Waypoint  | Blue arrow         | Navigation guide |
| Exit      | Gray door icon     | Emergency exit   |

### Rendering Pipeline

```mermaid
graph TB
    A[Anchor Matrix] --> B[Transform Calc]
    B --> C[LOD Selection]
    C --> D[Geometry Creation]
    D --> E[Material Setup]
    E --> F[Animation Update]
    F --> G[GPU Draw Call]
```

### Three.js Implementation

```typescript
function createDeskMarker(
  status: "available" | "occupied" | "reserved",
): THREE.Group {
  const group = new THREE.Group();

  // Outer ring
  const ringGeometry = new THREE.RingGeometry(0.3, 0.35, 64);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color:
      status === "available"
        ? 0x22c55e
        : status === "occupied"
          ? 0xef4444
          : 0xeab308,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  // Inner circle
  const circleGeometry = new THREE.CircleGeometry(0.28, 64);
  const circleMaterial = new THREE.MeshBasicMaterial({
    color:
      status === "available"
        ? 0x16a34a
        : status === "occupied"
          ? 0xdc2626
          : 0xca8a04,
    transparent: true,
    opacity: 0.6,
  });
  const circle = new THREE.Mesh(circleGeometry, circleMaterial);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.001;
  group.add(circle);

  return group;
}
```

### Performance Guidelines

| Metric             | Target     | Measurement    |
| ------------------ | ---------- | -------------- |
| Polygon per marker | < 500 tris | Geometry       |
| Draw calls/frame   | < 20       | All markers    |
| Texture memory     | < 10 MB    | Materials      |
| Update frequency   | 30 Hz      | Animation loop |

---

## Multi-user Calibration

### Calibration Workflow

```mermaid
sequenceDiagram
    participant A as User A Host
    participant S as PartyKit
    participant B as User B Guest

    A->>S: Broadcast calibration point
    S->>B: Forward calibration point
    B->>B: Scan same physical marker
    B->>S: Send local pose
    S->>A: Forward local pose
    A->>A: Compute alignment transform
    A->>S: Broadcast alignment
    S->>B: Forward alignment
    B->>B: Apply alignment
```

### Alignment Transform Calculation

```typescript
function computeAlignmentTransform(
  hostAnchor: AnchorRecord,
  guestAnchor: AnchorRecord,
): Float32Array {
  // Both users scanned same marker
  // T_align = T_host * T_guest^-1
  const guestInverse = invertMatrix(new Float32Array(guestAnchor.matrix));
  return multiplyMatrices(new Float32Array(hostAnchor.matrix), guestInverse);
}
```

### Calibration Quality Metrics

| Metric              | Threshold   | Action if Failed |
| ------------------- | ----------- | ---------------- |
| Reprojection error  | < 2 cm      | Reject calib.    |
| Tracking confidence | > 0.8       | Warn user        |
| Marker distance     | 0.5 - 3.0 m | Reposition       |
| Ambient light       | > 100 lux   | Warn accuracy    |

---

## Synchronization Workflow

### Message Types

| Message             | Direction             | Payload          |
| ------------------- | --------------------- | ---------------- |
| `anchor:create`     | Client → Server → All | Full anchor data |
| `anchor:update`     | Client → Server → All | Changed fields   |
| `anchor:delete`     | Client → Server → All | Anchor ID        |
| `anchor:sync`       | Server → Client       | Full snapshot    |
| `calibration:point` | Client → Server → All | Marker pose      |
| `calibration:align` | Client → Server → All | Alignment matrix |

### Synchronization Conflict Resolution

```typescript
function resolveConflict(
  local: AnchorOperation,
  remote: AnchorOperation,
): AnchorOperation {
  // Vector clock comparison
  const localSum = Object.values(local.vectorClock).reduce((a, b) => a + b, 0);

  const remoteSum = Object.values(remote.vectorClock).reduce(
    (a, b) => a + b,
    0,
  );

  if (remoteSum > localSum) return remote;
  if (remoteSum < localSum) return local;

  // Tie-break by timestamp
  return remote.timestamp > local.timestamp ? remote : local;
}
```

---

## Error Handling

### Error Categories

| Category | Examples           | Recovery Strategy |
| -------- | ------------------ | ----------------- |
| Session  | NotSupportedError  | Fallback to 2D    |
| Anchor   | QuotaExceededError | Prune old anchors |
| Sync     | Network timeout    | Queue + backoff   |
| Storage  | IndexedDB full     | Clear cache       |

### Recovery Implementation

```typescript
async function safeCreateAnchor(
  frame: XRFrame,
  referenceSpace: XRReferenceSpace,
  pose: XRRigidTransform,
): Promise<XRAnchor | null> {
  try {
    return await frame.createAnchor(pose, referenceSpace);
  } catch (error) {
    if (error instanceof DOMException) {
      switch (error.name) {
        case "NotSupportedError":
          console.warn("Anchors not supported");
          return null;
        case " QuotaExceededError":
          await pruneOldAnchors();
          return await frame.createAnchor(pose, referenceSpace);
      }
    }
    throw error;
  }
}
```

---

## Performance Considerations

### Profiling Metrics

| Metric                  | Target   | Measurement Method    |
| ----------------------- | -------- | --------------------- |
| Anchor creation latency | < 50 ms  | Performance.now()     |
| Matrix computation      | < 5 ms   | Render loop timing    |
| Sync round-trip         | < 100 ms | PartyKit metrics      |
| Storage read/write      | < 10 ms  | IndexedDB performance |
| Memory per anchor       | < 2 KB   | Heap snapshot         |

### Optimization Strategies

1. **LOD System**: Reduce marker complexity at distance
2. **Frustum Culling**: Only render visible markers
3. **Batch Updates**: Group multiple anchor updates
4. **Lazy Loading**: Load markers on-demand
5. **Compression**: Use quantized matrices

### Memory Management

```typescript
class AnchorRenderer {
  private pool: Map<string, THREE.Group> = new Map();
  private maxSize = 50;

  acquire(id: string): THREE.Group {
    if (this.pool.has(id)) {
      return this.pool.get(id)!;
    }

    if (this.pool.size >= this.maxSize) {
      this.evictOldest();
    }

    const marker = createDeskMarker();
    this.pool.set(id, marker);
    return marker;
  }

  release(id: string): void {
    const marker = this.pool.get(id);
    if (marker) {
      marker.visible = false;
      this.pool.delete(id);
    }
  }

  private evictOldest(): void {
    const first = this.pool.keys().next().value;
    if (first) this.release(first);
  }
}
```

---

## Security and Privacy

### Data Sensitivity

| Data Type         | Sensitivity | Protection Required |
| ----------------- | ----------- | ------------------- |
| Anchor positions  | Medium      | Encrypted storage   |
| Calibration data  | High        | E2E encryption      |
| Venue floor plans | High        | Access control      |
| Device tracking   | Very High   | Minimal retention   |

### Security Requirements

1. **HTTPS Only**: All WebXR sessions require secure
   context
2. **User Consent**: Explicit permission before anchor
   creation
3. **Data Minimization**: Store only required data
4. **Retention Limits**: Auto-delete after period
5. **Access Control**: Venue-based permissions

### Privacy Guidelines

```typescript
interface PrivacySettings {
  anchorRetentionDays: number;
  syncEnabled: boolean;
  anonymousCalibration: boolean;
  dataEncryption: "AES-GCM" | "None";
}
```

---

## Browser Compatibility Table

| Browser | Platform | WebXR `immersive-ar` | Anchors (`'anchors'`) | Hit-Test (`'hit-test'`) | Image Tracking (`'image-tracking'`) | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Meta Quest Browser** (v30+) | Meta Quest 3 / Quest Pro / Quest 2 | Full | Full Support | Full Support | Full Support | Primary target for spatial computing. Passthrough enabled. |
| **visionOS Safari** (1.1+) | Apple Vision Pro | Full (`transient-pointer`) | Full (`XRAnchor`) | Full (`local-floor`) | Partial (requires manual fiducial CV) | WebXR feature flags enabled in Safari Advanced Settings. |
| **Google Chrome Mobile** (81+) | Android (ARCore supported) | Full | Full Support | Full Support | Full Support | Standard for mobile AR desk check-ins. |
| **Microsoft Edge Mobile** (81+) | Android (ARCore supported) | Full | Full Support | Full Support | Full Support | Chromium WebXR implementation. |
| **Samsung Internet** (16+) | Android (Galaxy devices) | Full | Full Support | Full Support | Varies | Device-dependent ARCore integration. |
| **Firefox Reality / Wolvic** (1.4+) | Pico 4 / Vive Focus 3 / Meta Quest | Full | Full Support | Full Support | Experimental | Open-source XR browser based on Gecko/Chromium. |
| **Safari Mobile** (iOS 17+) | iPhone / iPad (LiDAR & A-series) | Polyfill / WebXR Viewer | Polyfill | Polyfill | WebAssembly (ZXing/OpenCV) | Native WebXR requires Mozilla WebXR Viewer or WebXR Polyfill. |
| **Desktop Chrome / Edge** | Windows / macOS / Linux | WebXR Emulator Extension | Emulated | Emulated | Emulated | Used for local developer debugging and matrix unit tests. |

---

## Device Compatibility Table

| Hardware Device Category | Primary XR Runtime | Tracking DOF | Spatial Anchors Support | Typical Latency | Recommended Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Meta Quest 3 & Quest Pro** | Meta Horizon OS / OpenXR | 6-DOF Inside-Out (Color Passthrough) | Native WebXR Spatial Anchors + Horizon Cloud Spatial Anchors | < 12 ms | Multi-user desk calibration, immersive venue layout |
| **Apple Vision Pro** | visionOS / ARKit | 6-DOF Inside-Out (High-Res Video See-Through) | Native visionOS Anchor Spaces | < 10 ms | Spatial workspace exploration & real-time collaboration |
| **Magic Leap 2** | Android AOSP / OpenXR | 6-DOF Optical See-Through | Native OpenXR Spatial Anchors | < 15 ms | Enterprise desk management & facility maintenance |
| **Android Smartphones (ARCore)** | Google Play Services for AR | 6-DOF Monocular / LiDAR SLAM | WebXR Anchors API (`XRSession`) | < 25 ms | Desk QR check-in, quick wayfinding |
| **iOS Devices (iPhone 12-16 Pro)** | ARKit via WebXR Polyfill / WebXR Viewer | 6-DOF LiDAR + Scene Geometry | IndexedDB Persistent Matrices + ARKit Anchors | < 20 ms | Mobile AR inspection & floor plan verification |
| **Standalone Android (Non-ARCore)** | Accelerometer / Gyroscope (Fallback) | 3-DOF Orientation Only | 2D Map Coordinate Projection Fallback | N/A | Graceful 2D floor plan fallback with compass heading |

---

## Best Practices

### Anchor Management

- **Use meaningful names**: `"Desk A-12"` not `"anchor-001"`
- **Set appropriate retention**: Balance persistence with limits
- **Validate transforms**: Check for NaN/infinity
- **Batch operations**: Group updates for efficiency

### Matrix Operations

- **Prefer Float32Array**: Better performance
- **Avoid unnecessary inversions**: Cache inverses
- **Use column-major order**: Match WebXR convention
- **Validate before GPU upload**: Ensure valid transforms

### Multi-User Sync

- **Implement conflict resolution**: Don't assume last-write
- **Handle disconnections**: Queue during network issues
- **Use vector clocks**: Maintain causal ordering
- **Broadcast incrementally**: Send deltas not full state

### Performance

- **Profile regularly**: Monitor count and performance
- **Implement LOD**: Reduce complexity at distance
- **Pool objects**: Reuse geometries and materials
- **Use Web Workers**: Offload matrix computation

---

## Future Improvements

### Short-term (3-6 months)

- [ ] Implement anchor drift correction
- [ ] Add visual calibration feedback
- [ ] Support cloud anchor backup
- [ ] Optimize sync for mobile networks

### Medium-term (6-12 months)

- [ ] Add semantic label recognition
- [ ] Implement automatic venue mapping
- [ ] Support cross-platform anchor sharing
- [ ] Add anchor grouping and hierarchies

### Long-term (12+ months)

- [ ] ML-based drift correction
- [ ] Collaborative 3D reconstruction
- [ ] Persistent world-scale AR maps
- [ ] Integration with native AR platforms

---

## Conclusion

This specification provides a comprehensive framework
for implementing persistent spatial anchors in WebXR
applications. By following these guidelines, developers
can create reliable, performant, and secure AR
experiences that work across diverse devices and
support collaborative use cases.

The key takeaways are:

1. **Persistence requires planning**: Design storage
   strategies early
2. **Calibration is critical**: Multi-user alignment
   needs careful implementation
3. **Performance matters**: Optimize for mobile and
   limited bandwidth
4. **Privacy is paramount**: Treat spatial data as
   sensitive
5. **Graceful degradation**: Always provide fallbacks

For questions or contributions, refer to the WebXR
specification and WebXR Device API documentation.
