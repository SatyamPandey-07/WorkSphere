# WebAudio Spatial Panner — Multi-User HRTF Spatial Audio Graph

> **Status:** Proposed Architecture (not yet implemented)  
> **Depends on:** WebRTC peer-to-peer media tracks (see [WEBRTC_MESH_NETWORKING_GUIDE.md](./WEBRTC_MESH_NETWORKING_GUIDE.md))  
> **Related:** [NOISE_METER_ARCHITECTURE.md](./NOISE_METER_ARCHITECTURE.md) — WebAudio lifecycle & FFT analysis  
> **PartyKit Signaling:** `party/server.ts` — WebRTC signaling relay (`webrtc-signal` message type)

This document describes the proposed **multi-user spatial audio graph** architecture for WorkSphere. It documents how per-peer `PannerNode` instances, an `AudioListener`, HRTF-based distance attenuation, and 3D coordinate synchronization combine to produce an immersive spatial audio experience in collaborative workspaces.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [WebAudio PannerNode & Spatial Graph](#2-webaudio-pannernode--spatial-graph)
3. [3D Vector Math & HRTF Distance Attenuation](#3-3d-vector-math--hrtf-distance-attenuation)
4. [WebRTC Media Track → Spatial Node Routing](#4-webrtc-media-track--spatial-node-routing)
5. [Listener Coordinate Synchronization](#5-listener-coordinate-synchronization)
6. [React Integration: `useSpatialAudio` Hook](#6-react-integration-usespatialaudio-hook)
7. [Performance Considerations](#7-performance-considerations)
8. [References](#8-references)

---

## 1. Architecture Overview

The spatial audio graph creates a 3D sound field where each remote peer's voice is positioned relative to the local user's **head (listener)** position and orientation. The system is composed of four layers:

```
┌──────────────────────────────────────────────────────────────────┐
│                      Application Layer                            │
│  (Room state, peer position/orientation store, coordinate sync)   │
└──────────────────┬──────────────────────────────────────────┬─────┘
                   │                                          │
                   ▼                                          ▼
┌────────────────────────────────┐  ┌─────────────────────────────┐
│   WebRTC Peer Connection Layer │  │   WebAudio Spatial Graph    │
│                                │  │                             │
│  ┌─────────┐    ┌──────────┐   │  │  AudioContext               │
│  │ Peer A   │───►│ remote   │   │  │   ├─ Listener              │
│  │ (offer)  │    │ audio    │   │  │   │  (position/orientation) │
│  └─────────┘    │ stream   │   │  │   │                         │
│                 └────┬─────┘   │  │   ├─ PannerNode (Peer A)◄───┤──── remote stream A
│  ┌─────────┐    ┌────┴──────┐  │  │   │  .panningModel="HRTF"  │
│  │ Peer B   │───►│ remote   │  │  │   │  .position=(x₁,y₁,z₁)  │
│  │ (offer)  │    │ audio    │  │  │   │  .orientation=(dx,..)   │
│  └─────────┘    │ stream   │  │  │   ├─ GainNode (Peer A)       │
│                 └────┬─────┘  │  │   │  (per-peer volume trim)  │
│  ... etc for N peers  │       │  │   ├─ PannerNode (Peer B)◄───┤─── remote stream B
│                       │       │  │   ├─ GainNode (Peer B)       │
│                       │       │  │   ├─ ... (for N peers)       │
│                       │       │  │   └─ Master GainNode         │
│                       │       │  │      └─ ctx.destination      │
└───────────────────────┴───────┘  └──────────────────────────────┘

         PartyKit Signaling (connection setup only)
         ────────────────────────────────────────
         • webrtc-signal / offer / answer / ice
         • spatial_listener_update (position/orientation broadcast)
```

### Component Responsibilities

| Layer              | Component                      | Responsibility                                                 |
| ------------------ | ------------------------------ | -------------------------------------------------------------- |
| **Signaling**      | PartyKit (`party/server.ts`)   | WebRTC SDP/ICE exchange; broadcast listener coordinate updates |
| **Transport**      | `RTCPeerConnection` (per peer) | Capture remote audio `MediaStreamTrack`                        |
| **Spatialization** | `PannerNode` (per peer)        | HRTF binaural rendering from 3D position/orientation           |
| **Listener**       | `AudioListener` (singleton)    | Local user head position/orientation in world space            |
| **Application**    | React hook + Zustand store     | Track peer positions, update PannerNodes each frame            |

---

## 2. WebAudio PannerNode & Spatial Graph

### 2.1 AudioContext Topology

The spatial graph for an `N`-peer session follows a **per-peer fan-out** pattern:

```
User's Microphone (optional, for local monitoring)
     │
     ▼
MediaStreamAudioSourceNode
     │
     ├──► Local Monitoring (optional GainNode → destination)

Remote Peer A MediaStreamTrack
     │
     ▼
MediaStreamAudioSourceNode (for Peer A)
     │
     ▼
GainNode (Peer A — level trim)
     │
     ▼
PannerNode (Peer A)
     │  • panningModel: "HRTF"
     │  • distanceModel: "inverse"
     │  • refDistance: 1.0
     │  • maxDistance: 50.0
     │  • rolloffFactor: 1.0
     │  • position: (x_A, y_A, z_A)
     │  • orientation: (ox_A, oy_A, oz_A)
     │
     ▼
AudioContext.destination  ←── AudioListener (local head position/orientation)
```

### 2.2 PannerNode Configuration

```typescript
// Recommended PannerNode defaults for WorkSphere spatial audio
const PANNER_DEFAULTS: Partial<PannerNode> = {
  panningModel: "HRTF", // Binaural rendering via Head-Related Transfer Function
  distanceModel: "inverse", // Realistic distance attenuation (1 / distance)
  refDistance: 1.0, // Reference distance (no attenuation at this distance)
  maxDistance: 50.0, // Beyond this distance, gain remains constant
  rolloffFactor: 1.0, // Attenuation steepness
  coneInnerAngle: 360, // Full sphere — no directional cone for voice
  coneOuterAngle: 0,
  coneOuterGain: 0,
};
```

> **Why HRTF?** The `"HRTF"` panning model uses convolution with measured Head-Related Transfer Functions, producing realistic binaural cues (ITD — Interaural Time Difference, ILD — Interaural Level Difference, and spectral notches) that let the brain localize sound in 3D space over headphones. `"equalpower"` is cheaper but lacks elevation cues.

### 2.3 AudioListener Synchronization

The `AudioListener` (accessed via `AudioContext.listener`) represents the **local user's ears** in world space. For spatial audio to work, the listener's position and orientation must be updated whenever the user moves or rotates their head/viewpoint.

```typescript
const ctx = new AudioContext();
const listener = ctx.listener;

// Update listener position (world coordinates)
listener.positionX.value = localX;
listener.positionY.value = localY;
listener.positionZ.value = localZ;

// Update listener orientation (forward + up vectors)
listener.forwardX.value = forwardX; // unit vector for "where the nose points"
listener.forwardY.value = forwardY;
listener.forwardZ.value = forwardZ;
listener.upX.value = upX; // unit vector for "where the top of head points"
listener.upY.value = upY;
listener.upZ.value = upZ;
```

### 2.4 Graph Connection Sequence

```typescript
// 1. Create AudioContext (must be from user gesture)
const ctx = new AudioContext();

// 2. Create per-peer spatial chain
function createPeerSpatialNode(ctx: AudioContext, stream: MediaStream) {
  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = 1.0; // further adjustable via UI

  const panner = new PannerNode(ctx, {
    panningModel: "HRTF",
    distanceModel: "inverse",
    refDistance: 1.0,
    maxDistance: 50.0,
    rolloffFactor: 1.0,
    position: [0, 0, 0],
    orientation: [0, 0, -1],
  });

  source.connect(gain);
  gain.connect(panner);
  panner.connect(ctx.destination);

  return { source, gain, panner };
}

// 3. On each new remote peer track:
const { source, gain, panner } = createPeerSpatialNode(ctx, remoteStream);
peerSpatialMap.set(peerId, { source, gain, panner });
```

---

## 3. 3D Vector Math & HRTF Distance Attenuation

### 3.1 Distance Attenuation Formulas

The `PannerNode` computes gain based on the Euclidean distance between the listener and the sound source. The `"inverse"` model follows:

#### Inverse Distance Model (default)

```
distance = √((x_source − x_listener)² + (y_source − y_listener)² + (z_source − z_listener)²)

gain = refDistance / (refDistance + rolloffFactor × (distance − refDistance))
```

When `distance ≤ refDistance`, `gain = 1.0` (no attenuation).

As `distance → maxDistance`, gain approaches:

```
gainₘᵢₙ = refDistance / (refDistance + rolloffFactor × (maxDistance − refDistance))
```

For `distance > maxDistance`, gain is clamped to `gainₘᵢₙ`.

#### Linear Distance Model (alternative)

```
gain = 1.0 − rolloffFactor × (distance − refDistance) / (maxDistance − refDistance)
```

Clamped to [0, 1].

#### Exponential Distance Model (alternative)

```
gain = (distance / refDistance)^(−rolloffFactor)
```

### 3.2 Azimuth & Elevation Calculation

The HRTF panning model converts source position to **azimuth** (horizontal angle) and **elevation** (vertical angle) relative to the listener's head. These angles determine which HRTF impulse response is applied.

Given listener position `L`, source position `S`, listener forward vector `F`, and listener up vector `U`:

```
// Vector from listener to source
sourceToListener = L − S     // PannerNode uses source-relative convention
                             // (negated internally based on listener orientation)

// Convert to listener's head-relative coordinate system
// Basis vectors: right (R), forward (F), up (U)
R = normalize(cross(F, U))   // right vector (perpendicular to forward/up)
U' = normalize(cross(R, F))  // re-orthogonalized up vector

// Relative position in head coordinates
relative = normalize(sourceToListener)

// Azimuth: angle in the horizontal plane (xy in head coords)
azimuth = atan2(dot(relative, R), dot(relative, F))   // range: [-π, π]

// Elevation: vertical angle above/below the horizontal plane
elevation = asin(dot(relative, U'))                     // range: [-π/2, π/2]
```

> **Note:** The WebAudio specification handles azimuth/elevation internally when `panningModel: "HRTF"` is set. Application code only needs to supply `position` and `orientation` on both `PannerNode` and `AudioListener`. The formulas above are provided for understanding and for any custom spatialization pipeline.

### 3.3 Listener → Source Relative Orientation

The complete spatial transform combines distance attenuation (section 3.1) with directional cues (section 3.2). The `PannerNode` orientation vector defines **which direction the source is pointing** (its "cone"), though for omni-directional voice (coneInnerAngle = 360°) only the position matters.

### 3.4 Coordinate System Convention

WorkSphere uses a **right-handed Y-up** coordinate system (common in 3D environments):

| Axis | Direction | Notes                              |
| ---- | --------- | ---------------------------------- |
| +X   | Right     | East in world space                |
| +Y   | Up        | Elevation                          |
| +Z   | Forward   | North in world space (into screen) |

```
  Y (up)
  │
  │
  ╱─── Z (forward)
 X (right)

Listener forward: (0, 0, 1)   — looking along +Z
Listener up:      (0, 1, 0)   — head upright
```

---

## 4. WebRTC Media Track → Spatial Node Routing

### 4.1 Per-Peer Connection Lifecycle

Each remote peer that joins a voice session triggers:

1. **WebRTC negotiation** completes (via PartyKit signaling — see `party/server.ts` `webrtc-signal` handler).
2. **`ontrack` fires** on the local `RTCPeerConnection`, providing a `MediaStream` with an audio track.
3. **Spatial node creation**: a `MediaStreamAudioSourceNode` → `GainNode` → `PannerNode` chain is constructed for that stream.
4. **Position assignment**: the peer's current 3D position (from the shared coordinate store) is applied to the `PannerNode`.
5. **On peer disconnect**: the spatial chain is disconnected and garbage-collected.

### 4.2 Code Sample: Connecting a Remote Track

```typescript
import { type PannerNode, type AudioContext } from "web-audio-api-types";

interface PeerSpatialChain {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  panner: PannerNode;
  peerId: string;
}

class SpatialAudioRouter {
  private ctx: AudioContext;
  private chains = new Map<string, PeerSpatialChain>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Called when a remote peer's audio track is received via RTCPeerConnection.ontrack.
   */
  attachRemoteTrack(peerId: string, stream: MediaStream): PeerSpatialChain {
    // Detach existing chain for this peer (renegotiation case)
    this.detachPeer(peerId);

    const source = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;

    const panner = new PannerNode(this.ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: 1.0,
      maxDistance: 50.0,
      rolloffFactor: 1.0,
      position: [0, 2, 0], // default: 2m above origin
      orientation: [0, 0, -1],
      coneInnerAngle: 360,
      coneOuterAngle: 0,
      coneOuterGain: 0,
    });

    // Connect graph: source → gain → panner → destination
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.ctx.destination);

    const chain: PeerSpatialChain = { source, gain, panner, peerId };
    this.chains.set(peerId, chain);

    return chain;
  }

  /**
   * Update a peer's world-space position (called from animation frame / sync).
   */
  updatePeerPosition(peerId: string, x: number, y: number, z: number): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;
    chain.panner.positionX.value = x;
    chain.panner.positionY.value = y;
    chain.panner.positionZ.value = z;
  }

  /**
   * Set per-peer volume (0 = silent, 1 = full).
   */
  setPeerVolume(peerId: string, volume: number): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;
    chain.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
  }

  /**
   * Remove a peer's spatial chain on disconnect.
   */
  detachPeer(peerId: string): void {
    const chain = this.chains.get(peerId);
    if (!chain) {
      return;
    }
    try {
      chain.source.disconnect();
    } catch {}
    try {
      chain.gain.disconnect();
    } catch {}
    try {
      chain.panner.disconnect();
    } catch {}
    this.chains.delete(peerId);
  }

  /**
   * Clean up all spatial chains.
   */
  detachAll(): void {
    for (const peerId of this.chains.keys()) {
      this.detachPeer(peerId);
    }
  }
}
```

### 4.3 WebRTC `ontrack` Integration

```typescript
// Inside RTCPeerConnection setup (see useScreenShare.ts pattern)
const pc = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
});

pc.ontrack = (event: RTCTrackEvent) => {
  const [remoteStream] = event.streams;

  // Route through spatial audio graph
  spatialRouter.attachRemoteTrack(peerId, remoteStream);

  // Also store for potential local UI (e.g., mute indicator)
  remoteStreamsRef.current.set(peerId, remoteStream);
};

// On ICE connection state change:
pc.onconnectionstatechange = () => {
  if (
    pc.connectionState === "disconnected" ||
    pc.connectionState === "failed"
  ) {
    spatialRouter.detachPeer(peerId);
  }
};
```

---

## 5. Listener Coordinate Synchronization

### 5.1 Protocol: PartyKit `spatial_listener_update` Message

Each client broadcasts its listener (head) position and orientation to all other peers at a fixed rate (e.g., 20 Hz via `requestAnimationFrame` throttle). The update is sent through PartyKit as a standard WebSocket message.

```typescript
// ── Message Schema ─────────────────────────────────────────────────────────

interface SpatialListenerUpdate {
  type: "spatial_listener_update";

  /** The authenticated userId from Clerk JWT (enforced server-side) */
  userId: string;

  /** World-space position in Y-up coordinate system */
  position: { x: number; y: number; z: number };

  /** Listener forward unit vector (where the user is looking) */
  forward: { x: number; y: number; z: number };

  /** Listener up unit vector (head orientation) */
  up: { x: number; y: number; z: number };

  /** Monotonic timestamp for interpolation / dead reckoning */
  timestamp: number;
}
```

### 5.2 Sending Listener Updates

```typescript
// Throttled to 20 fps — every 50ms or via requestAnimationFrame stepping
const LISTENER_UPDATE_INTERVAL = 50; // ms

function startListenerBroadcast(
  socket: WebSocket,
  getListenerState: () => {
    position: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  },
  userId: string,
): () => void {
  const timer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;

    const state = getListenerState();
    const message: SpatialListenerUpdate = {
      type: "spatial_listener_update",
      userId,
      position: state.position,
      forward: state.forward,
      up: state.up,
      timestamp: performance.now(),
    };

    socket.send(JSON.stringify(message));
  }, LISTENER_UPDATE_INTERVAL);

  return () => clearInterval(timer);
}
```

### 5.3 Receiving & Applying Listener Updates

On the receiving side, the remote peer's position is applied to the corresponding `PannerNode`. Since WebAudio parameter updates are sample-accurate and can be set at any time, no interpolation queue is strictly necessary for the `PannerNode`, but **dead reckoning** can be used to smooth out jitter:

```typescript
class RemoteListenerInterpolator {
  private history = new Map<string, SpatialListenerUpdate[]>();
  private readonly MAX_HISTORY = 4;

  /** Called on each incoming spatial_listener_update */
  applyUpdate(update: SpatialListenerUpdate, panner: PannerNode): void {
    // Store in ring buffer
    const list = this.history.get(update.userId) ?? [];
    list.push(update);
    if (list.length > this.MAX_HISTORY) list.shift();
    this.history.set(update.userId, list);

    // Direct application (no interpolation — WebAudio handles parameter smoothing)
    panner.positionX.value = update.position.x;
    panner.positionY.value = update.position.y;
    panner.positionZ.value = update.position.z;

    // Orientation of the sound source (set to listener forward for voice)
    panner.orientationX.value = update.forward.x;
    panner.orientationY.value = update.forward.y;
    panner.orientationZ.value = update.forward.z;
  }

  /** Optional: linear interpolation for smoother updates */
  interpolate(
    userId: string,
    atTime: number,
  ): { x: number; y: number; z: number } | null {
    const list = this.history.get(userId);
    if (!list || list.length < 2) return null;

    // Find two bracketing samples
    let before = list[0],
      after = list[list.length - 1];
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].timestamp <= atTime && list[i + 1].timestamp >= atTime) {
        before = list[i];
        after = list[i + 1];
        break;
      }
    }

    const t =
      (atTime - before.timestamp) / (after.timestamp - before.timestamp);
    const clampedT = Math.max(0, Math.min(1, t));

    return {
      x: before.position.x + clampedT * (after.position.x - before.position.x),
      y: before.position.y + clampedT * (after.position.y - before.position.y),
      z: before.position.z + clampedT * (after.position.z - before.position.z),
    };
  }
}
```

### 5.4 PartyKit Server Handling

The existing PartyKit server (`party/server.ts`) already has a generic WebSocket message broadcast pattern. The `spatial_listener_update` messages are **not** Yjs document updates — they are high-frequency ephemeral state that should bypass Yjs and be broadcast directly to all other peers:

```typescript
// In party/server.ts onMessage handler — add this case:
if (parsed.type === "spatial_listener_update") {
  // Validate userId matches authenticated state (anti-spoof)
  if (parsed.userId !== state.userId) return;

  // Broadcast to all other peers (same as webrtc-signal pattern)
  this.room.broadcast(message, [sender.id]);
  return;
}
```

> **Note:** Because these messages are ephemeral (position updates replace previous values), they do not need reliable delivery or ordering guarantees. If a packet is dropped, the next update 50ms later will correct the position.

---

## 6. React Integration: `useSpatialAudio` Hook

The proposed `useSpatialAudio` hook combines WebRTC track routing, PannerNode spatialization, and PartyKit listener sync into a single React primitive.

### 6.1 Hook Signature & Behavior

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import { SpatialAudioRouter } from "@/lib/spatial/SpatialAudioRouter";
import { RemoteListenerInterpolator } from "@/lib/spatial/RemoteListenerInterpolator";

interface PeerSpatialState {
  peerId: string;
  position: { x: number; y: number; z: number };
  volume: number;
  isTalking: boolean;
}

interface UseSpatialAudioOptions {
  roomId: string;
  userId: string;
  /** Local listener position (updated from 3D viewport/game loop) */
  localPosition: { x: number; y: number; z: number };
  /** Local listener forward vector */
  localForward: { x: number; y: number; z: number };
  /** Local listener up vector */
  localUp: { x: number; y: number; z: number };
  /** Map of peer positions keyed by peerId */
  peerPositions: Map<string, { x: number; y: number; z: number }>;
}

export function useSpatialAudio({
  roomId,
  userId,
  localPosition,
  localForward,
  localUp,
  peerPositions,
}: UseSpatialAudioOptions) {
  const [peers, setPeers] = useState<PeerSpatialState[]>([]);
  const [isReady, setIsReady] = useState(false);

  const routerRef = useRef<SpatialAudioRouter | null>(null);
  const interpolatorRef = useRef<RemoteListenerInterpolator | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  // Initialize AudioContext + SpatialAudioRouter (user-gesture gated)
  useEffect(() => {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    ctxRef.current = ctx;
    routerRef.current = new SpatialAudioRouter(ctx);
    interpolatorRef.current = new RemoteListenerInterpolator();
    setIsReady(true);

    return () => {
      routerRef.current?.detachAll();
      ctx.close().catch(() => {});
      setIsReady(false);
    };
  }, []);

  // Sync AudioListener position every frame
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !isReady) return;

    const listener = ctx.listener;
    listener.positionX.value = localPosition.x;
    listener.positionY.value = localPosition.y;
    listener.positionZ.value = localPosition.z;
    listener.forwardX.value = localForward.x;
    listener.forwardY.value = localForward.y;
    listener.forwardZ.value = localForward.z;
    listener.upX.value = localUp.x;
    listener.upY.value = localUp.y;
    listener.upZ.value = localUp.z;
  }, [localPosition, localForward, localUp, isReady]);

  // Update peer PannerNode positions from the position store
  useEffect(() => {
    const router = routerRef.current;
    if (!router || !isReady) return;

    for (const [peerId, pos] of peerPositions) {
      router.updatePeerPosition(peerId, pos.x, pos.y, pos.z);
    }
  }, [peerPositions, isReady]);

  // PartyKit socket for listener coordinate broadcast + receiving peer updates
  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999",
    room: roomId,
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "spatial_listener_update") {
          // Update the spatial chain for the remote peer
          const router = routerRef.current;
          if (router) {
            router.updatePeerPosition(
              data.userId,
              data.position.x,
              data.position.y,
              data.position.z,
            );
          }
        }
      } catch {}
    },
  });

  // Broadcast local listener position at 20 Hz
  useEffect(() => {
    if (!socket || !isReady) return;

    const timer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;

      socket.send(
        JSON.stringify({
          type: "spatial_listener_update",
          userId,
          position: localPosition,
          forward: localForward,
          up: localUp,
          timestamp: performance.now(),
        }),
      );
    }, 50);

    return () => clearInterval(timer);
  }, [socket, userId, localPosition, localForward, localUp, isReady]);

  return {
    peers,
    isReady,
    /** Attach a remote WebRTC MediaStream to the spatial graph */
    attachRemoteTrack: useCallback((peerId: string, stream: MediaStream) => {
      routerRef.current?.attachRemoteTrack(peerId, stream);
    }, []),
    /** Detach a peer on disconnect */
    detachPeer: useCallback((peerId: string) => {
      routerRef.current?.detachPeer(peerId);
    }, []),
    /** Set per-peer volume (mute other users) */
    setPeerVolume: useCallback((peerId: string, volume: number) => {
      routerRef.current?.setPeerVolume(peerId, volume);
    }, []),
  };
}
```

### 6.2 Usage in a Collaborative Workspace

```typescript
// Example: Inside a session component
function WorkspaceSession({ roomId, userId }: { roomId: string; userId: string }) {
  // 3D coordinates come from a shared store (e.g., Zustand, Yjs Map, or game engine)
  const localPos = useStore((s) => s.localPosition);
  const localFwd = useStore((s) => s.localForward);
  const localUp = useStore((s) => s.localUp);
  const peerPositions = useStore((s) => s.peerPositions);

  const {
    attachRemoteTrack,
    detachPeer,
    setPeerVolume,
    isReady,
  } = useSpatialAudio({
    roomId,
    userId,
    localPosition: localPos,
    localForward: localFwd,
    localUp,
    peerPositions,
  });

  // When a new WebRTC peer connects:
  // 1. RTCPeerConnection.ontrack fires
  // 2. Call attachRemoteTrack(peerId, stream)
  // 3. The spatial audio graph activates automatically

  return (
    <div>
      {!isReady && (
        <div className="rounded-lg bg-amber-500/10 p-3 text-xs">
          Click anywhere to enable spatial audio
        </div>
      )}
      {/* Participants list with mute controls */}
      {Array.from(peerPositions.entries()).map(([peerId, pos]) => (
        <div key={peerId}>
          <span>Peer {peerId.slice(0, 6)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={1}
            onChange={(e) => setPeerVolume(peerId, parseFloat(e.target.value))}
          />
          <span className="text-xs">
            ({pos.x.toFixed(1)}, {pos.y.toFixed(1)}, {pos.z.toFixed(1)})
          </span>
        </div>
      ))}
    </div>
  );
}
```

---

## 7. Performance Considerations

### 7.1 HRTF CPU Cost

The `"HRTF"` panning model performs convolution with measured impulse responses for each ear. This is computationally expensive — approximately **5–15 µs per sample per source** depending on the browser and hardware. At 48 kHz sample rate with 8 active sources:

```
Per source: ~8 µs/sample × 48000 samples/sec = 384 µs/source/sec
8 sources:  384 × 8 = 3072 µs ≈ 3 ms of CPU per rendered audio second
```

This is acceptable for most modern CPUs, but budget carefully.

### 7.2 Recommendations

| Strategy                           | Implementation                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Limit active spatial sources**   | Cull peers beyond `maxDistance` (the `PannerNode` already applies a clamp, but consider bypassing the `PannerNode` entirely for distant speakers via a `GainNode` bypass) |
| **Use `"inverse"` distance model** | Avoid `"exponential"` which has non-linear cost in some implementations                                                                                                   |
| **Pool PannerNode instances**      | Create a pool of `N` PannerNodes; recycle when peers come and go, avoiding GC pressure                                                                                    |
| **Batch parameter updates**        | Update all PannerNode positions in a single animation frame batch rather than scattering updates across microtasks                                                        |
| **Throttle listener broadcasts**   | 20 Hz (50ms) is sufficient for conversational audio; higher rates waste bandwidth                                                                                         |
| **Resume AudioContext on gesture** | Always gate `AudioContext` creation/resume on a user click/tap to comply with browser autoplay policies                                                                   |

### 7.3 Culling Strategy

```typescript
const SPATIAL_UPDATE_THRESHOLD_SQ = 30 * 30; // 30m² — beyond this, use minimal gain

function updatePeerPositions(
  spatialRouter: SpatialAudioRouter,
  peerPositions: Map<string, { x: number; y: number; z: number }>,
  localPos: { x: number; y: number; z: number },
) {
  for (const [peerId, pos] of peerPositions) {
    const dx = pos.x - localPos.x;
    const dz = pos.z - localPos.z;
    const distSq = dx * dx + dz * dz;

    if (distSq > SPATIAL_UPDATE_THRESHOLD_SQ) {
      // Peer is far away — reduce to minimal gain (they can still be heard faintly)
      spatialRouter.setPeerVolume(peerId, 0.05);
      spatialRouter.updatePeerPosition(peerId, pos.x, pos.y, pos.z);
    } else {
      // Normal spatialized rendering
      spatialRouter.setPeerVolume(peerId, 1.0);
      spatialRouter.updatePeerPosition(peerId, pos.x, pos.y, pos.z);
    }
  }
}
```

### 7.4 AudioContext Lifecycle

```
┌─────────────────────────────────────────┐
│             User Gesture                 │  ← "Join Voice" button click
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│      new AudioContext()                 │  ← running state
│       ctx.resume() (if suspended)       │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  SpatialAudioRouter.attachRemoteTrack() │  ← per peer
│  AudioListener updates each frame       │
│  Listener broadcast at 20 Hz            │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│         ctx.suspend()                   │  ← on page hide / visibility change
│         ctx.resume()                    │  ← on page show
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│       ctx.close()                       │  ← on unmount / leave room
│       detachAll()                       │
└─────────────────────────────────────────┘
```

```typescript
// Handle browser autoplay / visibility policies
document.addEventListener("visibilitychange", () => {
  const ctx = ctxRef.current;
  if (!ctx) return;

  if (document.hidden) {
    ctx.suspend().catch(() => {});
  } else {
    ctx.resume().catch(() => {});
  }
});
```

---

## 8. References

### Existing WorkSphere Documentation

| Document                                                             | Description                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [WEBRTC_MESH_NETWORKING_GUIDE.md](./WEBRTC_MESH_NETWORKING_GUIDE.md) | WebRTC peer-to-peer signaling, SDP/ICE, PartyKit integration      |
| [NOISE_METER_ARCHITECTURE.md](./NOISE_METER_ARCHITECTURE.md)         | WebAudio AudioContext lifecycle, AnalyserNode FFT, dB calculation |
| [PARTYKIT_ARCHITECTURE.md](./PARTYKIT_ARCHITECTURE.md)               | PartyKit room/server architecture                                 |
| [CRDT_REALTIME_SYNC_PROTOCOL.md](./CRDT_REALTIME_SYNC_PROTOCOL.md)   | Yjs CRDT for shared state (alternative transport)                 |

### Existing Source Files

| File                                          | Relevance                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `party/server.ts`                             | WebRTC signaling handler (`webrtc-signal`), seat check-in, user auth                     |
| `src/hooks/useScreenShare.ts`                 | WebRTC `RTCPeerConnection` lifecycle, `ontrack`, `onicecandidate`                        |
| `src/lib/p2p/p2pManager.ts`                   | Alternative P2P connection manager with DataChannels                                     |
| `src/components/noise/AmbientSoundPlayer.tsx` | WebAudio API graph: `AudioContext`, `GainNode`, `BiquadFilterNode`, pink noise synthesis |
| `src/components/noise/NoiseMeter.tsx`         | `AnalyserNode`, FFT, `getFloatTimeDomainData`, RMS → dB                                  |
| `src/lib/wasm/audioDSPManager.ts`             | `AudioWorkletNode`, WASM SIMD DSP pipeline                                               |
| `src/lib/wasm/audioDSPWorklet.js`             | `AudioWorkletProcessor`, WASM integration, Float32Array alignment                        |

### External Resources

| Resource                     | URL                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| MDN: `PannerNode`            | https://developer.mozilla.org/en-US/docs/Web/API/PannerNode                                    |
| MDN: `AudioListener`         | https://developer.mozilla.org/en-US/docs/Web/API/AudioListener                                 |
| WebAudio Spatialization Spec | https://webaudio.github.io/web-audio-api/#Spatialization                                       |
| HRTF Panning Explanation     | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics |
| WebRTC `RTCPeerConnection`   | https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection                             |

---

---

> **Future Work:** When implementing this architecture, consider measuring spatial audio latency with `AudioContext.baseLatency` and `outputLatency`, adding an optional `"equalpower"` fallback for devices without HRTF support (mobile Safari), and integrating WebXR `XRViewerPose` for automatic listener position/orientation in VR/AR modes.
