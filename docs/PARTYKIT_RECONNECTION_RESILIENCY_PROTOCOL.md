# PartyKit Reconnection & Resiliency Protocol

## Purpose

This document defines the architectural specification, connection lifecycle, state machine, reconnection behavior, offline queueing mechanisms, and state re-synchronization protocols for the real-time multiplayer and presence infrastructure in WorkSphere.

WorkSphere utilizes **PartyKit** (`partykit` / `partysocket` / `y-partykit`) alongside native Web APIs (WebSockets, IndexedDB, Web Locks API, Server-Sent Events) to deliver real-time collaboration across workspace folders, interactive map seat availability, collaborative whiteboards, WebRTC signaling, and multi-region edge node routing.

---

## Architecture Overview

WorkSphere's real-time architecture consists of three main tiers:

1. **PartyKit Server Layer** (`party/server.ts` & `party/multiRegionServer.ts`):
   - **`WorkspaceServer`**: Core PartyKit room handler running on Cloudflare Workers edge nodes. Coordinates Yjs CRDT document synchronization, real-time presence (cursor/typing), WebRTC signaling, room snapshot generation, and seat check-in state tracking.
   - **`MultiRegionWorkspaceServer`**: Extended edge server providing IP/header-based geolocation routing (`geoRouter.ts`), sub-30ms presence updates, and cross-region durable state synchronization (`stateSync.ts`).

2. **Client React Hooks & State Layer** (`src/hooks/` & `src/components/`):
   - **`useSeatAvailability`**: Manages real-time seat check-in/checkout presence over the dedicated `seat-availability` PartyKit room with offline queue fallback.
   - **`useCanvasWhiteboard`**: Manages collaborative whiteboard drawing state backed by `y-partykit/provider` (`YProvider`), Yjs Y.Doc, Y.UndoManager, and edge failover state synchronization (`FailoverSyncManager`).
   - **`useMultiRegion`**: Connects to multi-region PartyKit nodes and performs continuous RTT latency ping/pong monitoring.
   - **`useScreenShare`**: Utilizes PartyKit WebSocket rooms as a signaling transport for WebRTC P2P mesh screen sharing.
   - **`useRealTimeUpdates`**: Handles server-side rating and venue availability stream using Server-Sent Events (SSE) with application-managed exponential backoff.
   - **`PartyKitPresenceWrapper`**: React hydration guard preventing Next.js 16 App Router streaming SSR mismatches.

3. **Offline Storage & Resiliency Layer** (`src/lib/offlineStore.ts` & `src/lib/offlineStorage.ts`):
   - Persistent IndexedDB outboxes (`checkins-outbox`, `favorites-outbox`, `pendingActions`) for queueing mutations executed while offline.
   - Multi-tab transaction serialization via the **Web Locks API** (`navigator.locks.request`) to prevent IndexedDB transaction deadlocks.

```mermaid
graph TD
    Client[Browser Client React App] -->|Next.js 16 SSR Isolation| Wrapper[PartyKitPresenceWrapper]
    Wrapper -->|usePartySocket / YProvider| PKSocket[PartySocket WebSocket]
    Wrapper -->|EventSource| SSEStream[SSE /api/venues/updates]

    PKSocket -->|WSS Protocol| EdgeServer[PartyKit Edge Server]
    EdgeServer -->|verifyToken| ClerkAuth[Clerk Auth / @clerk/backend]
    EdgeServer -->|GET /api/partykit/auth| RoleAPI[Next.js Internal Auth API]
    EdgeServer -->|onConnectYjs| YjsCRDT[Yjs Shared Doc Engine]

    Client -->|Offline Mutations| IDBOutbox[(IndexedDB Outbox)]
    IDBOutbox -->|Web Locks Serialization| WebLock[navigator.locks]
    IDBOutbox -->|Online Event / SW Sync| SyncEngine[Queue Flush Engine]
    SyncEngine -->|HTTP POST /api/sync| BackendAPI[Next.js API Routes]
    SyncEngine -->|socket.send seat_checkin| PKSocket
```

---

## Connection Lifecycle

The WebSocket lifecycle in WorkSphere spans initialization, token verification, open handshake, message processing, close handling, and cleanup:

