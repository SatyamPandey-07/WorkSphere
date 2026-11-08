# PartyKit WebRTC Signaling & Multi-Region Protocol

> **Source files:**  
> `party/server.ts` — primary room server (seat sync, WebRTC signaling, cursor broadcasts)  
> `party/multiRegionServer.ts` — multi-region edge handoff with JWT room tokens  
> **Related:** [`PARTYKIT_ARCHITECTURE.md`](./PARTYKIT_ARCHITECTURE.md), [`partykit-concurrency.md`](./partykit-concurrency.md)

---

## 1. WebSocket Message Protocol

All messages are JSON strings sent over the PartyKit WebSocket connection.

### Server → Client messages

| `type` | Payload | Description |
|--------|---------|-------------|
| `ping` | `{}` | Heartbeat sent every **10 s** to keep the connection alive |
| `pong` | `{}` | Heartbeat reply from server to a client-sent ping |
| `room_snapshot_response` | `{ occupancy, seats, ... }` | Full room state sent to a newly connected client |
| `seat_snapshot` | `{ venues: [...] }` | Seat check-in/availability snapshot on join |
| `seat_update` | `{ venues: [...] }` | Broadcast after any check-in or check-out |
| `peer-leave` | `{ name: string }` | Peer disconnected — used to clean up WebRTC connections |
| `edge_handoff_token` | `{ token: string }` | JWT issued for migration to a geographically closer region |
| `music_genre_broadcast` | `{ genre: string }` | Genre voted by a participant |
| `music_genre_error` | `{ error: string }` | Invalid genre vote rejected by server |

### Client → Server messages

| `type` | Payload | Description |
|--------|---------|-------------|
| `webrtc-signal` | `{ to: string, signal: RTCSignal }` | Relay an SDP offer, answer, or ICE candidate to a specific peer |
| `cursor` | `{ x, y, name }` | Cursor/presence position broadcast |
| `seat_checkin` | `{ venueId, capacity? }` | User occupying a seat at a venue |
| `seat_checkout` | `{ venueId }` | User leaving a venue |
| `edge_handoff_request` | `{}` | Request a JWT for migrating to a closer region |
| `edge_handoff_verify` | `{ token: string }` | Present a handoff token from another region |

---

## 2. Room State Persistence

PartyKit Durable Objects persist room state in memory for the lifetime of the DO. WorkSphere additionally syncs presence and seat data to clients on join via `room_snapshot_response` so a client that reconnects quickly gets the current state without waiting for broadcasts.

---

## 3. Peer Disconnect Heartbeats

The server sends a `ping` frame every **10 seconds** (`heartbeatIntervalMs: 10_000`). If a client fails to respond, PartyKit's Durable Object closes the connection after a platform-controlled timeout. WorkSphere's `server.ts` handles `onClose` to:

1. Remove the peer's seat check-in (decrements occupancy)
2. Broadcast `peer-leave` so other clients clean up their WebRTC `RTCPeerConnection` for that peer

---

## 4. Room Token Authorization

`multiRegionServer.ts` supports optional JWT-based room authorization:

```ts
// Client connects with ?token=<JWT>
const token = url.searchParams.get("token");
if (token) {
  const verifiedToken = await verifyToken(token, { secretKey });
  // Grant access based on claims
}
```

Tokens are verified using Clerk's `verifyToken()`. Without a token, anonymous read access is permitted for public rooms. Set `PARTYKIT_SHARED_SECRET` to require all connections to carry a valid token.

---

## 5. Multi-Region Edge Handoff

When a client's latency to the current DO region is high, it can request migration to a geographically closer Durable Object:

1. Client sends `{ type: "edge_handoff_request" }`
2. Server generates a short-lived JWT (`edge_handoff_token`) containing the room ID and user claims
3. Client reconnects to the nearest PoP with `?token=<JWT>`
4. New DO verifies the token with `{ type: "edge_handoff_verify", token }` and restores session

---

## 6. Connecting a Custom Sub-Client

