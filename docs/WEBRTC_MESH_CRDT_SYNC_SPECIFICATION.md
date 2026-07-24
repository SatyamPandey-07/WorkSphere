# WebRTC Mesh DataChannel Signaling & CRDT State Synchronization Specification

This specification documents WorkSphere's **full-mesh WebRTC RTCDataChannel** negotiation, **PartyKit signaling** relay, **Yjs CRDT state synchronization** over peer-to-peer data channels, and **per-user undo/redo tree history** for the collaborative whiteboard. It complements the [CRDT Real-Time Sync Protocol](./CRDT_REALTIME_SYNC_PROTOCOL.md) and the [WebRTC Mesh Networking Guide](./WEBRTC_MESH_NETWORKING_GUIDE.md) by focusing specifically on the data channel mesh layer that enables direct peer-to-peer Yjs delta relay.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Full-Mesh Topology](#2-full-mesh-topology)
3. [WebRTC DataChannel Negotiation](#3-webrtc-datachannel-negotiation)
4. [PartyKit Signaling Protocol](#4-partykit-signaling-protocol)
5. [Yjs CRDT State Synchronization](#5-yjs-crdt-state-synchronization)
6. [State Vector Exchange Protocol](#6-state-vector-exchange-protocol)
7. [Conflict Resolution](#7-conflict-resolution)
8. [Per-User Undo/Redo Tree History](#8-per-user-undoredo-tree-history)
9. [Failure Modes & Recovery](#9-failure-modes--recovery)
10. [Performance Characteristics](#10-performance-characteristics)
11. [Security Considerations](#11-security-considerations)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Overview & Architecture

### Purpose

WorkSphere's collaborative whiteboard uses a **dual-path synchronization architecture**:

1. **PartyKit WebSocket** (centralized) — serves as the authoritative Yjs sync channel and signaling relay.
2. **WebRTC RTCDataChannel mesh** (decentralized) — provides direct peer-to-peer Yjs delta relay to reduce latency and server load.

When the WebRTC mesh is active, Yjs updates are simultaneously sent to the PartyKit server (for persistence and late-joining peers) and broadcast directly to all connected mesh peers (for sub-100ms latency).

### Architecture Layers

```text
+-------------------------------------------------------------------+
|                    Application Layer                              |
|  CanvasWhiteboard.tsx  ←  useMeshCanvasWhiteboard.ts              |
+-------------------------------------------------------------------+
         |                                    |
         v                                    v
+-------------------+            +------------------------+
| Yjs CRDT Engine   |            | UndoManager            |
| Y.Doc + shapes    |            | (per-user history)     |
+-------------------+            +------------------------+
         |                                    |
         +----------------+-------------------+
                          |
              +-----------+-----------+
              |                       |
              v                       v
+-------------------+   +---------------------------+
| PartyKit WebSocket|   | WebRTC RTCDataChannel     |
| (y-partykit)     |   | Mesh ("yjs-sync")         |
+-------------------+   +---------------------------+
         |                       |
         v                       v
+-------------------+   +---------------------------+
| PartyKit Server   |   | Peer A ←→ Peer B ←→ Peer C|
| (persistence,     |   | (direct binary relay)     |
|  late-join sync)  |   |                           |
+-------------------+   +---------------------------+
```

### Component Responsibilities

| Component | Responsibility | Source File |
|-----------|---------------|-------------|
| `useMeshCanvasWhiteboard` | Orchestrates dual-path Yjs sync (PartyKit + mesh) | `src/hooks/useMeshCanvasWhiteboard.ts` |
| `useCanvasWhiteboard` | Yjs Doc, shapes array, UndoManager, Awareness | `src/hooks/useCanvasWhiteboard.ts` |
| `useMeshDataChannels` | WebRTC mesh connection management, binary send/receive | `src/hooks/useMeshDataChannels.ts` |
| `WorkspaceServer` | PartyKit signaling relay, Yjs server sync | `party/server.ts` |
| `FailoverSyncManager` | State recovery after edge failover | `src/lib/edge/failoverSync.ts` |

---

## 2. Full-Mesh Topology

### 2.1 Mesh Definition

A **full mesh** topology connects every peer directly to every other peer. For $n$ peers, the number of bidirectional connections is:

$$
C = \frac{n(n-1)}{2}
$$

| Peers ($n$) | Connections ($C$) | Max per peer | Recommended? |
|:-----------:|:-----------------:|:------------:|:------------:|
| 2 | 1 | 1 | Yes |
| 3 | 3 | 2 | Yes |
| 4 | 6 | 3 | Yes |
| 5 | 10 | 4 | Yes (max) |
| 6 | 15 | 5 | No (exceeds limit) |

> **WorkSphere enforces a maximum of 5 peers** per mesh session.

### 2.2 Mesh Topology Diagrams

#### 2-Peer Mesh (1 connection)

```text
  Peer A ←——————————→ Peer B
```

#### 3-Peer Mesh (3 connections)

```text
        Peer A
       /      \
      /        \
Peer B ←——→ Peer C
```

#### 4-Peer Mesh (6 connections)

```text
    Peer A ←——→ Peer B
      |    \  /    |
      |     \/     |
      |     /\     |
    Peer C ←——→ Peer D
```

#### 5-Peer Mesh (10 connections)

```text
        Peer A
       / |  | \
      /  |  |  \
Peer B ←——|——|——→ Peer E
      \  |  |  /
       \ |  | /
    Peer C ←→ Peer D
```

### 2.3 Peer Identification

Each peer is identified by a `connectionId` assigned by PartyKit on WebSocket connect. The WebRTC mesh uses this ID as the peer identifier for signaling and data channel labeling.

```typescript
interface MeshPeer {
  connectionId: string;   // PartyKit-assigned ID
  userId: string;         // Clerk user ID
  displayName: string;    // User-facing name
  rtcConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  state: "connecting" | "connected" | "disconnected";
}
```

---

## 3. WebRTC DataChannel Negotiation

### 3.1 Connection Setup Flow

When a new peer joins the whiteboard room, the mesh initiator (lowest `connectionId`) establishes connections to all existing peers:

```text
New Peer D joins
      |
      v
PartyKit broadcasts "peer:join" to all
      |
      v
Existing peers A, B, C each create offer for D
      |
      v
D creates answer for each offer
      |
      v
ICE candidates exchanged via PartyKit
      |
      v
4 data channels established (D↔A, D↔B, D↔C)
```

### 3.2 RTCDataChannel Configuration

```typescript
const dataChannel = rtcConnection.createDataChannel("yjs-sync", {
  ordered: true,           // Guaranteed ordering for CRDT consistency
  maxRetransmits: undefined, // Use SCTP reliable delivery
});

dataChannel.binaryType = "arraybuffer"; // Yjs updates are ArrayBuffers
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Label | `"yjs-sync"` | Identifies the channel purpose |
| Ordered | `true` | CRDT deltas require causal ordering |
| Binary type | `"arraybuffer"` | Yjs encode/decode uses `Uint8Array` |
| Protocol | `"crdt-v1"` | Version identifier for future extensibility |

### 3.3 SDP Offer/Answer with DataChannel

```typescript
// Initiator creates offer
const offer = await rtcConnection.createOffer();
await rtcConnection.setLocalDescription(offer);

// Send offer via PartyKit signaling
partySocket.send(JSON.stringify({
  type: "webrtc-signal",
  signalType: "offer",
  to: targetPeerId,
  from: localConnectionId,
  sdp: rtcConnection.localDescription,
}));

// Responder receives offer
await rtcConnection.setRemoteDescription(signal.sdp);
const answer = await rtcConnection.createAnswer();
await rtcConnection.setLocalDescription(answer);

// Send answer back
partySocket.send(JSON.stringify({
  type: "webrtc-signal",
  signalType: "answer",
  to: signal.from,
  from: localConnectionId,
  sdp: rtcConnection.localDescription,
}));
```

### 3.4 ICE Candidate Exchange

```typescript
rtcConnection.onicecandidate = (event) => {
  if (event.candidate) {
    partySocket.send(JSON.stringify({
      type: "webrtc-signal",
      signalType: "ice-candidate",
      to: targetPeerId,
      from: localConnectionId,
      candidate: event.candidate,
    }));
  }
};

// Receiving peer
if (signal.signalType === "ice-candidate") {
  await rtcConnection.addIceCandidate(signal.candidate);
}
```

### 3.5 DataChannel Event Handlers

```typescript
dataChannel.onopen = () => {
  console.log(`Mesh channel open with ${peerId}`);
  updatePeerState(peerId, "connected");
};

dataChannel.onclose = () => {
  updatePeerState(peerId, "disconnected");
  scheduleReconnection(peerId);
};

dataChannel.onmessage = (event) => {
  const data = new Uint8Array(event.data);
  // Apply Yjs update from mesh peer
  Y.applyUpdate(doc, data, "mesh"); // origin "mesh" prevents echo
};
```

---

## 4. PartyKit Signaling Protocol

### 4.1 Message Types

PartyKit relays WebRTC signaling messages between peers. The server does not inspect or modify SDP/ICE payloads.

| Message Type | Direction | Payload | Purpose |
|-------------|-----------|---------|---------|
| `peer:join` | Server → All | `{ userId, displayName }` | Notify peers of new participant |
| `peer:leave` | Server → All | `{ connectionId }` | Notify peers of departure |
| `webrtc-signal` | Client → Server → Client | SDP/ICE data | Relay signaling messages |
| `mesh:state` | Client → Server → All | `{ peerStates }` | Broadcast mesh connection states |

### 4.2 Signaling Message Schema

```typescript
interface WebRTCSignalMessage {
  type: "webrtc-signal";
  signalType: "offer" | "answer" | "ice-candidate";
  from: string;    // sender connectionId
  to: string;      // recipient connectionId
  sdp?: RTCSessionDescriptionInit;   // for offer/answer
  candidate?: RTCIceCandidateInit;   // for ice-candidate
}
```

### 4.3 PartyKit Server Forwarding

The PartyKit server forwards `webrtc-signal` messages to the target peer:

```typescript
// party/server.ts — message handler
if (msg.type === "webrtc-signal") {
  // Verify sender identity
  if (msg.from !== conn.id) {
    console.warn("Signal from mismatched connectionId");
    return;
  }

  // Forward to target peer
  const target = this.getConnections().find(
    (c) => c.id === msg.to
  );
  if (target) {
    target.send(JSON.stringify(msg));
  }
}
```

### 4.4 ICE Server Configuration

```typescript
const iceServers: RTCIceServer[] = [
  {
    urls: "stun:stun.l.google.com:19302",
  },
  // TURN server added for restrictive NAT environments
  // {
  //   urls: "turn:turn.worksphere.com:3478",
  //   username: "...",
  //   credential: "...",
  // },
];
```

---

## 5. Yjs CRDT State Synchronization

### 5.1 Dual-Path Sync Architecture

When a user draws on the whiteboard, the Yjs update is sent through **both** paths simultaneously:

```text
Local Yjs edit
      |
      +----------> PartyKit WebSocket (y-partykit)
      |                    |
      |                    v
      |            Server applies to authoritative doc
      |                    |
      |                    v
      |            Broadcast to all WebSocket peers
      |
      +----------> WebRTC DataChannel mesh
                         |
                         v
                   Direct to all mesh-connected peers
```

### 5.2 Mesh Yjs Delta Relay

The `useMeshCanvasWhiteboard` hook intercepts Yjs document updates and broadcasts them over the mesh:

```typescript
// src/hooks/useMeshCanvasWhiteboard.ts

// Listen for local Yjs changes
doc.on("update", (update: Uint8Array, origin: unknown) => {
  // Don't echo updates received from mesh
  if (origin === "mesh") return;

  // Don't echo updates received from PartyKit
  if (origin === "partykit") return;

  // Send to all connected mesh peers
  meshDataChannels.sendToAll(update.buffer);
});
```

### 5.3 Incoming Mesh Update Application

When a mesh peer receives a Yjs delta, it applies it to its local document:

```typescript
meshDataChannels.onMessage((peerId: string, data: ArrayBuffer) => {
  const update = new Uint8Array(data);

  // Apply with origin "mesh" to prevent re-broadcast
  Y.applyUpdate(doc, update, "mesh");
});
```

### 5.4 Sync Precedence

| Source | Origin Tag | Priority | Use Case |
|--------|-----------|----------|----------|
| Local user edit | `null` | — | Originates here |
| WebRTC mesh peer | `"mesh"` | 1 (fastest) | Direct P2P relay |
| PartyKit WebSocket | `"partykit"` | 2 (fallback) | Server-synced, late-join |

Updates from `"mesh"` or `"partykit"` origin are **never re-broadcast** to prevent infinite echo loops.

---

## 6. State Vector Exchange Protocol

### 6.1 Yjs State Vector

A Yjs **state vector** maps each client ID to its latest clock value. It represents the "known state" of a document from a peer's perspective.

$$
SV = \{ (c_1, l_1), (c_2, l_2), \ldots, (c_n, l_n) \}
$$

Where $c_i$ is a client ID and $l_i$ is the latest clock value for that client.

### 6.2 State Vector Format

```typescript
// Yjs state vector is a Map<number, number>
// Client ID -> Latest clock
const stateVector = Y.encodeStateVector(doc);
// Returns Uint8Array (binary encoded)
```

### 6.3 Mesh State Vector Exchange

When a new peer connects to the mesh, the existing peers exchange state vectors to compute the diff:

```text
Peer D joins mesh
      |
      v
D sends stateVector_D to Peer A via mesh
      |
      v
A computes diff = stateVector_A - stateVector_D
      |
      v
A sends missing updates (Y.encodeStateAsUpdate(doc, stateVector_D))
      |
      v
D applies updates → D is now in sync with A
```

### 6.4 Initial Sync on Mesh Connect

```typescript
// When mesh channel opens with a new peer
dataChannel.onopen = () => {
  // Send our state vector to the new peer
  const stateVector = Y.encodeStateVector(doc);
  dataChannel.send(stateVector);
};

dataChannel.onmessage = (event) => {
  const data = new Uint8Array(event.data);

  // Check if this is a state vector request
  if (isStateVector(data)) {
    // Compute diff and send missing updates
    const missingUpdates = Y.encodeStateAsUpdate(doc, data);
    dataChannel.send(missingUpdates);
  } else {
    // Apply as Yjs update
    Y.applyUpdate(doc, data, "mesh");
  }
};
```

### 6.5 State Vector vs. Full Update

| Operation | Binary Size | Use Case |
|-----------|-------------|----------|
| `Y.encodeStateVector(doc)` | ~8 bytes × client count | Requesting missing data |
| `Y.encodeStateAsUpdate(doc, sv)` | Proportional to missing ops | Sending only what peer lacks |
| `Y.encodeStateAsUpdate(doc)` | Full document state | Complete snapshot (rare) |

> **Optimization:** The mesh only sends the diff, not the full document. This keeps bandwidth proportional to the number of new operations, not document size.

---

## 7. Conflict Resolution

### 7.1 Yjs Conflict Resolution Model

Yjs uses **operation-based conflict resolution** — all operations are commutative and idempotent, meaning the order of application does not affect the final state.

### 7.2 Insert Ordering

When two users insert at the same position simultaneously, Yjs resolves using **client ID comparison**:

$$
\text{If } \text{clock}_A = \text{clock}_B \text{ and same position, then } \text{clientID}_A > \text{clientID}_B \implies A \text{ wins}
$$

### 7.3 Conflict Example — Simultaneous Shape Insert

```text
Peer A (clientID=1) inserts Shape X at index 3
Peer B (clientID=2) inserts Shape Y at index 3

After synchronization:
  shapes = [..., Shape_A, Shape_Y, Shape_X, ...]
                       ^         ^
                       |         |
                  B wins (higher clientID)
```

### 7.4 Conflict Example — Concurrent Map Updates

Two users modify the same shape's properties concurrently:

```text
Peer A sets shape.color = "red"
Peer B sets shape.width = 5

Result: shape = { color: "red", width: 5 }
Both changes preserved (different keys)
```

```text
Peer A sets shape.color = "red"
Peer B sets shape.color = "blue"

Result: shape.color = "blue" (last-writer-wins for same key)
Both peers converge to the same value because Yjs
deterministically resolves by client ID ordering.
```

### 7.5 Conflict Resolution Guarantees

| Property | Description |
|----------|-------------|
| **Commutativity** | Applying updates in any order yields the same result |
| **Idempotency** | Applying the same update twice has no additional effect |
| **Convergence** | All peers reach the same document state after sync |
| **No data loss** | Concurrent edits to different fields are preserved |

---

## 8. Per-User Undo/Redo Tree History

### 8.1 Yjs UndoManager

Each peer maintains a local `Y.UndoManager` that tracks their own operations:

```typescript
const um = new Y.UndoManager(shapes, {
  captureTimeout: 500,  // Group ops within 500ms into one undo step
});
```

### 8.2 Undo/Redo Mechanics

```text
User draws Shape A (3 ops within 500ms)
      |
      v
UndoManager captures: [op1, op2, op3] → undoStack entry
      |
      v
User draws Shape B (2 ops)
      |
      v
UndoManager captures: [op4, op5] → undoStack entry
      |
      v
undoStack: [ [op1,op2,op3], [op4,op5] ]
redoStack: []
```

### 8.3 Undo Operation

```text
User presses Undo
      |
      v
UndoManager pops [op4, op5] from undoStack
      |
      v
Applies inverse operations locally
      |
      v
Inverse ops pushed to redoStack
      |
      v
Yjs propagates inverse to all peers (PartyKit + mesh)
      |
      v
All peers see Shape B removed
```

### 8.4 Redo Operation

```text
User presses Redo
      |
      v
UndoManager pops [op4, op5] from redoStack
      |
      v
Re-applies original operations locally
      |
      v
Original ops pushed back to undoStack
      |
      v
Yjs propagates to all peers
```

### 8.5 UndoStack / RedoStack State

```typescript
interface UndoManagerState {
  canUndo: boolean;          // um.undoStack.length > 0
  canRedo: boolean;          // um.redoStack.length > 0
  undoDepth: number;         // um.undoStack.length
  redoDepth: number;         // um.redoStack.length
}
```

### 8.6 Per-User Isolation

Each user's UndoManager only tracks their own operations. Peer operations are applied directly without going through the local UndoManager.

```typescript
// src/hooks/useCanvasWhiteboard.ts
doc.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin !== um) {
    // This update came from a peer — don't add to local undo stack
    // The UndoManager ignores it because it wasn't triggered by um
  }
});
```

### 8.7 Capture Timeout Behavior

| Timeout Window | Behavior |
|---------------|----------|
| < 500 ms between ops | Grouped into single undo step |
| > 500 ms gap | New undo step created |
| User switches tool | Forces new undo step |

---

## 9. Failure Modes & Recovery

### 9.1 Mesh Peer Disconnection

```text
Peer B disconnects from mesh
      |
      v
DataChannel "onclose" fires
      |
      v
Peer A, C, D continue with PartyKit fallback
      |
      v
Peer B reconnects (auto-reconnect or manual)
      |
      v
New mesh channel established with B
      |
      v
State vector exchange → catch-up sync
```

### 9.2 PartyKit Failover

When the PartyKit edge node fails over:

```text
FailoverSyncManager detects disconnection
      |
      v
State machine: idle → connecting → syncing_snapshot → synced
      |
      v
Request full document snapshot from new edge
      |
      v
Buffer any local edits during snapshot fetch (3s timeout)
      |
      v
Apply snapshot + replay buffered deltas
      |
      v
Resume normal mesh + PartyKit sync
```

### 9.3 Complete Network Failure

```text
All connections lost (PartyKit + mesh)
      |
      v
Yjs buffers unsynced ops in memory
      |
      v
IndexedDB stores CRDT state for offline persistence
      |
      v
On reconnection: full state vector exchange + catch-up
```

### 9.4 State Drift Prevention

| Mechanism | Description | Implementation |
|-----------|-------------|----------------|
| State vector exchange | Periodic reconciliation | On mesh connect + reconnect |
| PartyKit authoritative | Server state is source of truth | `y-partykit` GC-enabled |
| FailoverSync snapshot | Full state recovery after edge failover | `failoverSync.ts` |
| IndexedDB persistence | Crash recovery | `offlineStorage.ts` |

---

## 10. Performance Characteristics

### 10.1 Latency Comparison

| Path | Typical Latency | Use Case |
|------|:---------------:|----------|
| WebRTC mesh (LAN) | 2–10 ms | Same-network peers |
| WebRTC mesh (WAN) | 20–80 ms | Cross-region peers |
| PartyKit WebSocket | 50–150 ms | All peers (baseline) |
| PartyKit + edge routing | 30–100 ms | Nearest edge node |

### 10.2 Bandwidth per Peer

| Operation | Size | Frequency |
|-----------|:----:|:---------:|
| Yjs delta (single shape edit) | ~50–200 bytes | Per edit |
| State vector request | ~8 bytes × clients | On connect |
| State vector response | Proportional to diff | On connect |
| Heartbeat / keepalive | ~4 bytes | Every 30s |

### 10.3 Mesh Overhead

| Metric | 3 Peers | 5 Peers |
|--------|--------:|--------:|
| Active connections | 3 | 10 |
| Max simultaneous sends | 2 | 4 |
| Total bandwidth (10 edits/s) | ~6 KB/s | ~10 KB/s |

### 10.4 Adaptive Quality

The mesh data channel uses **ordered delivery** for CRDT consistency. For latency-insensitive updates (cursor positions), the Awareness protocol runs over the same channel but is not mesh-relayed.

---

## 11. Security Considerations

### 11.1 Authentication

| Layer | Mechanism |
|-------|-----------|
| PartyKit room access | Clerk JWT token in query params |
| WebRTC signaling | Forwarded through authenticated PartyKit connection |
| Data channel content | No additional encryption (relies on DTLS) |

### 11.2 Data Channel Security

WebRTC data channels are encrypted by default via **DTLS** (Datagram Transport Layer Security). All mesh traffic is encrypted in transit without application-level encryption.

### 11.3 Signaling Integrity

PartyKit verifies the `from` field of `webrtc-signal` messages matches the authenticated `connectionId`:

```typescript
if (msg.from !== conn.id) {
  // Reject: sender impersonation attempt
  return;
}
```

### 11.4 Threat Model

| Threat | Mitigation |
|--------|------------|
| Unauthorized room access | Clerk JWT required for PartyKit connection |
| Signaling message tampering | DTLS encryption on data channels |
| Peer impersonation | `from` field validated against `conn.id` |
| Mesh replay attack | Yjs state vectors prevent replay; ops are idempotent |

---

## 12. Implementation Checklist

- [ ] Ensure `src/hooks/useMeshDataChannels.ts` creates `"yjs-sync"` data channel with `ordered: true`.
- [ ] Verify `src/hooks/useMeshCanvasWhiteboard.ts` broadcasts Yjs updates via `meshDataChannels.sendToAll()` with origin guards.
- [ ] Confirm PartyKit `party/server.ts` forwards `webrtc-signal` messages with `from` validation.
- [ ] Validate state vector exchange on mesh channel open for initial sync.
- [ ] Ensure `Y.UndoManager` capture timeout is 500ms and undo/redo propagates to all peers.
- [ ] Test mesh reconnection with state vector catch-up after peer disconnect.
- [ ] Verify `FailoverSyncManager` handles PartyKit edge failover during active mesh session.
- [ ] Confirm maximum 5-peer limit is enforced in `useMeshDataChannels.ts`.
- [ ] Test offline editing with IndexedDB persistence and reconnection sync.
- [ ] Verify DTLS encryption is active on all data channels (WebRTC default).
- [ ] Update `TODO.md` to mark completed implementation items.

---

## References

- [Yjs Documentation — State Vectors](https://docs.yjs.dev/)
- [WebRTC Data Channel Specification — W3C](https://www.w3.org/TR/webrtc/#rtcdatachannel)
- [CRDT Real-Time Sync Protocol](./CRDT_REALTIME_SYNC_PROTOCOL.md)
- [WebRTC Mesh Networking Guide](./WEBRTC_MESH_NETWORKING_GUIDE.md)
- [PartyKit Architecture](./PARTYKIT_ARCHITECTURE.md)
- [PartyKit Reconnection Resiliency Protocol](./PARTYKIT_RECONNECTION_RESILIENCY_PROTOCOL.md)
- [WebRTC P2P File Sharing Protocol](./WEBRTC_P2P_FILE_SHARING_PROTOCOL.md)
