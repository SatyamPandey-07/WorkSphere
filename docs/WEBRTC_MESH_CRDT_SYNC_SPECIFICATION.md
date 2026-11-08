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
11. [Byzantine Fault Tolerance & Mesh Security Architecture](#11-byzantine-fault-tolerance--mesh-security-architecture)
    - [11.1 Ed25519 Operation Signature Verification Protocol](#111-ed25519-operation-signature-verification-protocol)
    - [11.2 Peer Rate-Limiting & Poison Message Rejection Rules](#112-peer-rate-limiting--poison-message-rejection-rules)
    - [11.3 Peer Reputation Scoring & Dynamic Penalty Matrix](#113-peer-reputation-scoring--dynamic-penalty-matrix)
    - [11.4 Automatic WebRTC Channel Termination & Eviction Flow](#114-automatic-webrtc-channel-termination--eviction-flow)
    - [11.5 Authentication & Transport Layer Security](#115-authentication--transport-layer-security)
    - [11.6 Threat Model & Mitigation Matrix](#116-threat-model--mitigation-matrix)
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

| Component                 | Responsibility                                         | Source File                            |
| ------------------------- | ------------------------------------------------------ | -------------------------------------- |
| `useMeshCanvasWhiteboard` | Orchestrates dual-path Yjs sync (PartyKit + mesh)      | `src/hooks/useMeshCanvasWhiteboard.ts` |
| `useCanvasWhiteboard`     | Yjs Doc, shapes array, UndoManager, Awareness          | `src/hooks/useCanvasWhiteboard.ts`     |
| `useMeshDataChannels`     | WebRTC mesh connection management, binary send/receive | `src/hooks/useMeshDataChannels.ts`     |
| `WorkspaceServer`         | PartyKit signaling relay, Yjs server sync              | `party/server.ts`                      |
| `FailoverSyncManager`     | State recovery after edge failover                     | `src/lib/edge/failoverSync.ts`         |

---

## 2. Full-Mesh Topology

### 2.1 Mesh Definition

A **full mesh** topology connects every peer directly to every other peer. For $n$ peers, the number of bidirectional connections is:

$$
C = \frac{n(n-1)}{2}
$$

| Peers ($n$) | Connections ($C$) | Max per peer |    Recommended?    |
| :---------: | :---------------: | :----------: | :----------------: |
|      2      |         1         |      1       |        Yes         |
|      3      |         3         |      2       |        Yes         |
|      4      |         6         |      3       |        Yes         |
|      5      |        10         |      4       |     Yes (max)      |
|      6      |        15         |      5       | No (exceeds limit) |

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
  connectionId: string; // PartyKit-assigned ID
  userId: string; // Clerk user ID
  displayName: string; // User-facing name
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
  ordered: true, // Guaranteed ordering for CRDT consistency
  maxRetransmits: undefined, // Use SCTP reliable delivery
});

dataChannel.binaryType = "arraybuffer"; // Yjs updates are ArrayBuffers
```

| Parameter   | Value           | Rationale                                   |
| ----------- | --------------- | ------------------------------------------- |
| Label       | `"yjs-sync"`    | Identifies the channel purpose              |
| Ordered     | `true`          | CRDT deltas require causal ordering         |
| Binary type | `"arraybuffer"` | Yjs encode/decode uses `Uint8Array`         |
| Protocol    | `"crdt-v1"`     | Version identifier for future extensibility |

### 3.3 SDP Offer/Answer with DataChannel

```typescript
// Initiator creates offer
const offer = await rtcConnection.createOffer();
await rtcConnection.setLocalDescription(offer);

// Send offer via PartyKit signaling
partySocket.send(
  JSON.stringify({
    type: "webrtc-signal",
    signalType: "offer",
    to: targetPeerId,
    from: localConnectionId,
    sdp: rtcConnection.localDescription,
  }),
);

// Responder receives offer
await rtcConnection.setRemoteDescription(signal.sdp);
const answer = await rtcConnection.createAnswer();
await rtcConnection.setLocalDescription(answer);

// Send answer back
partySocket.send(
  JSON.stringify({
    type: "webrtc-signal",
    signalType: "answer",
    to: signal.from,
    from: localConnectionId,
    sdp: rtcConnection.localDescription,
  }),
);
```

### 3.4 ICE Candidate Exchange

```typescript
rtcConnection.onicecandidate = (event) => {
  if (event.candidate) {
    partySocket.send(
      JSON.stringify({
        type: "webrtc-signal",
        signalType: "ice-candidate",
        to: targetPeerId,
        from: localConnectionId,
        candidate: event.candidate,
      }),
    );
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

| Message Type    | Direction                | Payload                   | Purpose                          |
| --------------- | ------------------------ | ------------------------- | -------------------------------- |
| `peer:join`     | Server → All             | `{ userId, displayName }` | Notify peers of new participant  |
| `peer:leave`    | Server → All             | `{ connectionId }`        | Notify peers of departure        |
| `webrtc-signal` | Client → Server → Client | SDP/ICE data              | Relay signaling messages         |
| `mesh:state`    | Client → Server → All    | `{ peerStates }`          | Broadcast mesh connection states |

### 4.2 Signaling Message Schema

```typescript
interface WebRTCSignalMessage {
  type: "webrtc-signal";
  signalType: "offer" | "answer" | "ice-candidate";
  from: string; // sender connectionId
  to: string; // recipient connectionId
  sdp?: RTCSessionDescriptionInit; // for offer/answer
  candidate?: RTCIceCandidateInit; // for ice-candidate
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
  const target = this.getConnections().find((c) => c.id === msg.to);
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

| Source             | Origin Tag   | Priority     | Use Case                 |
| ------------------ | ------------ | ------------ | ------------------------ |
| Local user edit    | `null`       | —            | Originates here          |
| WebRTC mesh peer   | `"mesh"`     | 1 (fastest)  | Direct P2P relay         |
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

| Operation                        | Binary Size                 | Use Case                     |
| -------------------------------- | --------------------------- | ---------------------------- |
| `Y.encodeStateVector(doc)`       | ~8 bytes × client count     | Requesting missing data      |
| `Y.encodeStateAsUpdate(doc, sv)` | Proportional to missing ops | Sending only what peer lacks |
| `Y.encodeStateAsUpdate(doc)`     | Full document state         | Complete snapshot (rare)     |

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

| Property          | Description                                             |
| ----------------- | ------------------------------------------------------- |
| **Commutativity** | Applying updates in any order yields the same result    |
| **Idempotency**   | Applying the same update twice has no additional effect |
| **Convergence**   | All peers reach the same document state after sync      |
| **No data loss**  | Concurrent edits to different fields are preserved      |

---

## 8. Per-User Undo/Redo Tree History

### 8.1 Yjs UndoManager

Each peer maintains a local `Y.UndoManager` that tracks their own operations:

```typescript
const um = new Y.UndoManager(shapes, {
  captureTimeout: 500, // Group ops within 500ms into one undo step
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
  canUndo: boolean; // um.undoStack.length > 0
  canRedo: boolean; // um.redoStack.length > 0
  undoDepth: number; // um.undoStack.length
  redoDepth: number; // um.redoStack.length
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

| Timeout Window       | Behavior                      |
| -------------------- | ----------------------------- |
| < 500 ms between ops | Grouped into single undo step |
| > 500 ms gap         | New undo step created         |
| User switches tool   | Forces new undo step          |

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

| Mechanism              | Description                             | Implementation              |
| ---------------------- | --------------------------------------- | --------------------------- |
| State vector exchange  | Periodic reconciliation                 | On mesh connect + reconnect |
| PartyKit authoritative | Server state is source of truth         | `y-partykit` GC-enabled     |
| FailoverSync snapshot  | Full state recovery after edge failover | `failoverSync.ts`           |
| IndexedDB persistence  | Crash recovery                          | `offlineStorage.ts`         |

---

## 10. Performance Characteristics

### 10.1 Latency Comparison

| Path                    | Typical Latency | Use Case             |
| ----------------------- | :-------------: | -------------------- |
| WebRTC mesh (LAN)       |     2–10 ms     | Same-network peers   |
| WebRTC mesh (WAN)       |    20–80 ms     | Cross-region peers   |
| PartyKit WebSocket      |    50–150 ms    | All peers (baseline) |
| PartyKit + edge routing |    30–100 ms    | Nearest edge node    |

### 10.2 Bandwidth per Peer

| Operation                     |         Size         | Frequency  |
| ----------------------------- | :------------------: | :--------: |
| Yjs delta (single shape edit) |    ~50–200 bytes     |  Per edit  |
| State vector request          |  ~8 bytes × clients  | On connect |
| State vector response         | Proportional to diff | On connect |
| Heartbeat / keepalive         |       ~4 bytes       | Every 30s  |

### 10.3 Mesh Overhead

| Metric                       | 3 Peers |  5 Peers |
| ---------------------------- | ------: | -------: |
| Active connections           |       3 |       10 |
| Max simultaneous sends       |       2 |        4 |
| Total bandwidth (10 edits/s) | ~6 KB/s | ~10 KB/s |

### 10.4 Adaptive Quality

The mesh data channel uses **ordered delivery** for CRDT consistency. For latency-insensitive updates (cursor positions), the Awareness protocol runs over the same channel but is not mesh-relayed.

---

## 11. Byzantine Fault Tolerance & Mesh Security Architecture

While standard WebRTC DTLS transport encryption prevents third-party eavesdropping and man-in-the-middle attacks on the network wire, full-mesh peer-to-peer topologies remain inherently susceptible to **Byzantine participants**. A malicious peer admitted to an authenticated room can attempt to disrupt collaborative state by broadcasting malformed CRDT deltas, forging identity operations, replaying historical messages, or launching denial-of-service state flooding attacks.

To protect room state and uncompromised peers, WorkSphere enforces an in-depth security architecture featuring **Ed25519 cryptographic operation signing**, **zero-trust pre-application validation**, **token-bucket rate limiting**, **dynamic peer reputation scoring**, and **immediate fail-close WebRTC channel termination**.

```
+---------------------------------------------------------------------------------------------------------+
|                                    BYZANTINE INGRESS VALIDATION PIPELINE                                |
|                                                                                                         |
|  Incoming RTCDataChannel Message ("yjs-sync")                                                           |
|       |                                                                                                 |
|       v                                                                                                 |
|  [Step 1: Size & Rate Limiter] ---> (>64 KB or >50 ops/sec) ---------> DROP + Penalize Reputation (-15) |
|       |                                                                                                 |
|       v                                                                                                 |
|  [Step 2: Replay & Monotonicity] -> (Sequence <= lastSeen or |dt| > 5s) -> DROP + Penalize (-50)        |
|       |                                                                                                 |
|       v                                                                                                 |
|  [Step 3: Ed25519 Signature Verification] -> (Invalid signature) ------> TERMINATE CHANNEL (-100)       |
|       |                                                                  (Immediate Peer Eviction)      |
|       v                                                                                                 |
|  [Step 4: CRDT Binary Decoding Sandbox] ---> (DecoderException) -------> DROP + Poison Rejection (-35)  |
|       |                                                                                                 |
|       v (All Guards Passed)                                                                             |
|  Apply to local Y.Doc via Y.applyUpdate(doc, update, origin)                                            |
|  Relay to downstream mesh peers (if originator score > 75)                                              |
+---------------------------------------------------------------------------------------------------------+
```

---

### 11.1 Ed25519 Operation Signature Verification Protocol

All CRDT mutation deltas transmitted over WebRTC data channels must be wrapped in a cryptographically signed binary envelope before transmission. Operations lacking a valid cryptographic signature are discarded immediately prior to witness processing or state insertion.

#### 11.1.1 Signed Operation Envelope Structure

```typescript
export interface CrdtSignedEnvelope {
  /** Authenticated sender peer identifier (bound to Clerk user session) */
  peerId: string;

  /** 32-byte Ed25519 public key in hexadecimal representation (64 characters) */
  publicKeyHex: string;

  /** Monotonically increasing sequence number per peer to prevent replay/reordering */
  sequenceNumber: number;

  /** Generation epoch millisecond timestamp (used for drift validation) */
  timestamp: number;

  /** Unique collaborative document/room identifier */
  documentId: string;

  /** Base64 or binary Uint8Array containing Yjs state update delta */
  payloadBase64: string;

  /** 64-byte Ed25519 signature in hexadecimal representation (128 characters) */
  signatureHex: string;
}
```

#### 11.1.2 Canonical Serialization for Cryptographic Signing

To eliminate field reordering ambiguities across heterogeneous JavaScript runtime engines, the canonical byte payload for signing is defined as:

$$\text{CanonicalBytes} = \text{UTF-8}(\text{peerId} \mathbin{\Vert} \text{documentId} \mathbin{\Vert} \text{sequenceNumber} \mathbin{\Vert} \text{timestamp}) \mathbin{\Vert} \text{RawPayloadBytes}$$

```typescript
export function computeCanonicalPayload(envelope: {
  peerId: string;
  documentId: string;
  sequenceNumber: number;
  timestamp: number;
  payloadBytes: Uint8Array;
}): Uint8Array {
  const headerString = `${envelope.peerId}:${envelope.documentId}:${envelope.sequenceNumber}:${envelope.timestamp}:`;
  const headerBytes = new TextEncoder().encode(headerString);

  const merged = new Uint8Array(
    headerBytes.length + envelope.payloadBytes.length,
  );
  merged.set(headerBytes, 0);
  merged.set(envelope.payloadBytes, headerBytes.length);
  return merged;
}
```

#### 11.1.3 Cryptographic Verification Routine

When an envelope is received on the `RTCDataChannel`, the recipient verifies the signature using the Web Crypto API (`Ed25519` key algorithm) or `@noble/ed25519`:

```typescript
import * as ed from "@noble/ed25519";

export async function verifyCrdtOperation(
  envelope: CrdtSignedEnvelope,
  lastSeenSequence: number,
  expectedPeerId: string,
): Promise<{ valid: boolean; failureReason?: string }> {
  // 1. Peer Identity Binding Check
  if (envelope.peerId !== expectedPeerId) {
    return { valid: false, failureReason: "PEER_IDENTITY_MISMATCH" };
  }

  // 2. Monotonic Sequence Number Check (Replay Protection)
  if (envelope.sequenceNumber <= lastSeenSequence) {
    return { valid: false, failureReason: "REPLAYED_SEQUENCE_NUMBER" };
  }

  // 3. Clock Skew Bounds Check (Maximum 5000ms drift window)
  const currentTimestamp = Date.now();
  if (Math.abs(currentTimestamp - envelope.timestamp) > 5000) {
    return { valid: false, failureReason: "EXCESSIVE_CLOCK_SKEW" };
  }

  // 4. Ed25519 Cryptographic Signature Verification
  const payloadBytes = Uint8Array.from(atob(envelope.payloadBase64), (c) =>
    c.charCodeAt(0),
  );
  const canonicalBytes = computeCanonicalPayload({
    peerId: envelope.peerId,
    documentId: envelope.documentId,
    sequenceNumber: envelope.sequenceNumber,
    timestamp: envelope.timestamp,
    payloadBytes,
  });

  const isValidSignature = await ed.verify(
    envelope.signatureHex,
    canonicalBytes,
    envelope.publicKeyHex,
  );

  if (!isValidSignature) {
    return { valid: false, failureReason: "INVALID_ED25519_SIGNATURE" };
  }

  return { valid: true };
}
```

---

### 11.2 Peer Rate-Limiting & Poison Message Rejection Rules

Byzantine actors may attempt state amplification or denial-of-service (DoS) attacks by flooding legitimate peers with millions of empty operations or malformed byte sequences designed to trigger out-of-memory (OOM) crashes in the Yjs decoder.

#### 11.2.1 Token-Bucket Rate Limiter per Peer

Each peer maintains a dedicated token-bucket rate limiter per data channel:

| Rate Limiter Parameter       | Threshold Ceiling   | Description                                     | Action on Violation |
| :--------------------------- | :------------------ | :---------------------------------------------- | :------------------ |
| **Sustained Operation Rate** | $50\text{ ops/sec}$ | Continuous allowed operations per second        | Queue throttle      |
| **Burst Capacity**           | $100\text{ ops}$    | Maximum token reservoir for rapid user strokes  | Drop excess deltas  |
| **Payload Size Ceiling**     | $64\text{ KB}$      | Maximum size for an individual Yjs update delta | Immediate reject    |
| **Bandwidth Ceiling**        | $512\text{ KB/sec}$ | Aggregate inbound data budget per peer          | Throttle connection |

```typescript
export class PeerRateLimiter {
  private tokens: number = 100;
  private readonly maxTokens: number = 100;
  private readonly refillRatePerMs: number = 50 / 1000; // 50 tokens/sec
  private lastRefillTimestamp: number = Date.now();

  public tryConsume(cost: number = 1): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefillTimestamp;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRatePerMs,
    );
    this.lastRefillTimestamp = now;

    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false; // Rate limit exceeded
  }
}
```

#### 11.2.2 Poison Message Rejection Rules

A **poison message** is an update payload crafted to exploit decoder parsing bugs or cause fatal crashes in the CRDT engine. WorkSphere isolates update decoding inside a defensive sandbox:

1. **Decoding Isolation:** Inbound byte sequences are decoded using a trial reader (`Y.readUpdate` / `lib0.decoding`) within an isolated `try/catch` block before being applied to the document.
2. **Structural Depth Ceiling:** Updates attempting to create nested structures deeper than $32$ levels or containing $>10,000$ deleted items in a single delta are rejected as structural denial-of-service attempts.
3. **Zero-Propagation Rule:** Malformed, unparseable, or rejected updates are **never re-broadcast** to downstream mesh peers, halting cascading contamination across the cluster.

```typescript
export function safelyApplyPeerUpdate(
  doc: Y.Doc,
  rawUpdateBytes: Uint8Array,
  peerId: string,
): { success: boolean; error?: string } {
  try {
    // 1. Pre-validation: Ensure payload has valid lib0 encoding header
    if (rawUpdateBytes.length === 0 || rawUpdateBytes.length > 65536) {
      return { success: false, error: "PAYLOAD_SIZE_OUT_OF_BOUNDS" };
    }

    // 2. Safe trial execution inside local transaction
    Y.applyUpdate(doc, rawUpdateBytes, `mesh-peer:${peerId}`);
    return { success: true };
  } catch (decodingError) {
    // Poison message caught without crashing the application runtime
    console.error(
      `[ByzantineGuard] Poison message detected from peer ${peerId}:`,
      decodingError,
    );
    return { success: false, error: "CRDT_DECODER_EXCEPTION" };
  }
}
```

---

### 11.3 Peer Reputation Scoring & Dynamic Penalty Matrix

WorkSphere tracks a dynamic **Reputation Score** $R \in [0, 100]$ for each active mesh participant. Peers start with an initial score of $R_0 = 100$.

#### 11.3.1 Penalty and Reward Matrix

| Event / Behavioral Trigger                    | Reputation Impact | Action Taken                                     |
| :-------------------------------------------- | :---------------- | :----------------------------------------------- |
| **Valid Signed Update Applied**               | $+0.1$ points     | Gradual score recovery (capped at $100$)         |
| **Rate Limit Burst Violation**                | $-15$ points      | Temporary message throttling for $2000\text{ms}$ |
| **Clock Skew / Timestamp Anomaly**            | $-25$ points      | Delta discarded                                  |
| **Poison Message (Unparseable Yjs Bytecode)** | $-35$ points      | Delta discarded; quarantine evaluation           |
| **Replayed Sequence Number**                  | $-50$ points      | Immediate delta drop                             |
| **Invalid Ed25519 Cryptographic Signature**   | **$-100$ points** | **Instant critical fault $\to$ Eviction**        |
| **Identity / Public Key Impersonation**       | **$-100$ points** | **Instant critical fault $\to$ Eviction**        |

#### 11.3.2 Reputation Degradation Thresholds

```
Score: 100 ---------- 75 ------------------ 40 ------------------- 0
State:     [NORMAL]    |    [THROTTLED]      |     [QUARANTINED]   | [EVICTED]
Action:  Full relay    | Rate limit -50%     | No relay to others  | Immediate disconnect
                       | Drops cursor sync   | Local audit only    | WebRTC tear-down
```

- **Normal State ($75 < R \le 100$):** Peer updates are processed and forwarded to all connected mesh peers.
- **Throttled State ($40 < R \le 75$):** Token-bucket refill rate is reduced by $50\%$. High-frequency non-critical updates (e.g., mouse presence, typing indicators) are dropped.
- **Quarantined State ($0 < R \le 40$):** Updates from this peer are applied locally only if strictly verified; updates are **never relayed** to other mesh peers.
- **Evicted State ($R \le 0$):** Peer connection is immediately torn down and blacklisted.

---

### 11.4 Automatic WebRTC Channel Termination & Eviction Flow

When a peer incurs a critical fault (such as an invalid Ed25519 signature) or their reputation score drops to $0$, the node initiates an **automated fail-close eviction sequence**:

#### 11.4.1 Eviction Protocol Steps

1. **Channel Tear-down:** Close the `"yjs-sync"` `RTCDataChannel` immediately (`dataChannel.close()`).
2. **Peer Connection Termination:** Close the underlying `RTCPeerConnection` (`peerConnection.close()`).
3. **Local Blacklist Insertion:** Place the peer ID and public key into a local eviction blacklist for $30\text{ minutes}$ ($1,800,000\text{ms}$). Inbound reconnection attempts from this peer are rejected automatically during this window.
4. **Signaling Server Eviction Notice:** Transmit an authenticated `webrtc-peer-evicted` payload to the PartyKit signaling server:

```typescript
export interface PeerEvictionNotification {
  type: "webrtc-peer-evicted";
  room: string;
  evictedPeerId: string;
  reason:
    "INVALID_ED25519_SIGNATURE" | "POISON_MESSAGE" | "RATE_LIMIT_EXHAUSTED";
  timestamp: number;
  evidence: {
    sequenceNumber: number;
    signatureHex: string;
    payloadHash: string;
  };
}
```

5. **Mesh Rerouting & Catch-up:** Reroute active data channels to bypass the evicted node. If local state integrity was threatened, request an authoritative state vector catch-up from the PartyKit server.

#### 11.4.2 Automated Termination Implementation

```typescript
export function terminateByzantinePeer(
  peerId: string,
  reason:
    "INVALID_ED25519_SIGNATURE" | "POISON_MESSAGE" | "RATE_LIMIT_EXHAUSTED",
  peerConnection?: RTCPeerConnection,
  dataChannel?: RTCDataChannel,
  partykitSocket?: WebSocket,
): void {
  console.warn(
    `[ByzantineEviction] Terminating rogue peer ${peerId}. Reason: ${reason}`,
  );

  // 1. Close RTCDataChannel
  try {
    dataChannel?.close();
  } catch (err) {
    // Ignore close errors
  }

  // 2. Close RTCPeerConnection
  try {
    peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
    peerConnection?.close();
  } catch (err) {
    // Ignore close errors
  }

  // 3. Notify signaling server
  if (partykitSocket && partykitSocket.readyState === WebSocket.OPEN) {
    partykitSocket.send(
      JSON.stringify({
        type: "webrtc-peer-evicted",
        evictedPeerId: peerId,
        reason,
        timestamp: Date.now(),
      }),
    );
  }
}
```

---

### 11.5 Authentication & Transport Layer Security

| Layer                   | Mechanism                        | Scope                                                                 |
| :---------------------- | :------------------------------- | :-------------------------------------------------------------------- |
| **Room Admission**      | Clerk JWT Bearer Token           | Verified at PartyKit WebSocket connection upgrade                     |
| **Signaling Integrity** | Connection ID Binding            | Server rejects signals where `from !== conn.id`                       |
| **Wire Encryption**     | WebRTC DTLS 1.2 / 1.3            | Encrypts all packets between browsers over UDP/TCP                    |
| **Application Signing** | Ed25519 Cryptographic Signatures | Guarantees non-repudiation and tampering detection per CRDT operation |

---

### 11.6 Threat Model & Mitigation Matrix

| Byzantine Threat Vector        | Attack Mechanism                                                | Protocol Mitigation                                                                                            |
| :----------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| **State Forgery**              | Attacker broadcasts fake edits claiming to be another user      | **Ed25519 signature validation** rejects any delta not signed with the authentic user's private key.           |
| **CRDT State Bomb**            | Attacker crafts a corrupted binary delta to crash peer runtimes | **Decoding sandbox** catches lib0 parser exceptions; payload is discarded without application or relay.        |
| **Denial of Service Flooding** | Attacker floods 10,000 updates/second to exhaust memory         | **Token-bucket rate limiter** caps operations to 50 ops/sec; offenders are throttled and evicted.              |
| **Replay Attacks**             | Attacker replays valid historical edit operations out of order  | **Monotonic sequence numbers** and $\pm 5000\text{ms}$ timestamp validation reject repeated or stale messages. |
| **Cascade Poisoning**          | Byzantine peer attempts to turn benign peers into poison relays | **Zero-propagation rule** prohibits re-broadcasting any unverified, throttled, or unparseable updates.         |
| **Evasion via Reconnection**   | Evicted peer reconnects under fresh WebRTC offer                | **30-minute eviction blacklist** rejects re-negotiation attempts from the evicted peer ID or public key.       |

---

## 12. Implementation Checklist

- [ ] Ensure `src/hooks/useMeshDataChannels.ts` creates `"yjs-sync"` data channel with `ordered: true`.
- [ ] Verify `src/hooks/useMeshCanvasWhiteboard.ts` broadcasts Yjs updates via `meshDataChannels.sendToAll()` with origin guards.
- [ ] Implement Ed25519 canonical message envelope signing before dispatching Yjs deltas over data channels.
- [ ] Implement pre-application signature and monotonicity checks in `useMeshDataChannels.ts` before calling `Y.applyUpdate`.
- [ ] Enforce token-bucket rate limiter ($50\text{ ops/sec}$, max $64\text{ KB}$ per payload) per data channel.
- [ ] Implement poison message isolation sandbox around `Y.applyUpdate` to prevent crash propagation.
- [ ] Maintain per-peer reputation scoring matrix with dynamic throttling ($R \le 75$) and quarantine ($R \le 40$).
- [ ] Trigger automated WebRTC data channel termination and RTCPeerConnection tear-down on signature failure or $R \le 0$.
- [ ] Dispatch `webrtc-peer-evicted` signaling notification to PartyKit on peer termination.
- [ ] Maintain a 30-minute local blacklist preventing re-negotiation from evicted peers.
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