```ts
import PartySocket from "partysocket";

const socket = new PartySocket({
  host: process.env.NEXT_PUBLIC_PARTYKIT_HOST!,
  room: `session-${sessionId}`,
  query: { token: sessionToken }, // optional JWT
});

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "seat_update") {
    // handle seat change
  }
});

socket.send(JSON.stringify({ type: "seat_checkin", venueId: "venue_abc" }));
```

---

## 7. Firewall & NAT Traversal Troubleshooting

WebRTC ICE candidates are exchanged via PartyKit `webrtc-signal` messages but actual media travels peer-to-peer. If connections stall at `"checking"`:

| Issue | Fix |
|-------|-----|
| Connection stays at `checking` | Add a TURN server (see [`WEBRTC_MESH.md`](./WEBRTC_MESH.md)) |
| Port 1999 blocked in dev | Check firewall; use `--port` flag with `npx partykit dev` |
| `CORS` error on auth endpoint | See [`PartyKit Local Setup`](./partykit-local-setup.md) — add `PARTYKIT_SHARED_SECRET` |
| Heartbeat timeout on mobile | Ensure device doesn't kill background tabs; use visibility API to reconnect |

---

## 8. Presence Broadcasting & Cursor Synchronization

### 8.1 Presence Messages

WorkSphere uses two presence message types for cursor and user state:

**`cursor` — Client → Server → All peers**

Sent when the user moves their cursor in a collaborative space (whiteboard, map, shared document):

```json
{
  "type": "cursor",
  "name": "Jane Doe",
  "x": 0.42,
  "y": 0.67
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"cursor"` | Message discriminator |
| `name` | string | Display name of the user (stored in connection state) |
| `x` | number | Normalized horizontal position (0–1) |
| `y` | number | Normalized vertical position (0–1) |

The server:
1. Updates `conn.state.name` from the `name` field on first receipt
2. Broadcasts the full cursor message to all other connections (excluding sender)

**`peer-leave` — Server → All peers**

Broadcast when a connection closes (tab closed, network drop, heartbeat timeout):

```json
{ "type": "peer-leave", "name": "Jane Doe" }
```

Receivers remove the cursor overlay for `name` from their UI.

**`presence` — Client → Server → All peers**

Generic presence update (e.g., "user is typing", "user is away"):

```json
{
  "type": "presence",
  "name": "Jane Doe",
  "status": "active"
}
```

Forwarded verbatim to all other connections.

---

### 8.2 Presence Timeout Cleanup

When a connection closes unexpectedly (network drop without `WebSocket.close()` frame):

1. PartyKit detects the dead socket via the heartbeat (10s ping — see §3)
2. `onClose()` fires on the server for that connection
3. The server broadcasts `{ type: "peer-leave", name: state.name }` to all remaining connections
4. The server clears the connection's seat check-in (decrements venue occupancy count)

Clients handle `peer-leave` by removing the cursor overlay and any presence indicator for that user.

---

### 8.3 Rendering Peer Cursors on Collaborative Canvases

```typescript
import usePartySocket from "@/hooks/usePartySocketReconnect";

interface PeerCursor { name: string; x: number; y: number }
const [cursors, setCursors] = useState<Map<string, PeerCursor>>(new Map());

const socket = usePartySocket({
  host: process.env.NEXT_PUBLIC_PARTYKIT_HOST!,
  room: `whiteboard-${sessionId}`,
  onMessage(event) {
    const msg = JSON.parse(event.data);

    if (msg.type === "cursor") {
      setCursors((prev) => new Map(prev).set(msg.name, msg));
    }
    if (msg.type === "peer-leave") {
      setCursors((prev) => {
        const next = new Map(prev);
        next.delete(msg.name);
        return next;
      });
    }
  },
});

// Broadcast local cursor on mousemove:
function handleMouseMove(e: MouseEvent) {
  const rect = canvasRef.current!.getBoundingClientRect();
  socket.send(JSON.stringify({
    type: "cursor",
    name: currentUser.name,
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  }));
}
```

To render overlays, iterate `cursors.entries()` and position each cursor element using `left: ${c.x * 100}% / top: ${c.y * 100}%` on the canvas container.
