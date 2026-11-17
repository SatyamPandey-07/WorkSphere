# PartyKit Local Development and Multi-Room Testing Guide

Comprehensive developer guide for configuring, running, inspecting, and debugging the PartyKit real-time engine and multi-room synchronization in WorkSphere.

---

## 1. Prerequisites and Environment Setup

### Required Software & Dependencies
- **Node.js**: `v20.x` or later (Node 18+ supported; Node 20+ recommended).
- **npm**: `v9.x` or later.
- **Project Dependencies**: Installed via `npm install`. The project includes:
  - `partykit`: `^0.0.115` (PartyKit CLI & server runtime)
  - `partysocket`: `^1.3.0` (Client WebSocket library)
  - `y-partykit`: `^0.0.33` (Yjs CRDT connector)
- **Local Ports Required**:
  - `1999`: Default PartyKit local development server (`127.0.0.1:1999`).
  - `3000`: Next.js development application server (`127.0.0.1:3000` / `localhost:3000`).

---

### Environment Variable Reference

PartyKit in WorkSphere uses environment variables across three layers: the browser client (Next.js frontend), the PartyKit server runtime, and the Next.js internal auth route (`/api/partykit/auth`).

| Variable | Scope | Required / Optional | Default (Local) | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_PARTYKIT_HOST` | Client (Browser) | **Required** (Recommended) | `127.0.0.1:1999` | Host address used by `PartySocket` and `usePartySocket` to establish WebSockets. |
| `NEXT_PUBLIC_PARTYKIT_URL` | Client & Server | Optional | `http://127.0.0.1:1999` | Base HTTP endpoint for REST snapshots and health checks. |
| `NEXT_PUBLIC_APP_URL` | Client & Server | **Required** | `http://127.0.0.1:3000` | Base Next.js app URL used by PartyKit to query `/api/partykit/auth`. |
| `PARTYKIT_SHARED_SECRET` | Server & Next.js API | **Required** for Auth | *None* (Must set) | Shared Bearer token verifying internal communication between PartyKit and `/api/partykit/auth`. |
| `PARTYKIT_AUTH_SECRET` | Server & Next.js API | Optional | Fallback to `PARTYKIT_SHARED_SECRET` | Alternate name supported by `/api/partykit/auth` to prevent naming mismatches. |
| `CLERK_SECRET_KEY` | Server (PartyKit/Next.js) | Optional for local anon | *None* | Verifies Clerk JWT session tokens on `onConnect` (`@clerk/backend`). |

---

### Safe Environment Template (`.env.local`)

Add the following block to your `.env.local` in the project root:

```env
# -----------------------------------------------------------------------------
# PartyKit Local Development Configuration
# -----------------------------------------------------------------------------

# Browser client WebSocket connection target
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999
NEXT_PUBLIC_PARTYKIT_URL=http://127.0.0.1:1999

# Base URL for PartyKit server to call Next.js internal endpoints
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000

# Shared secret for internal /api/partykit/auth authentication
# Use any strong random string for local development
PARTYKIT_SHARED_SECRET=local-dev-partykit-secret-key-32chars-min

# (Optional) Clerk secret key for token verification in party/server.ts
# If left blank, unauthenticated connections default to role "VIEWER"
CLERK_SECRET_KEY=sk_test_placeholder_key_for_local_testing
```

---

## 2. Running Locally

WorkSphere's real-time architecture requires two concurrent local processes: the PartyKit runtime (`party/server.ts`) and the Next.js dev server.

### Available Scripts & Commands

In `package.json`:
- `npm run dev`: Starts the Next.js development server (`next dev --webpack`) on port `3000`.

To start PartyKit locally, run the PartyKit CLI command directly using `npx`::
```bash
npx partykit dev
```
*(Tip: You can optionally add `"party:dev": "partykit dev"` to the `scripts` section of your local `package.json` and then run `npm run party:dev`. This script is not currently defined in the repository.).*

---

### Two-Terminal Startup Sequence

#### Terminal 1 — Start the PartyKit Development Server
Open your first terminal in the repository root:
```bash
npx partykit dev
```

**Expected Startup Output:**
```text
PartyKit dev server running at http://127.0.0.1:1999
Watching party/server.ts for changes...
[partykit] Connected to room storage
```

PartyKit reads `partykit.json`:
```json
{
  "name": "worksphere-multiplayer",
  "main": "party/server.ts",
  "compatibilityDate": "2024-03-20"
}
```
It binds HTTP and WebSocket listeners to `http://127.0.0.1:1999`.