| Stage                | Responsible Component / Function         | Location                                                                         | Description                                                                                                                                                                    |
| :------------------- | :--------------------------------------- | :------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Initialization**   | `usePartySocket` / `YProvider`           | `src/hooks/useSeatAvailability.ts`<br>`src/hooks/useCanvasWhiteboard.ts`         | Configures host (`process.env.NEXT_PUBLIC_PARTYKIT_HOST`), room ID, and query parameters (`?token=...`). Uses `startClosed` flag during SSR.                                   |
| **SSR Isolation**    | `PartyKitPresenceWrapper`                | `src/components/chat/PartyKitPresenceWrapper.tsx`                                | Defers socket initialization until client-side hydration (`isMounted = true`) completes, isolating Next.js 16 SSR streaming.                                                   |
| **Authentication**   | `verifyToken` & `GET /api/partykit/auth` | `party/server.ts` (lines 33-85)<br>`src/app/api/partykit/auth/route.ts`          | Server extracts Clerk JWT token from URL params, verifies signature, queries internal Next.js auth endpoint for role (`OWNER`, `MEMBER`, `VIEWER`), and sets connection state. |
| **Connection Open**  | `onConnect` / `onOpen`                   | `party/server.ts` (lines 33-113)<br>`src/hooks/useSeatAvailability.ts` (line 80) | Server broadcasts current seat snapshot (`seat_snapshot`) and presence state. Client updates `isConnected` state to `true`.                                                    |
| **Message Exchange** | `onMessage` / `conn.addEventListener`    | `party/server.ts` (lines 115-180)<br>`src/hooks/useCanvasWhiteboard.ts`          | Exchanges JSON control frames (`seat_checkin`, `presence`, `cursor`, `webrtc-signal`, `request_room_snapshot`) and Yjs binary CRDT updates.                                    |
| **Connection Close** | `onClose`                                | `party/server.ts` (lines 184-186)<br>`src/hooks/useMultiRegion.ts` (line 48)     | Server executes `handleSeatCheckout(conn)` to automatically release seat reservations for disconnected clients.                                                                |
| **Reconnection**     | `partysocket` / `FailoverSyncManager`    | `src/lib/edge/failoverSync.ts`<br>`src/hooks/useCanvasWhiteboard.ts`             | Client auto-reconnects via `partysocket`. `FailoverSyncManager` requests full room snapshot and buffers post-reconnect deltas.                                                 |
| **Cleanup**          | Unmount cleanup in `useEffect`           | `src/hooks/useSeatAvailability.ts` (lines 207-217)                               | Disconnects provider/socket, closes peer connections, clears interval timers, and sends best-effort `seat_checkout` frame.                                                     |

---

## Connection State Machine

The client connection transitions through distinct states managed by `partysocket` and `FailoverSyncManager` (`src/lib/edge/failoverSync.ts`):

```mermaid
stateDiagram-v2
    [*] --> Idle: Initial Component Render
    Idle --> Connecting: Client Hydrated / startClosed=false
    Connecting --> Synced: WebSocket Opened & Initial Snapshot Received
    Synced --> Connecting: Network Disconnected / Server Failover
    Connecting --> SyncingSnapshot: WebSocket Re-established (Failover)
    SyncingSnapshot --> Synced: Snapshot Received & Deltas Replayed
    SyncingSnapshot --> Error: Snapshot Timeout (3000ms)
    Error --> Synced: Buffer Drained Fallback
    Synced --> Idle: Component Unmounted / socket.close()
```

### Verified Connection States

- **`idle`**: Unmounted state prior to DOM hydration.
- **`connecting`**: Socket initialization or underlying TCP/TLS socket opening.
- **`synced`** (`connected`): Socket is open, authentication succeeded, and client state is fully synchronized.
- **`syncing_snapshot`**: Reconnected after drop/failover; client has requested a full room state snapshot and is buffering incoming deltas.
- **`error`**: Snapshot request timed out (default 3000ms), triggering fallback delta buffer draining.

---

## Authentication Flow

WorkSphere enforces role-based access control (RBAC) over PartyKit connections using Clerk JWTs and internal Next.js database role lookups:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client App
    participant PK as PartyKit Server (party/server.ts)
    participant Clerk as Clerk Auth (@clerk/backend)
    participant AuthAPI as Next.js Auth API (/api/partykit/auth)
    participant DB as Prisma Database

    Client->>Client: Fetch JWT via useAuth().getToken()
    Client->>PK: WSS Connect ?token=<clerk_jwt>
    alt Token Present
        PK->>Clerk: verifyToken(token, { secretKey })
        alt Valid JWT
            Clerk-->>PK: Verified payload (sub = userId)
            alt Room is "canvas-*"
                PK->>PK: Set conn.state = { role: "EDITOR", userId }
            else Room is "folder-{id}"
                PK->>AuthAPI: GET /api/partykit/auth?userId=...&folderId=...
                AuthAPI->>DB: Query folderMember / folder.ownerId
                DB-->>AuthAPI: Return member role
                AuthAPI-->>PK: JSON { role: "OWNER" | "MEMBER" | "VIEWER" }
                PK->>PK: Set conn.state = { role, userId }
            end
        else Invalid JWT
            PK->>PK: Set conn.state = { role: "VIEWER", userId: undefined }
        end
    else No Token
        PK->>PK: Set conn.state = { role: "VIEWER", userId: undefined }
    end
    PK->>PK: Initialize onConnectYjs(conn, room, { readOnly: isViewer })
    PK-->>Client: WebSocket Open + Initial State Snapshot
