# PartyKit WebSocket Architecture

WorkSphere uses [PartyKit](https://partykit.io) for multiplayer WebSocket rooms — folder collaboration (Yjs), presence/cursors, and live seat availability on the map.

This doc covers server setup, room naming, auth, message schemas, presence, lifecycle handlers, and how clients reconnect.

---

## Overview

| Piece | Location |
| --- | --- |
| PartyKit config | `partykit.json` |
| Server | `party/server.ts` (`WorkspaceServer`) |
| Role lookup API | `src/app/api/partykit/auth/route.ts` |
| Folder / Yjs client | `src/hooks/useRealTime.tsx` (`useMultiplayerSession`) |
| Seat presence client | `src/hooks/useSeatAvailability.ts` |
| Folder refresh trigger | `src/app/api/folders/[id]/refresh/route.ts` |

Packages: `partykit`, `partysocket`, `y-partykit`.

Local PartyKit host defaults to `127.0.0.1:1999`. Folder refresh can override that with `NEXT_PUBLIC_PARTYKIT_URL`.

---

## Server setup

`partykit.json`:

```json
{
  "name": "worksphere-multiplayer",
  "main": "party/server.ts",
  "compatibilityDate": "2024-03-20"
}
```

Run the PartyKit process alongside Next.js (typical local pair):

```bash
npx partykit dev
# Next app on :3000, PartyKit on :1999
```

Env vars the server expects:

| Variable | Used for |
| --- | --- |
| `CLERK_SECRET_KEY` | Verify the Clerk JWT on connect |
| `NEXT_PUBLIC_APP_URL` | Call `/api/partykit/auth` (defaults to `http://127.0.0.1:3000`) |
| `NEXT_PUBLIC_PARTYKIT_URL` | Server-to-server posts (refresh); defaults to `http://127.0.0.1:1999` |

The default export is `WorkspaceServer` implementing `Party.Server`. Each room gets its own instance with in-memory state (seat check-ins live only for that room’s lifetime).

---

## Room management

Room ids are strings. Clients pick the room when opening a socket.

| Room id pattern | Purpose |
| --- | --- |
| `folder-{folderId}` | Shared folder doc (Yjs) + presence for that collection |
| `seat-availability` | Global seat check-in / ring updates (not tied to a folder) |
| other / `default` | Fallback when `useMultiplayerSession` has no room id yet |

Examples:

```ts
// Folder collaboration
usePartySocket({ host: "127.0.0.1:1999", room: `folder-${id}`, ... });

// Map seat rings — dedicated room, separate from Yjs folders
usePartySocket({ host: "127.0.0.1:1999", room: "seat-availability", ... });
```

HTTP refresh from the Next API (best-effort):

```
POST {PARTYKIT_URL}/parties/main/folder-{id}
Body: { "type": "refresh" }
```

Clients listening on that room refetch folder data when they see `type: "refresh"`.

---

## Authentication (token passing)

Tokens are **not** sent as headers on the WebSocket upgrade. Clients pass a Clerk session JWT as a **query param** named `token`.

### Client

```ts
const { getToken } = useAuth();
const token = await getToken();

usePartySocket({
  host: "127.0.0.1:1999",
  room: `folder-${folderId}`,
  query: token ? { token } : undefined,
});

// Yjs provider — same idea via params
new YProvider("127.0.0.1:1999", roomId, doc, {
  params: token ? { token } : {},
});
```

### Server (`onConnect`)

1. Read `token` from `ctx.request.url` search params.
2. If missing → treat connection as **VIEWER** (read-only).
3. If present → `verifyToken(token, { secretKey: CLERK_SECRET_KEY })` (`@clerk/backend`).
4. Strip `folder-` prefix from `room.id` when looking up membership.
5. `GET {NEXT_PUBLIC_APP_URL}/api/partykit/auth?userId=...&folderId=...`
6. Roles:
   - `MEMBER` / `VIEWER` from membership → connection role **VIEWER** (read-only Yjs)
   - anything else that isn’t those (e.g. owner / editor path) → **EDITOR**
   - auth API failure or bad token → fail closed to **VIEWER**

Connection state:

```ts
conn.setState({ role: isViewer ? "VIEWER" : "EDITOR" });
```

Yjs is wired with `readOnly: isViewer` so viewers cannot push doc updates.

`/api/partykit/auth` returns `{ role }` from `folderMember` or folder owner (`OWNER`). Missing membership → `{ role: "VIEWER" }`. This route is intended as an internal PartyKit helper; production should lock it down with a shared secret.

---

## Message schema

All application messages are JSON strings over the socket (Yjs binary traffic is separate and handled by `y-partykit`).

### Presence / UI signals

| `type` | Direction | Notes |
| --- | --- | --- |
| `presence` | client → room | Broadcast to others (exclude sender) |
| `cursor` | client → room | Same as presence |
| `typing` | client → room | Broadcast; allowed for all roles |

### Seat availability (#703)

Client → server:

```ts
{ type: "seat_checkin", venueId: string, capacity?: number }
{ type: "seat_checkout" }
```

Server → clients:

```ts
{
  type: "seat_update",
  venueId: string,
  count: number,
  capacity: number,
  status: "green" | "yellow" | "red"  // <60% green, 60–99% yellow, ≥100% red
}

{
  type: "seat_snapshot",
  venues: Array<{ venueId, count, capacity, status }>
}
```

`seat_snapshot` is sent to a new connection if the room already has check-ins, so rings paint correctly before the next update.

Default capacity when not provided: **8**.

### Folder refresh

```ts
{ type: "refresh" }
```

Used from Next → PartyKit HTTP POST and from clients after local mutations. Listening UIs call `fetchFolder()` (or equivalent).

### Role gate

- `typing`, `seat_checkin`, `seat_checkout` — not blocked for VIEWER.
- Other JSON broadcasts — dropped if `sender.state.role === "VIEWER"`.
- Non-JSON / non-Yjs payloads — only EDITOR can broadcast.

---

## Presence tracking

Two layers share the same Party room:

1. **Lightweight JSON** — `presence`, `cursor`, `typing` fan out via `room.broadcast(..., [sender.id])`.
2. **Seat check-ins** — `Map<connectionId, { venueId, capacity, checkedInAt }>` on the server. One check-in per connection. Switching venues updates the old venue’s count too. Disconnect / `seat_checkout` clears the entry.

Seat presence uses the `seat-availability` room so it stays independent of any folder’s Yjs document.

---

## Room lifecycle handlers

Implemented on `WorkspaceServer` in `party/server.ts`:

### `onConnect(conn, ctx)`

- Resolve auth → set `VIEWER` / `EDITOR` on connection state.
- Optionally send `seat_snapshot`.
- Attach Yjs via `onConnectYjs(conn, room, { gc: true, readOnly })`.
- Extra message listener for `presence` / `cursor` broadcast.

### `onMessage(message, sender)`

- Parse JSON when possible.
- Route `typing`, seat check-in/out.
- Enforce VIEWER drop for other edits / broadcasts.
- EDITOR messages broadcast to the rest of the room.

### `onClose(conn)`

- Run seat checkout for that connection so occupancy doesn’t stick after leave.

There is no durable room persistence beyond the live PartyKit isolate — seat maps reset when the room worker is recycled.

---

## Reconnect protocol

Clients use **PartySocket** (`partysocket` / `partysocket/react`). It reconnects automatically after drops (built-in backoff). App code does not implement a custom PartyKit retry loop the way SSE does in `useRealTimeUpdates`.

What matters on reconnect:

1. **New `onConnect`** runs again — token re-checked, role re-applied, Yjs re-synced.
2. **Seat snapshot** — if anyone is still checked in, the reconnecting client gets `seat_snapshot` immediately.
3. **Stale seats** — previous connection’s `onClose` already cleared that connection’s check-in. After reconnect the client must `seat_checkin` again if it still wants to count as present (`useSeatAvailability` tracks local check-in and sends checkout on unmount).
4. **Token refresh** — hooks load Clerk `getToken()` into React state and pass it as `query.token`. If the token is missing, the socket still connects but as VIEWER.
5. **Folder HTTP refresh** — `POST /api/folders/[id]/refresh` aborts after 2s if PartyKit is down; UI still returns success so a dead PartyKit process doesn’t block the API.

Practical tip: keep PartyKit (`npx partykit dev`) running while developing collections or map seat rings. If the host is wrong, sockets fail silently until reconnect succeeds.

---

## Related files (quick map)

```
partykit.json
party/server.ts
src/app/api/partykit/auth/route.ts
src/app/api/folders/[id]/refresh/route.ts
src/hooks/useRealTime.tsx          # useMultiplayerSession + YProvider
src/hooks/useSeatAvailability.ts   # seat room client
src/app/collections/[id]/page.tsx  # folder room + refresh listener
src/components/Map.tsx             # consumes seat availability
```