#### Terminal 2 — Start the Next.js Development Server
Open a second terminal in the repository root:
```bash
npm run dev
```

**Expected Startup Output:**
```text
   ▲ Next.js 16.4.3 (webpack)
   - Local:        http://localhost:3000
   - Network:      http://192.168.x.x:3000

 ✓ Ready in 1.8s
```

---

### Common Startup Errors & Immediate Fixes

#### 1. Port 1999 Address in Use (`EADDRINUSE`)
- **Cause**: An orphaned `partykit dev` or Node process is still bound to port `1999`.
- **Solution (PowerShell)**:
  ```powershell
  # Find PID on port 1999
  Get-NetTCPConnection -LocalPort 1999 -ErrorAction SilentlyContinue | Select-Object OwningProcess
  # Kill the process
  Stop-Process -Id <PID> -Force
  ```
- **Solution (macOS / Linux)**:
  ```bash
  lsof -ti :1999 | xargs kill -9
  ```

#### 2. Unauthorized on `/api/partykit/auth` (HTTP 401)
- **Cause**: `PARTYKIT_SHARED_SECRET` in `.env.local` does not match the token passed by PartyKit in `party/server.ts`.
- **Solution**: Ensure `PARTYKIT_SHARED_SECRET` is set in `.env.local` and restart both terminals so Next.js and PartyKit pick up the environment variable.

#### 3. Client WebSocket Connection Failed (`ERR_CONNECTION_REFUSED`)
- **Cause**: The Next.js client is attempting to connect to `127.0.0.1:1999`, but `npx partykit dev` is not running.
- **Solution**: Confirm Terminal 1 is active and printing `Listening on http://127.0.0.1:1999`.

---

## 3. PartyKit Room Architecture & Inspection

### Room Naming Conventions in WorkSphere

PartyKit isolates state by **Room ID**. WorkSphere uses specific room prefixes and naming conventions in [party/server.ts](../../party/server.ts):

| Room Type | Room ID Format | Description | Authentication / Gate |
| :--- | :--- | :--- | :--- |
| **Venue Seat & Music** | `venue-{venueId}` or `{venueId}` | Live seat check-ins, occupancy counts, seat-hold locks, and ambient music genres. | Open (VIEWER permitted for presence & seat check-in). |
| **Collection Notes** | `folder-notes-{folderId}` | Private collaborative markdown notes using Yjs CRDT. | Gated: Only verified folder members (`role !== "VIEWER"`). |
| **Group Venue Notes** | `notes-{venueId}` | Public collaborative venue scratchpad. | Open to any authenticated user. |
| **Whiteboard Canvas** | `canvas-{canvasId}` | Real-time vector drawings and sticky notes. | Open to all signed-in users. |
| **User Space** | `folder-{folderId}` | Folder-level collaboration. | Gated by folder role lookup. |

---

### Room State & Storage Model

In `party/server.ts`, each active room instance maintains in-memory state:
1. `seatCheckins`: `Map<connId, SeatCheckin>` — Connection-to-seat occupancy map.
2. `seatHolds`: `Map<string, SeatHold>` — 5-minute distributed locks (`${venueId}:${seatId}`).
3. `seatCheckinLocks`: `Set<string>` — In-flight mutex per connection to eliminate race conditions.
4. `roomPresence`: `Map<string, PresenceUser>` — Active typing and cursor presence.
5. `stickyNoteLeases`: `Map<string, StickyNoteLease>` — Sticky note drag/edit leases (5s TTL).
6. `venueMusic`: `Map<string, VenueMusicState>` — Live ambient music tag for the venue.

---

### PartyKit CLI Inspection Commands & Practical Limitations

The installed PartyKit CLI (`v0.0.115`) provides commands for deployment lifecycle and environment management:

```bash
# Display CLI version and help
npx partykit --version
npx partykit --help

# Stream live server logs from a deployed project
npx partykit tail --name worksphere-multiplayer
```

#### Important CLI Scope Note (Local vs Deployed)
`partykit tail` and `partykit info` are **cloud deployment commands** designed to inspect deployed workers on the Cloudflare/PartyKit platform. In **local development (`npx partykit dev`)**:
- All room lifecycles, connections, broadcasts, and errors stream directly to **stdout** in your running `npx partykit dev` terminal.
- Room snapshots can be requested dynamically via WebSocket protocol frames (see below).

---

### Requesting Live Room Snapshots via Protocol