```

### Server Role Enforcement

- **VIEWER Role Restrictions**:
  - `onConnectYjs` is initialized with `{ readOnly: true }` for VIEWERS, instructing `y-partykit` to drop all incoming CRDT mutations from the client.
  - In `onMessage` (`party/server.ts` line 167), non-presence/non-signaling broadcasts from `VIEWER` connections are explicitly dropped.

---

## Message Flow

```mermaid
sequenceDiagram
    autonumber
    actor ClientA as Client A (Editor)
    participant PK as PartyKit Room Server
    actor ClientB as Client B (Viewer)

    Note over ClientA,PK: 1. Presence & Seat Check-in
    ClientA->>PK: JSON { type: "seat_checkin", venueId: "v123", capacity: 8 }
    PK->>PK: Update seatCheckins Map<connId, SeatCheckin>
    PK-->>ClientA: JSON { type: "seat_update", venueId: "v123", count: 1, status: "green" }
    PK-->>ClientB: JSON { type: "seat_update", venueId: "v123", count: 1, status: "green" }

    Note over ClientA,PK: 2. Cursor / Presence Broadcast
    ClientA->>PK: JSON { type: "cursor", x: 120, y: 340 }
    PK->>ClientB: Broadcast (skips sender) { type: "cursor", x: 120, y: 340 }

    Note over ClientA,PK: 3. Document Edit (Yjs Binary)
    ClientA->>PK: Yjs Binary Sync Step / Update Frame
    PK->>PK: Process Yjs Doc update (readOnly gate passed)
    PK->>ClientB: Relay Yjs Update Frame
```

---

## Reconnection Strategy

WorkSphere operates two distinct reconnection strategies depending on the transport protocol:

### 1. PartySocket WebSocket Reconnection (`partysocket`)

- WorkSphere relies on the built-in automatic reconnect loop supplied by `partysocket` (`partysocket` ^1.3.0).
- When a WebSocket disconnects, `partysocket` automatically handles socket re-creation and exponential backoff retry attempts under the hood.
- WorkSphere application code attaches to socket events (`onOpen`, `onClose`) and uses `FailoverSyncManager` to handle state resynchronization upon reconnection rather than re-implementing raw socket retries.

### 2. Server-Sent Events (SSE) Reconnection (`useRealTimeUpdates`)

- Located in `src/hooks/useRealTime.tsx` (lines 43-148), `useRealTimeUpdates` implements an explicit application-layer exponential backoff loop for the EventSource connection (`/api/venues/updates`):

```typescript
// Initial state
let currentBackoff = 1000; // 1 second

// Error Handler & Backoff Logic (src/hooks/useRealTime.tsx lines 88-105)
eventSource.onerror = () => {
  setIsConnected(false);
  eventSource?.close();

  // Exponential backoff: double the delay up to 30 seconds
  clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(connect, currentBackoff);
  currentBackoff = Math.min(30000, currentBackoff * 2);
};

// Reset on Successful Open (src/hooks/useRealTime.tsx line 69)
eventSource.onopen = () => {
  setIsConnected(true);
  currentBackoff = 1000; // Reset backoff delay on success
};
```

---

## Exponential Backoff Algorithm

### Verified Application SSE Backoff Parameters (`src/hooks/useRealTime.tsx`)

| Parameter              | Value                                                                                    | Evidence / Line                    |
| :--------------------- | :--------------------------------------------------------------------------------------- | :--------------------------------- |
| **Initial Delay**      | `1000` ms (1 second)                                                                     | `src/hooks/useRealTime.tsx:49`     |
| **Backoff Multiplier** | `2.0` (Doubles delay per attempt)                                                        | `src/hooks/useRealTime.tsx:104`    |
| **Maximum Delay Cap**  | `30000` ms (30 seconds)                                                                  | `src/hooks/useRealTime.tsx:104`    |
| **Jitter Calculation** | **Not Implemented** (Uses deterministic doubling: `Math.min(30000, currentBackoff * 2)`) | `src/hooks/useRealTime.tsx:104`    |
| **Reset Condition**    | Connection `onopen` or Browser `online` event                                            | `src/hooks/useRealTime.tsx:69,111` |

---

## Offline Outbox Queue

When the browser is offline (`navigator.onLine === false`), user actions are saved into IndexedDB outboxes rather than being dropped.

### Verified Outbox Stores

```mermaid
graph LR
    Sub[User Action] --> CheckOnline{navigator.onLine?}
    CheckOnline -->|Online| WSSend[Send over PartySocket]
    CheckOnline -->|Offline| Lock[Acquire WebLock: worksphere-offline-store-lock]
    Lock --> IDB[(IndexedDB Outbox)]
    IDB --> Checkins[checkins-outbox Store]
    IDB --> Favorites[favorites-outbox Store]
    IDB --> Pending[pendingActions Store]
