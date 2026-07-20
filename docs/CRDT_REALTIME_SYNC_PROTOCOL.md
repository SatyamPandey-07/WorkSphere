# CRDT Real-Time Sync Protocol

WorkSphere uses **Yjs** (a CRDT library) over **PartyKit** WebSockets for multiplayer document sync, with a separate SSE channel for venue updates and an IndexedDB-backed offline delta queue for resilience.

---

## Table of Contents

- [Overview](#overview)
- [Yjs Document Structures](#yjs-document-structures)
- [Yjs Delta Format](#yjs-delta-format)
- [State Vector Resolution](#state-vector-resolution)
- [PartyKit WebSocket Synchronization](#partykit-websocket-synchronization)
- [Offline Delta Queue Merging](#offline-delta-queue-merging)
- [Presence & Awareness Protocols](#presence--awareness-protocols)
- [SSE Channel (Venue Updates)](#sse-channel-venue-updates)
- [Transport Layer Summary](#transport-layer-summary)

---

## Overview

| Concern                 | Mechanism                   | Location                                                       |
| ----------------------- | --------------------------- | -------------------------------------------------------------- |
| Shared document state   | Yjs CRDT over `y-partykit`  | `party/server.ts`, `useRealTime.tsx`, `useCanvasWhiteboard.ts` |
| Cursor / presence       | Yjs Awareness protocol      | `useCanvasWhiteboard.ts`                                       |
| Seat occupancy          | JSON messages over PartyKit | `useSeatAvailability.ts`, `party/server.ts`                    |
| Venue ratings / reviews | Server-Sent Events (SSE)    | `useRealTime.tsx`                                              |
| Offline action queue    | IndexedDB + Web Worker      | `offlineStore.ts`, `sync.worker.ts`                            |

---

## Yjs Document Structures

### Folder / Collection Document (`folder-{id}` room)

Initialized in `useMultiplayerSession` (`src/hooks/useRealTime.tsx`):

```ts
const doc = new Y.Doc();
const provider = new YProvider("127.0.0.1:1999", roomId, doc, {
  params: token ? { token } : {},
});
```

The folder document is a general shared doc. Clients observe it for `type: "refresh"` signals broadcast over the same room to trigger a data refetch.

### Canvas Whiteboard Document (`canvas-{id}` room)

Initialized in `useCanvasWhiteboard` (`src/hooks/useCanvasWhiteboard.ts`):

```ts
const doc = new Y.Doc();
// Shared array of shape maps
const shapes = doc.getArray<Y.Map<unknown>>("shapes");
```

Each shape is a `Y.Map` with these keys:

| Key       | Type                                                | Description             |
| --------- | --------------------------------------------------- | ----------------------- |
| `id`      | `string`                                            | Unique shape identifier |
| `type`    | `"pen" \| "eraser" \| "rect" \| "circle" \| "line"` | Drawing tool            |
| `points`  | `number[]`                                          | Coordinate array        |
| `color`   | `string`                                            | Hex color               |
| `width`   | `number`                                            | Stroke width            |
| `opacity` | `number`                                            | 0–1 opacity             |
| `userId`  | `string`                                            | Author's user ID        |

Adding a shape:

```ts
const map = new Y.Map<unknown>();
map.set("id", data.id);
map.set("points", data.points.slice()); // copy to avoid shared reference
shapes.push([map]);
```

Updating a shape mutates the existing `Y.Map` in-place — Yjs records this as a delta, not a full replacement.

### UndoManager

```ts
const um = new Y.UndoManager(shapes, { captureTimeout: 500 });
```

- Groups operations within 500 ms into a single undo step.
- `um.undoStack` / `um.redoStack` sizes drive the `canUndo` / `canRedo` UI flags.
- `undo()` / `redo()` apply inverse deltas locally; Yjs propagates the reversal to peers automatically.

---

## Yjs Delta Format

Yjs encodes updates as **binary incremental deltas** (not full snapshots). The `y-partykit` integration handles encoding/decoding transparently.

### What a delta contains

A Yjs update binary encodes:

- **Client ID** — unique integer per `Y.Doc` instance, used in the state vector.
- **Clock** — monotonically increasing counter per client.
- **Operations** — inserts, deletes, or attribute changes on shared types (`Y.Array`, `Y.Map`, etc.).

### How `y-partykit` exchanges deltas

1. On `onConnect`, `y-partykit` sends the server's current document state to the new client.
2. The client responds with its own state vector so the server can compute the diff.
3. Only the missing operations are sent — not the full document.
4. Subsequent edits are broadcast as binary `ArrayBuffer` messages to all peers in the room.

The server in `party/server.ts` delegates all of this to `y-partykit`:

```ts
onConnectYjs(conn, this.room, {
  gc: true, // garbage-collect deleted items
  readOnly: isViewer, // drop incoming updates from VIEWER connections
});
```

JSON messages (presence, seat check-ins) share the same WebSocket but are handled separately — Yjs only processes `ArrayBuffer` payloads.

---

## State Vector Resolution

A **state vector** maps each client ID to its highest known clock value:

```
{ clientId_A: 42, clientId_B: 17, clientId_C: 5 }
```

### Sync handshake

```
Client                          Server (y-partykit)
  |                                    |
  |--- WebSocket connect ------------->|
  |<-- current doc state (binary) ----|  (encodes server's full state vector)
  |--- client state vector (binary) ->|  (what the client already has)
  |<-- missing delta (binary) --------|  (ops client hasn't seen)
  |--- client's own delta (binary) -->|  (ops server hasn't seen)
  |          [synced]                 |
```

After the handshake, every local edit produces a delta that is:

1. Applied to the local `Y.Doc` immediately (optimistic).
2. Sent to the server as a binary WebSocket message.
3. Broadcast by the server to all other connections in the room.
4. Applied by each peer — Yjs merges commutatively, so order doesn't matter.

### Conflict resolution

Yjs CRDTs are **operation-based** and **commutative**. Concurrent edits to the same position are resolved deterministically by client ID (higher ID wins for same-position inserts). This means:

- No "last write wins" data loss.
- No manual conflict resolution needed.
- Peers that receive operations out of order still converge to the same state.

---

## PartyKit WebSocket Synchronization

### Connection lifecycle

```
Client connects
  └─> onConnect(conn, ctx)
        ├─ Verify Clerk JWT from ?token query param
        ├─ Fetch role from /api/partykit/auth
        ├─ conn.setState({ role: "EDITOR" | "VIEWER" })
        ├─ Send seat_snapshot if room has active check-ins
        └─ onConnectYjs(conn, room, { gc: true, readOnly: isViewer })

Client disconnects
  └─> onClose(conn)
        └─ handleSeatCheckout(conn)  — clears occupancy count
```

### Message routing in `onMessage`

```
Incoming message
  ├─ type: "typing"        → broadcast to room (all roles)
  ├─ type: "seat_checkin"  → handleSeatCheckin (all roles)
  ├─ type: "seat_checkout" → handleSeatCheckout (all roles)
  ├─ role === "VIEWER"     → DROP (no further broadcast)
  ├─ type: "presence"      → broadcast excluding sender (handled in onConnect listener)
  ├─ type: "cursor"        → broadcast excluding sender
  └─ other JSON / binary   → broadcast to room (EDITOR only)
```

### Room naming convention

| Pattern             | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `folder-{folderId}` | Yjs document + presence for a shared collection |
| `canvas-{canvasId}` | Yjs document for whiteboard shapes              |
| `seat-availability` | Seat check-in presence (no Yjs)                 |

### Seat availability messages

Client → server:

```ts
{ type: "seat_checkin", venueId: string, capacity?: number }
{ type: "seat_checkout" }
```

Server → all clients:

```ts
// After any check-in or checkout
{ type: "seat_update", venueId: string, count: number, capacity: number, status: "green" | "yellow" | "red" }

// Sent once to a newly connected client if the room has active check-ins
{ type: "seat_snapshot", venues: Array<{ venueId, count, capacity, status }> }
```

Status thresholds (mirrored in `useSeatAvailability.ts`):

| Status   | Condition                      |
| -------- | ------------------------------ |
| `green`  | `count / capacity < 0.6`       |
| `yellow` | `0.6 ≤ count / capacity < 1.0` |
| `red`    | `count / capacity ≥ 1.0`       |

Default capacity when not provided by client: **8** (defined in both `party/server.ts` and `useSeatAvailability.ts`).

---

## Offline Delta Queue Merging

When a user is offline, actions are queued in **IndexedDB** and replayed when connectivity is restored.

### Seat check-in offline path (`useSeatAvailability.ts`)

```
navigator.onLine === false
  └─> queueOfflineCheckIn(venueId)   — writes to IndexedDB

window "online" event fires
  └─> getQueuedCheckIns()
        └─> for each item:
              POST /api/sync { checkIns: [item] }
              ├─ success → dequeueOfflineCheckIn(item.id)
              │            socket.send({ type: "seat_checkin", ... })
              └─ failure → incrementCheckInRetryCount(item.id)
```

### Favorites offline path (`sync.worker.ts`)

The sync Web Worker runs in the background and processes a favorites outbox queue:

```
WAKE_UP message received
  └─> processOutbox()
        └─> navigator.locks.request("sync-favorites-queue")  — prevents multi-tab races
              └─> for each queued action:
                    ├─ Check circuit breaker state
                    ├─ Apply exponential backoff if retryCount > 0
                    │    delay = min(60s, 1s × 2^attempt) + jitter(0–1s)
                    ├─ POST /api/favorites { venueId, action }
                    ├─ success → dequeueOfflineAction, recordSuccess()
                    └─ failure → recordFailure(), incrementRetryCount()
                                 if attempts ≥ MAX_SYNC_RETRIES → permanent failure, dequeue
```

### Circuit breaker states

```
CLOSED ──(3 failures)──> OPEN ──(30s timeout)──> HALF_OPEN ──(success)──> CLOSED
                                                              └─(failure)──> OPEN
```

| State       | Behavior                                                    |
| ----------- | ----------------------------------------------------------- |
| `CLOSED`    | Normal — all requests pass through                          |
| `OPEN`      | Blocked — no requests sent until timeout expires            |
| `HALF_OPEN` | One probe request allowed; success closes, failure re-opens |

### Yjs offline behavior

Yjs itself buffers unsynced operations in the `Y.Doc` in memory. When the `YProvider` reconnects, it performs the state vector handshake and sends any locally accumulated deltas. No additional application-level queuing is needed for document edits — only for non-Yjs actions (favorites, seat check-ins) that go through REST APIs.

---

## Presence & Awareness Protocols

### Yjs Awareness (canvas whiteboard)

`y-partykit` includes a built-in **Awareness** protocol that propagates ephemeral per-client state (cursors, user info) separately from the document CRDT.

Local state is set in `useCanvasWhiteboard.ts`:

```ts
awareness.setLocalState({
  x: 0, // cursor X
  y: 0, // cursor Y
  name: userName,
  color: userColor,
});
```

Cursor updates on mouse move:

```ts
// updateCursor called on canvas mousemove
aw.setLocalState({ ...currentState, x, y });
```

Receiving remote cursors:

```ts
awareness.on("change", () => {
  const states = Array.from(awareness.getStates().entries());
  const cursors = states
    .filter(([clientId]) => clientId !== awareness.clientID)
    .map(([clientId, state]) => ({
      userId: `user-${clientId}`,
      x: state.x,
      y: state.y,
      name: state.name,
      color: state.color,
    }));
  setRemoteCursors(cursors);
});
```

Awareness state is **not** part of the CRDT document — it is ephemeral and lost on disconnect. It does not go through the offline queue.

### JSON presence (folder rooms)

For folder rooms, lightweight presence uses plain JSON over the same PartyKit socket:

```ts
// In onConnect message listener (party/server.ts)
if (data.type === "presence" || data.type === "cursor") {
  this.room.broadcast(event.data, [conn.id]); // exclude sender
}
```

Clients send and receive `{ type: "presence", ... }` or `{ type: "cursor", ... }` objects. The schema is application-defined — the server only routes them.

### Typing indicators

```ts
{ type: "typing", userId: string, isTyping: boolean }
```

Broadcast to all connections including VIEWERs. Not persisted.

### Seat presence

Seat check-ins are a form of presence tied to a physical venue rather than a document. They are stored in the server's in-memory `Map<connectionId, SeatCheckin>` and cleared on `onClose`. See [Seat availability messages](#seat-availability-messages) above.

---

## SSE Channel (Venue Updates)

For venue ratings and availability updates that don't require bidirectional sync, WorkSphere uses **Server-Sent Events** (`useRealTimeUpdates` in `src/hooks/useRealTime.tsx`).

### Event format

```ts
interface VenueUpdate {
  type: "rating" | "availability" | "new_review";
  venueId: string;
  data: Record<string, unknown>;
  timestamp: number;
}
```

### Connection management

- Endpoint: `GET /api/venues/updates?venueId=...&venueId=...`
- Reconnect: exponential backoff starting at 1 s, doubling up to 30 s.
- Pauses automatically when `navigator.onLine === false`.
- Resumes on `window "online"` event or tab visibility change.
- Keeps last 50 updates in state (`prev.slice(-49)`).

SSE is one-way (server → client) and does not use Yjs or CRDT merging. It is appropriate for broadcast-only data where the client never writes back through the same channel.

---

## Transport Layer Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT                                   │
│                                                                 │
│  useCanvasWhiteboard ──┐                                        │
│  useMultiplayerSession ┼──> YProvider (y-partykit)             │
│                        │      binary Yjs deltas (ArrayBuffer)  │
│                        │                                        │
│  useSeatAvailability ──┼──> usePartySocket (partysocket/react) │
│  folder presence       │      JSON messages                    │
│                        │                                        │
│  useRealTimeUpdates ───┼──> EventSource (SSE)                  │
│                        │      JSON events (read-only)          │
│                        │                                        │
│  sync.worker.ts ───────┴──> fetch() REST calls                 │
│  useSeatAvailability          (offline queue replay)           │
└─────────────────────────────────────────────────────────────────┘
                         │
              WebSocket (:1999) + HTTP (:3000)
                         │
┌─────────────────────────────────────────────────────────────────┐
│                    PARTYKIT SERVER                              │
│                                                                 │
│  WorkspaceServer.onConnect                                      │
│    ├─ Clerk JWT verification                                    │
│    ├─ Role assignment (EDITOR / VIEWER)                         │
│    ├─ onConnectYjs → y-partykit handles Yjs binary traffic      │
│    └─ JSON listener → presence / seat routing                  │
│                                                                 │
│  WorkspaceServer.onMessage                                      │
│    ├─ typing / presence / cursor → broadcast                   │
│    ├─ seat_checkin / seat_checkout → in-memory Map update       │
│    └─ VIEWER gate → drop non-presence JSON                     │
│                                                                 │
│  WorkspaceServer.onClose                                        │
│    └─ seat checkout → broadcast seat_update                    │
└─────────────────────────────────────────────────────────────────┘
```

### Related files

```
party/server.ts                          PartyKit server (Yjs + seat presence)
partykit.json                            PartyKit config
src/hooks/useRealTime.tsx                useMultiplayerSession (YProvider + socket)
src/hooks/useCanvasWhiteboard.ts         Yjs shapes doc + awareness
src/hooks/useSeatAvailability.ts         Seat check-in client + offline queue
src/workers/sync.worker.ts              Favorites offline sync worker
src/lib/offlineStore.ts                  IndexedDB queue helpers
src/app/api/partykit/auth/route.ts       Role lookup for PartyKit auth
src/app/api/venues/updates/route.ts      SSE endpoint for venue updates
```