You can query any room's in-memory seat state programmatically or via browser DevTools:

**Send WebSocket Frame:**
```json
{
  "type": "request_room_snapshot",
  "snapshotId": "debug-snap-1"
}
```

**PartyKit Server Response:**
```json
{
  "type": "room_snapshot_response",
  "roomId": "venue-blue-bottle",
  "snapshotId": "debug-snap-1",
  "timestamp": 1731780000000,
  "seats": {
    "venue-blue-bottle": {
      "count": 3,
      "capacity": 20,
      "status": "green"
    }
  }
}
```

To inspect active seat-hold locks:
```json
{
  "type": "request_seat_holds",
  "venueId": "venue-blue-bottle"
}
```

The server replies with `seat_holds_snapshot` containing all active lock holders, expiry timestamps, and lock versions.

---

## 4. Multi-Room Testing & Concurrency Validation

Testing multi-user collaboration and distributed locking requires simulating multiple distinct participants.

### Simulating Multiple Participants Locally

Because browser tabs in the same browser profile share cookies and Clerk session tokens:

1. **Window 1 (User A)**: Standard Chrome / Brave window signed in as `User A`.
2. **Window 2 (User B)**: Incognito / Private window (or secondary Chrome profile) signed in as `User B`.
3. **Window 3 (User C)**: Firefox / Safari or curl/node script simulating an external participant.

---

### Test Scenario 1: Same-Room Seat Check-in & Real-Time Sync

**Objective**: Verify that check-ins in Window A immediately propagate to Window B in the same room.

1. In Window A, navigate to `http://localhost:3000/venues/cafe-nero`.
2. In Window B, navigate to the same venue URL: `http://localhost:3000/venues/cafe-nero`.
3. Both clients connect to PartyKit room `venue-cafe-nero`.
4. In Window A, click **Check In**.
5. Observe:
   - Window A sends frame `{"type":"seat_checkin","venueId":"cafe-nero","capacity":15}`.
   - PartyKit logs the check-in and broadcasts `seat_update` to all connections in room `venue-cafe-nero`.
   - Window B's seat indicator increments live without page refresh.
6. Close Window A:
   - PartyKit detects `onClose` and automatically executes `handleSeatCheckout(conn)`.
   - Window B receives `seat_update` with decremented occupancy.

---

### Test Scenario 2: Multi-Room Isolation

**Objective**: Verify that events in Room 1 do not leak into Room 2.

1. Window A joins `http://localhost:3000/venues/venue-alpha` (Room: `venue-alpha`).
2. Window B joins `http://localhost:3000/venues/venue-beta` (Room: `venue-beta`).
3. Window A checks in or sends a chat message.
4. In Window B's DevTools Network tab, verify **zero** WebSocket frames are received for `venue-alpha`.
5. PartyKit strictly segments state per `room.id`.

---

### Test Scenario 3: Concurrent Lock Acquisition & Conflict Resolution