```

1. **`checkins-outbox`** (`src/lib/offlineStore.ts`):
   - Store Schema: KeyPath `id` (autoIncrement).
   - Record Interface: `{ id?, venueId: string, timestamp: number, retryCount?: number }`.
2. **`favorites-outbox`** (`src/lib/offlineStore.ts`):
   - Store Schema: KeyPath `id` (autoIncrement).
   - Record Interface: `{ id?, venueId: string, action: "ADD" | "REMOVE", timestamp: number, retryCount?: number }`.
3. **`pendingActions`** (`src/lib/offlineStorage.ts`):
   - Store Schema: KeyPath `id` (autoIncrement).
   - Record Interface: `{ id?, type: "crdt-sync" | "conversation-rename" | "conversation-delete" | ..., timestamp: number }`.

---

## Queue Persistence

- **Database Engine**: Native browser IndexedDB (`WorkSphereOfflineDB` v2 and `worksphere-offline` v4).
- **Multi-Tab Web Locks API Serialization** (`src/lib/offlineStore.ts` lines 20-38):
  To prevent IndexedDB transaction deadlocks across multiple open browser tabs during concurrent offline writes (#910), all outbox insertions are wrapped with `navigator.locks.request`:

```typescript
export async function withWebLock<T>(
  callback: () => Promise<T>,
  lockName = "worksphere-offline-store-lock",
): Promise<T> {
  if (
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    navigator.locks?.request
  ) {
    try {
      return await navigator.locks.request(lockName, async () => callback());
    } catch {
      return callback();
    }
  }
  return callback();
}
```

- **Deduplication**:
  - `queueOfflineCheckIn`: Scans existing records in `checkins-outbox` for an identical `venueId` before adding.
  - `queueOfflineFavorite`: Scans `favorites-outbox` for an identical `venueId` and `action`.
  - `queuePendingAction`: Deduplicates pending actions by `type` + `venueId`.

---

## Queue Flushing Logic

Queue flushing is triggered automatically when network connectivity is restored:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser as Browser Window
    participant Hook as useSeatAvailability Hook
    participant IDB as IndexedDB (checkins-outbox)
    participant SyncAPI as Next.js API (/api/sync)
    participant PK as PartyKit Server

    User->>Browser: Reconnects to Internet
    Browser->>Hook: Window "online" Event
    Hook->>IDB: getQueuedCheckIns()
    IDB-->>Hook: Return queued OfflineCheckIn[]
    loop For each queued item
        Hook->>SyncAPI: POST /api/sync { checkIns: [item] }
        alt HTTP 200 OK
            SyncAPI-->>Hook: 200 OK
            Hook->>IDB: dequeueOfflineCheckIn(item.id)
            alt PartySocket is OPEN
                Hook->>PK: socket.send({ type: "seat_checkin", venueId, capacity })
            end
        else HTTP Error / Network Failure
            SyncAPI-->>Hook: Error Response
            Hook->>IDB: incrementCheckInRetryCount(item.id)
        end
    end
    Hook-->>User: Toast Notification ("Sync completed" or "Sync failed")
```

### Flush Error & Retry Policy

- **Maximum Retries**: `MAX_SYNC_RETRIES = 3` (`src/lib/offlineStore.ts` line 12).
- If sync fails for an item, `incrementCheckInRetryCount(item.id)` increments the attempt counter.
- User receives feedback via toast notifications ("Sync started", "Sync completed", "Sync failed").

---

## State Re-synchronization

State re-synchronization on edge node failover or reconnection is governed by the `FailoverSyncManager` class (`src/lib/edge/failoverSync.ts`).

```mermaid
sequenceDiagram
    autonumber
    participant Socket as PartySocket
    participant FSM as FailoverSyncManager
    participant Server as PartyKit Server (party/server.ts)
    participant State as Application State

    Socket->>FSM: handleDisconnect()
    FSM->>FSM: Set state = "connecting", isReconnecting = true
    Socket->>FSM: handleConnect(sendFn, roomId)
    FSM->>FSM: Set state = "syncing_snapshot", clear deltaBuffer
    FSM->>Server: send({ type: "request_room_snapshot", roomId, snapshotId })

    par Buffer Incoming Deltas
        Server-->>FSM: Broadcast Delta 1 (t=105)
        FSM->>FSM: Buffer Delta 1 in deltaBuffer
    and Process Snapshot Response
        Server-->>FSM: JSON { type: "room_snapshot_response", timestamp: 100, seats: [...] }
        FSM->>FSM: handleSnapshotResponse(...)
        FSM->>State: Reconcile Full Snapshot State
        FSM->>State: Replay Deltas received after t >= (100 - 50ms)
        FSM->>FSM: Set state = "synced", Clear deltaBuffer
    end
```

### Key Re-synchronization Invariants

1. **Delta Buffering during Snapshot Fetch**: While state is `syncing_snapshot`, incoming incremental deltas are buffered in `deltaBuffer` instead of being applied immediately.
2. **Snapshot Reconciliation & Delta Replay**: On receipt of `room_snapshot_response`, local state is replaced with snapshot state. Deltas buffered after `snapshotTimestamp - 50ms` (allowing for minor clock skew) are replayed in order.
3. **Snapshot Timeout Safety Net**: If the server fails to return a snapshot within 3000ms (`snapshotTimeoutMs`), `FailoverSyncManager` logs a warning, drains the delta buffer, and transitions the state to `synced` to avoid blocking the UI indefinitely.

---

## Heartbeat Protocol

Heartbeat monitoring is implemented in `useMultiRegion` (`src/hooks/useMultiRegion.ts` lines 40-74):

- **Interval**: 5000 ms (5 seconds).
- **Ping Frame**: `{ type: "ping" }`.
- **Pong Frame**: Server responds with `{ type: "pong" }` (or `{ type: "region_info" }`).
- **Latency Calculation**: `roundTripTime = Date.now() - pingStartTimestamp`.
- **Latency Quality Thresholds**:
  - `< 15 ms`: `"excellent"`
  - `< 30 ms`: `"good"`
  - `< 50 ms`: `"fair"`
  - `>= 50 ms`: `"poor"`

```typescript
// Ping interval lifecycle (src/hooks/useMultiRegion.ts)
onOpen() {
  setIsConnected(true);
  latencyIntervalRef.current = setInterval(() => {
    pingStartRef.current = Date.now();
    socket.send(JSON.stringify({ type: "ping" }));
  }, 5000);
},
onClose() {
  setIsConnected(false);
  if (latencyIntervalRef.current) clearInterval(latencyIntervalRef.current);
}
```

---

## Failure Recovery

| Failure Scenario              | Recovery Mechanism              | Implementation Details                                                                                                                    |
| :---------------------------- | :------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Network Interruption**      | Auto-reconnect + Offline Outbox | `partysocket` reconnects underlying WS. Outbox queues check-ins in IndexedDB and flushes on `window.online`.                              |
| **Edge Server Failover**      | Snapshot Sync + Delta Replay    | `FailoverSyncManager.handleConnect` issues `request_room_snapshot` to the new edge node and replays post-snapshot deltas.                 |
| **Browser Tab Suspension**    | Tab Focus Health Check          | `useRealTimeUpdates` listens to `document.visibilitychange`. If `visibilityState === "visible"` and stream is closed, triggers reconnect. |
| **SSR / Hydration Mismatch**  | Client-Only Wrapper             | `PartyKitPresenceWrapper` prevents rendering WebSocket-dependent presence nodes until client hydration completes.                         |
| **Duplicate Snapshot Frames** | Snapshot ID Tracking            | `FailoverSyncManager` records `lastAppliedSnapshotId` and drops duplicate snapshot responses.                                             |

---

## Performance Considerations

- **Bitrate Adaptation for Screen Sharing**: `useScreenShare.ts` runs a 4000ms loop invoking `adaptVideoBitrate(pc)` (`src/lib/screenShareBitrate.ts`) to dynamically scale WebRTC video bitrate according to network conditions.
- **Yjs Garbage Collection**: Server initializes Yjs bindings with `{ gc: true }` (`party/server.ts` line 97) to clear deleted document history nodes and limit memory usage.
- **Search History Trimming**: `saveSearchOffline` caps cached search history at 15 queries (`MAX_SEARCH_HISTORY = 15` in `src/lib/offlineStorage.ts`).

---

## Browser Compatibility

- **WebSockets (`WebSocket`)**: Supported in all modern browsers.
- **IndexedDB (`indexedDB`)**: Supported in all modern browsers. Private Browsing in Safari restricts IndexedDB access; WorkSphere detects `SecurityError` on DB open and displays a user notification alert (`showPrivateBrowsingAlert`).
- **Web Locks API (`navigator.locks`)**: Used in `src/lib/offlineStore.ts` and `src/lib/offlineStorage.ts` for multi-tab transaction serialization. Provides fallback execution when `navigator.locks` is unsupported.
- **Service Worker Background Sync (`SyncManager`)**: Supported in Chromium browsers. Safari/Firefox fall back to foreground `window.online` event flushing (`flushConversationEditQueue`).

---

## Known Limitations

1. **Lack of Random Jitter in SSE Exponential Backoff**: The backoff loop in `useRealTime.tsx` doubles delay deterministically (`currentBackoff * 2`) without random jitter. In massive reconnection events, clients could attempt reconnects in synchronized thundering herd waves.
2. **Foreground Reconnect Delay on Mobile Safari**: Mobile WebKit places background tabs in suspended states where `setInterval` timers are throttled, delaying latency pings until tab focus returns.

---

## Future Improvements

1. **Add Full Jitter to SSE Reconnection Backoff**: Introduce randomized jitter (e.g. `currentBackoff * (0.8 + Math.random() * 0.4)`) to `useRealTime.tsx` to prevent thundering herd spikes during server restarts.
2. **WebSocket Outbox Transport**: Extend the IndexedDB outbox queue to support direct WebSocket message frame flushing in addition to the current HTTP `/api/sync` fallback endpoint.