**Objective**: Test the distributed seat-hold lock protocol ([party/server.ts](../../party/server.ts#L118-L125))) when two users attempt to reserve the same seat simultaneously.

The protocol uses `${venueId}:${seatId}` as the unique key:
- **Lock TTL**: Default 5 minutes (`300,000ms`, clamped between 10s and 600s).
- **Auto-Renewal**: Heartbeat periodically extends `expiresAt`.

#### Test Steps:
1. Open DevTools Console in Window A (User A) and send:
   ```javascript
   // Simulate User A holding Seat 4
   window.__partySocket.send(JSON.stringify({
     type: "seat_hold_request",
     seatId: "seat-4",
     venueId: "cafe-nero",
     userId: "user_alice",
     userName: "Alice"
   }));
   ```
2. User A receives:
   ```json
   {
     "type": "seat_hold_acquired",
     "seatId": "seat-4",
     "venueId": "cafe-nero",
     "heldBy": "user_alice",
     "expiresAt": 1731780300000,
     "version": 1
   }
   ```
   All other users receive a broadcast: `seat_locked`.
3. Immediately in Window B (User B), attempt to lock the same seat:
   ```javascript
   window.__partySocket.send(JSON.stringify({
     type: "seat_hold_request",
     seatId: "seat-4",
     venueId: "cafe-nero",
     userId: "user_bob",
     userName: "Bob"
   }));
   ```
4. User B receives an immediate rejection:
   ```json
   {
     "type": "seat_hold_rejected",
     "seatId": "seat-4",
     "venueId": "cafe-nero",
     "reason": "ALREADY_HELD",
     "heldBy": "user_alice",
     "remainingMs": 298450
   }
   ```
5. User B's UI displays "Seat currently held by Alice".

---

## 5. WebSocket Debugging with Chrome DevTools

### Locating the WebSocket Connection
1. Press `F12` or `Ctrl+Shift+I` (Mac: `Cmd+Opt+I`) to open Chrome DevTools.
2. Navigate to the **Network** tab.
3. In the filter bar below the tabs, click the **WS** (WebSockets) filter button.
4. Reload the page (`F5`).
5. Look for the entry connecting to `127.0.0.1:1999/parties/main/<roomId>` or `/party/<roomId>`.
6. Click the connection name and select the **Messages** sub-tab.

---

### Reading Frame Traffic

- **Green Upward Arrow (`▲`)**: Outgoing message sent by the browser client to PartyKit.
- **Red Downward Arrow (`▼`)**: Incoming message broadcast or sent by PartyKit to the browser.
- **Heartbeat Filter**: Type `ping` or `pong` in the filter box to inspect or hide keepalive packets (PartyKit sends ping every 10s–15s).

---

### Diagnosing Disconnections and Close Codes

In the DevTools **Console** and **Network** tabs, inspect WebSocket close events:

| Close Code | Meaning in WorkSphere | Root Cause & Resolution |
| :--- | :--- | :--- |
| **`1000`** | Normal Closure | Clean logout, room navigation, or intentional unmount. |
| **`1006`** | Abnormal Closure | PartyKit dev server crashed or terminated (`Ctrl+C`), or network interface dropped. Check Terminal 1 output. |
| **`4001`** | Unauthorized / Token Expired | Clerk token validation failed in `onConnect`. Verify `CLERK_SECRET_KEY` or re-authenticate. |
| **`4003`** | Forbidden Folder Access | Attempted to connect to `folder-notes-{id}` without folder membership. |

---

## 6. Comprehensive Troubleshooting Guide

### 1. "PartyKit server unreachable" or `WebSocket is already in CLOSING or CLOSED state`
- **Symptom**: Console floods with reconnection attempts: `[PartySocket] Reconnecting in 500ms...`.
- **Cause**: PartyKit is not running, or `NEXT_PUBLIC_PARTYKIT_HOST` in `.env.local` is misconfigured.
- **Fix**:
  1. Verify Terminal 1 is running `npx partykit dev`.
  2. Verify `.env.local` contains `NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999`.
  3. Ensure you did not prefix `http://` or `ws://` in `NEXT_PUBLIC_PARTYKIT_HOST` (it must be host+port only: `127.0.0.1:1999`).

### 2. Sticky Notes or Seat Holds Dropped Immediately
- **Symptom**: User acquires a lock, but it disappears after 5 seconds.
- **Cause**: The client failed to send the periodic heartbeat.
- **Fix**: Check `src/hooks/useSeatHoldLock.ts` and `party/server.ts`. The server renews an existing hold   when the same user sends another `seat_hold_request`. The general `presence_heartbeat` does not         automatically renew seat holds.

### 3. Yjs CRDT Synchronization Fails in Notes Editor
- **Symptom**: Group notes editor does not show peers' text updates.
- **Cause**: Room ID prefix mismatch or auth rejection on private folder notes.
- **Fix**:
  - Venue notes use prefix `notes-{venueId}`.
  - Folder notes use prefix `folder-notes-{folderId}` and require valid folder membership in Prisma DB.
  - For quick testing without database seeding, use `notes-test-venue` which bypasses folder role gates.

### 4. Duplicate Check-in Count on Reconnection
- **Symptom**: A single user reconnecting shows as two occupants in the venue.
- **Cause**: Previous socket connection did not send `seat_checkout` before re-binding.
- **Fix**: WorkSphere's `WorkspaceServer` keys check-ins by `conn.id`. On reconnect, the old socket is pruned by the 15-second heartbeat sweep or `onClose`. To accelerate cleanup during testing, close the old tab rather than navigating away.

---

## 7. Developer Quick Reference Cheat Sheet

```bash
# 1. Install dependencies
npm install

# 2. Terminal 1: Run PartyKit dev server
npx partykit dev

# 3. Terminal 2: Run Next.js dev server
npm run dev

# 4. Check PartyKit CLI version
npx partykit --version

# 5. Tail live logs from deployed instance (cloud only)
npx partykit tail --name worksphere-multiplayer
```