---

## Repository Files Referenced

- `partykit.json`
- `party/server.ts`
- `party/multiRegionServer.ts`
- `src/hooks/useRealTime.tsx`
- `src/hooks/useSeatAvailability.ts`
- `src/hooks/useCanvasWhiteboard.ts`
- `src/hooks/useMultiRegion.ts`
- `src/hooks/useScreenShare.ts`
- `src/components/Map.tsx`
- `src/components/chat/PartyKitPresenceWrapper.tsx`
- `src/app/collections/[id]/page.tsx`
- `src/app/api/folders/[id]/refresh/route.ts`
- `src/app/api/partykit/auth/route.ts`
- `src/lib/offlineStore.ts`
- `src/lib/offlineStorage.ts`
- `src/lib/edge/failoverSync.ts`
- `src/lib/edge/geoRouter.ts`
- `src/lib/edge/stateSync.ts`

---

## Reconnection Event Hooks

`partysocket` (the WorkSphere PartyKit client) exposes WebSocket-compatible lifecycle events for monitoring reconnection state.

### Registering event handlers

```ts
import PartySocket from "partysocket";

const socket = new PartySocket({
  host: process.env.NEXT_PUBLIC_PARTYKIT_HOST!,
  room: `folder-${folderId}`,
});

// Fired when the socket has lost connection and is waiting to retry
socket.addEventListener("close", (event) => {
  console.log("PartyKit disconnected — code:", event.code);
  setConnectionStatus("reconnecting");
});

// Fired on every retry attempt before the connection is re-established
socket.addEventListener("error", (event) => {
  console.warn("PartyKit connection error:", event);
});

// Fired when the socket successfully (re)connects
socket.addEventListener("open", (event) => {
  console.log("PartyKit connected");
  setConnectionStatus("connected");
  // Re-request room snapshot to recover any missed state
  socket.send(JSON.stringify({ type: "room_snapshot_request" }));
});
```

### Exponential backoff settings

`partysocket` retries with exponential backoff out of the box. You can customise the delays:

```ts
const socket = new PartySocket({
  host: process.env.NEXT_PUBLIC_PARTYKIT_HOST!,
  room: `session-${sessionId}`,
  // Backoff configuration (all values in milliseconds)
  minDelay: 1000,         // First retry after 1 s
  maxDelay: 30_000,       // Cap retries at 30 s
  maxRetries: 10,         // Give up after 10 attempts
});
```

| Setting | Default | Effect |
|---------|---------|--------|
| `minDelay` | 1000 ms | Delay before the first reconnect attempt |
| `maxDelay` | 30 000 ms | Maximum backoff ceiling |
| `maxRetries` | Infinity | Total retry attempts before giving up |

### Status change event payload

WorkSphere broadcasts a `connection_status` message to the React component tree via a custom DOM event when the reconnection state changes:

```ts
// src/lib/partyKitStatus.ts — example emitter
window.dispatchEvent(
  new CustomEvent("partykit:status", {
    detail: {
      status: "reconnecting" | "connected" | "disconnected",
      attempt: number,       // current retry attempt (0 = first)
      nextRetryMs: number,   // milliseconds until next retry
    },
  }),
);

// Consumer
window.addEventListener("partykit:status", (e: Event) => {
  const { status, attempt, nextRetryMs } = (e as CustomEvent).detail;
  console.log(`PartyKit ${status} — attempt ${attempt}, retry in ${nextRetryMs}ms`);
});
```

---

## Troubleshooting Guide: Multi-Region Failover & Reconnection Timers (#5878)

This guide provides operational runbooks, configuration best practices, retry formulas, and debugging recipes for developers troubleshooting PartySocket connections, multi-region edge failover, and heartbeat timeouts in production and local environments.

### 1. Exponential Backoff Parameters & Mathematical Formulas

`partysocket` utilizes an exponential backoff retry strategy with randomized jitter to prevent the "thundering herd" problem when an edge region restarts or experiences transient degradation.

#### Mathematical Retry Formula

The backoff duration for retry attempt $n$ (where $n \ge 0$) is defined as:

$$\text{Backoff}_n = \min\left(\text{maxTimeout}, \text{minTimeout} \times (\text{multiplier})^n\right) \times (1 + \text{jitter} \times \text{random}(-1, 1))$$

Or with full randomized jitter $\in [0, 1]$:

$$T_{\text{wait}}(n) = \min\left(T_{\max}, T_{\min} \cdot b^n\right) \cdot \left(1 + \mathcal{J} \cdot \operatorname{rand}(-0.5, 0.5)\right)$$

Where:
- $T_{\min}$ (`minTimeout` / `minDelay`): Base reconnection delay before the first retry (Default: **1,000 ms**).
- $T_{\max}$ (`maxTimeout` / `maxDelay`): Ceiling cap on retry intervals (Default: **30,000 ms**).
- $b$ (`multiplier` / `backoffFactor`): Exponential multiplier scaling the backoff (Default: **1.5 – 2.0**).
- $\mathcal{J}$ (`jitter`): Randomization factor preventing synchronised client reconnection spikes (Recommended: **0.20 – 0.30** or 20–30% variance).

#### Configuration Recommendations

| Parameter | Recommended (Standard Client) | High-Urgency (Live Whiteboard/Audio) | Low-Bandwidth (Background Sync) | Description |
| :--- | :--- | :--- | :--- | :--- |
| `minTimeout` | `1000` (1s) | `500` (0.5s) | `3000` (3s) | Initial backoff delay for attempt 0 |
| `maxTimeout` | `30000` (30s) | `10000` (10s) | `60000` (60s) | Maximum ceiling cap for backoff |
| `multiplier` | `1.5` | `1.4` | `2.0` | Exponential progression rate |
| `jitter` | `0.25` ($\pm 25\%$) | `0.15` ($\pm 15\%$) | `0.30` ($\pm 30\%$) | Uniform jitter window applied to retry calculation |
| `maxRetries` | `Infinity` (Auto-heal) | `20` (Failover trigger) | `10` | Number of attempts before triggering hard fallback |

#### Production Client Implementation Example

```typescript
import PartySocket from "partysocket";

export function createResilientPartySocket(room: string, host: string) {
  return new PartySocket({
    host,
    room,
    // Reconnection parameters
    minDelay: 1000,
    maxDelay: 30000,
    maxRetries: Infinity,
    // Add jittered backoff generator
    reconnectionDelay: (attempt: number) => {
      const baseDelay = Math.min(30000, 1000 * Math.pow(1.5, attempt));
      const jitterFactor = 1 + (Math.random() * 0.5 - 0.25); // +/- 25% jitter
      return Math.round(baseDelay * jitterFactor);
    },
  });
}
```

---

### 2. WebSocket Heartbeat Ping/Pong & Failure Detection Thresholds

Network middleboxes (NAT routers, enterprise firewalls, cellular towers, and cloud load balancers) routinely drop idle TCP sockets without emitting a TCP `FIN` packet ("silent disconnects" / "half-open sockets").

To reliably detect broken sockets before user interaction fails, WorkSphere employs dual application-layer heartbeat monitors:

#### Heartbeat Parameters & Thresholds

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client PartySocket
    participant Server as PartyKit Edge Room

    loop Every 15s (Ping Interval)
        Client->>Server: JSON { type: "heartbeat_ping", timestamp: 1728000000000 }
        alt Server Alive
            Server-->>Client: JSON { type: "heartbeat_pong", timestamp: 1728000000000, serverTime: 1728000000020 }
            Note over Client: Reset missedPingCount = 0<br/>RTT = now - timestamp
        else Pong Missed (Timeout > 5000ms)
            Note over Client: missedPingCount++ (Increment)
        end
    end

    Note over Client: If missedPingCount >= 3 (15s total without Pong):<br/>Socket considered DEAD. Call socket.reconnect()
```

- **Ping Interval (`HEARTBEAT_INTERVAL`)**: **15,000 ms** (15 seconds).
- **Pong Timeout (`PONG_TIMEOUT`)**: **5,000 ms** (5 seconds).
- **Failure Threshold (`MAX_MISSED_HEARTBEATS`)**: **3 consecutive pings**.
  - Total time to detect an ungracefully dropped connection: $3 \times 15\text{s} = 45\text{s}$ (or 15s when tracking individual timeout deadlines).
- **Grace Period on Reconnect (`RECONNECT_GRACE_PERIOD`)**: **3,000 ms** before resuming heartbeats.

#### Heartbeat Monitor Implementation Recipe

```typescript
export class HeartbeatMonitor {
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private missedPings = 0;
  private readonly maxMissed = 3;

  constructor(
    private socket: PartySocket,
    private intervalMs: number = 15000,
    private timeoutMs: number = 5000,
    private onDeadSocket: () => void = () => socket.reconnect()
  ) {}

  public start() {
    this.stop();
    this.pingTimer = setInterval(() => this.sendPing(), this.intervalMs);
  }

  public stop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimeout) clearTimeout(this.pongTimeout);
    this.pingTimer = null;
    this.pongTimeout = null;
    this.missedPings = 0;
  }

  private sendPing() {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(JSON.stringify({ type: "heartbeat_ping", timestamp: Date.now() }));

    this.pongTimeout = setTimeout(() => {
      this.missedPings++;
      console.warn(`[PartyKit Heartbeat] Missed pong count: ${this.missedPings}/${this.maxMissed}`);
      if (this.missedPings >= this.maxMissed) {
        console.error("[PartyKit Heartbeat] Heartbeat threshold exceeded. Forcing socket reconnect.");
        this.stop();
        this.onDeadSocket();
      }
    }, this.timeoutMs);
  }

  public handlePong() {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    this.missedPings = 0;
  }
}
```

---

### 3. Edge Region Failover Behavior

WorkSphere runs across multiple edge regions (`iad` [US-East], `fra` [EU-Central], `sin` [Asia-Pacific]). When an edge node degrades or loses cross-region replication, the client triggers automatic edge failover.

#### Failover Trigger Sequence

1. **Failure Detection**:
   - Connection drops, or
   - 3 consecutive heartbeat timeouts occur, or
   - Region RTT latency measured by `useMultiRegion` exceeds $350\text{ ms}$ for 3 consecutive intervals.
2. **Region Selection (`geoRouter.ts`)**:
   - Client queries fallback region list ordered by geographic latency proximity.
   - Example priority: `sin` $\to$ `fra` $\to$ `iad`.
3. **Failover Execution (`FailoverSyncManager`)**:
   - Client switches target host from `sin.partyserver.worksphere.com` to `fra.partyserver.worksphere.com`.
   - Transitions state machine to `syncing_snapshot`.
   - Requests full Yjs document snapshot (`request_room_snapshot`) to reconcile state divergence caused by the regional failover.
   - Replays queued local outbox deltas (`pendingActions`).

---

### 4. Inspecting PartyKit Room State in Production

When diagnosing connectivity, state divergence, or failover issues in live staging or production, follow these debugging recipes:

#### A. Chrome / Edge DevTools Network WebSocket Inspector

1. Open **DevTools** (`F12` or `Ctrl+Shift+I` / `Cmd+Option+I`).
2. Navigate to the **Network** tab.
3. Filter by **`WS`** (WebSockets).
4. Select the active PartyKit connection (e.g. `party.worksphere.com/parties/workspace/folder-123`).
5. Open the **Messages** sub-tab:
   - **Green (up arrow)**: Messages sent from client (e.g., `seat_checkin`, `cursor`, `heartbeat_ping`).
   - **White/Red (down arrow)**: Frames received from edge server (e.g., `seat_update`, `heartbeat_pong`, binary Yjs frames).
6. **Look for binary frames**: Select binary messages to view byte length. Rapid high-volume binary frames indicate Yjs CRDT synchronization loops.

#### B. Console Inspection via Global Debug Hook

In development and staging, WorkSphere attaches active PartySocket and FailoverSyncManager instances to `window.__PARTYKIT_DEBUG__`:

```javascript
// Run directly in Browser Console:
// 1. Check current connection state
console.log(window.__PARTYKIT_DEBUG__.status);
// => "synced" | "connecting" | "syncing_snapshot"

// 2. Check active room and edge host
console.log({
  room: window.__PARTYKIT_DEBUG__.socket.room,
  host: window.__PARTYKIT_DEBUG__.socket.host,
  readyState: window.__PARTYKIT_DEBUG__.socket.readyState, // 1 = OPEN
});

// 3. Inspect queued local mutations waiting for reconnect
console.log(window.__PARTYKIT_DEBUG__.failoverManager.getPendingDeltaCount());

// 4. Force a manual failover test
window.__PARTYKIT_DEBUG__.failoverManager.triggerSimulatedFailover("fra");
```

#### C. HTTP Room Health & Metrics API

Every PartyKit room exposes a health inspection HTTP endpoint on the edge worker:

```bash
# Query live room connection count and presence stats
curl -X GET "https://party.worksphere.com/parties/workspace/room-abc/health" \
  -H "Authorization: Bearer <ADMIN_OR_SERVICE_TOKEN>"

# Expected JSON response:
# {
#   "status": "healthy",
#   "connections": 4,
#   "region": "fra",
#   "lastSyncTimestamp": 1728000000000,
#   "yDocSize": 45120
# }
```

---

### 5. Common Production Issues & Resolution Matrix

| Symptom | Probable Cause | Diagnostic Command / Check | Resolution |
| :--- | :--- | :--- | :--- |
| **Error 1006 / Instant Disconnect** | Expired or malformed Clerk JWT token in query parameter `?token=...` | Check DevTools Console: `401 Unauthorized` or `verifyToken failed` in server log | Call `useAuth().getToken({ skipCache: true })` before initiating PartySocket connection. |
| **Infinite Reconnect Storm** | `minTimeout` configured too low with zero jitter (`minDelay < 100ms`, `jitter = 0`) | Network tab shows 20+ WS connection attempts per second | Configure `minDelay: 1000` and apply `jitter: 0.25` ($\pm 25\%$). |
| **Silent Freeze / Unresponsive Room** | Mobile sleep or WiFi handover dropped TCP socket without emitting close event | WebSocket state shows `1 (OPEN)` but no message replies received | Enable `HeartbeatMonitor` with 15s ping interval and 3-miss threshold. |
| **Whiteboard Desynchronization on Reconnect** | Missed room snapshot during edge node transition | `FailoverSyncManager` state remains stuck in `syncing_snapshot` | Verify client emits `request_room_snapshot` upon `onOpen` and handles 3000ms fallback timeout. |

