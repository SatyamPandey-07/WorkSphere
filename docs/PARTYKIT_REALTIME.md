\# PartyKit Real-Time Integration Guide

This document explains how WorkSphere uses \[PartyKit](https://www.partykit.io/) for real-time features (presence, cursors, seat availability, WebRTC signaling, collaborative editing), how connections are authenticated, the message formats in use, and how to safely add a new real-time feature.

\## Overview

PartyKit provides one WebSocket "room" per session/document. WorkSphere runs two server implementations:

\- \*\*`party/server.ts`\*\* — the main real-time server: connection auth, presence/cursors, seat availability, WebRTC signaling, Yjs sync.

\- \*\*`party/multiRegionServer.ts`\*\* — an enhanced version of the same server that adds edge geolocation routing and cross-region state sync via `DurableStateSync` (`src/lib/edge/geoRouter.ts`, `src/lib/edge/stateSync.ts`), aiming for low-latency presence across regions (`us-east-1`, `us-west-1`, `eu-west-1`, etc.).

On the client, every real-time feature connects via the `usePartySocket` hook from `partysocket/react`. Current consumers include:

| Hook / Component | Purpose |

|---|---|

| `src/components/chat/ChatHeader.tsx` | Connection status indicator |

| `src/components/Map.tsx` | Map marker/cursor sync |

| `src/components/sessions/Scratchpad.tsx` | Collaborative scratchpad |

| `src/hooks/useSeatAvailability.ts` | Seat check-in/checkout presence |

| `src/hooks/useWebRTCMesh.ts` | WebRTC signaling for mesh calls |

| `src/hooks/useMeshDataChannels.ts` | WebRTC data channels |

| `src/hooks/useScreenShare.ts` | Screen-share signaling |

| `src/hooks/useMultiRegion.ts` | Multi-region connection handling |

| `src/hooks/usePartySocketReconnect.ts` | Reconnect wrapper/logic |

| `src/hooks/useRealTime.tsx` | General-purpose real-time hook |

| `src/app/collections/\[id]/page.tsx` | Collection collaboration |

\## Connection Lifecycle

\### 1. Client connects (`usePartySocket`)

The client opens a WebSocket to a PartyKit room, identified by a room id (e.g. a conversation id, `folder-{id}`, or `canvas-{id}`). An auth `token` (Clerk session token) is passed as a query parameter on the connection URL.

\### 2. Server authenticates (`onConnect` in `party/server.ts`)

On connect, the server:

1\. Reads the `token` query parameter from the connection URL.

2\. If a token is present, verifies it with `verifyToken` from `@clerk/backend` using `CLERK\_SECRET\_KEY`.

3\. Determines the connection's \*\*role\*\*:

&#x20; - Rooms prefixed `canvas-` → any authenticated user is an `EDITOR`.

&#x20; - Other rooms named `folder-{id}` → the server calls an internal API (`/api/partykit/auth?userId=...\&folderId=...`) to look up the user's role in that folder. `MEMBER`/`VIEWER` roles become a `VIEWER` connection; anything else becomes `EDITOR`.

&#x20; - No token at all → the connection is treated as a `VIEWER`.

4\. If token verification fails, the connection is closed immediately with code `4001` ("Unauthorized: Token expired").

5\. The resolved `{ role, userId }` is stored via `conn.setState(...)` and used for authorization checks on every subsequent message.

\### 3. Initial sync

\- If there's existing seat check-in data for the room, the server immediately sends a `seat\_snapshot` message so the new client's UI renders correct state before any live update arrives.

\- The connection is also registered with \*\*Yjs\*\* (`onConnectYjs` from `y-partykit`) for document/shared-state sync (e.g. messages, map markers), with `readOnly` set based on the viewer/editor role — so viewers cannot push document edits even if they send raw Yjs updates.

\### 4. Heartbeat / disconnect detection

The server runs a 10-second interval per room:

\- If a connection hasn't sent a `pong` in ≥10s, the server sends it a `ping`.

\- If a connection hasn't sent a `pong` in >30s, the server broadcasts a `peer-leave` message (if it has the connection's display name) and force-closes the connection.

On `onClose`, the server clears any seat check-in the connection held (so it stops counting toward that venue's occupancy) and removes its heartbeat tracking state.

\## Message Format

All messages are JSON strings with a `type` field. Non-JSON messages are assumed to be Yjs binary/document updates and are passed through instead of parsed.

| `type` | Direction | Purpose | Notes |

|---|---|---|---|

| `presence` / `cursor` | client → server → others | Live cursor/presence broadcast | Server requires `data.userId` to match the verified connection's `userId` before rebroadcasting |

| `typing` | client → others | Typing indicator | Broadcast to all other connections in the room |

| `ping` / `pong` | server ↔ client | Heartbeat | Client responds to `ping` with `pong`; server also sends its own `ping`s on the 10s interval |

| `webrtc-signal` | client → others | WebRTC offer/answer/ICE signaling | `parsed.from` must match the verified `userId`, or the message is dropped |

| `spatial\_listener\_update` | client → others | Spatial audio listener position | `parsed.userId` must match the verified `userId` |

| `seat\_checkin` | client → server | Mark a user as checked in at a venue | Requires `venueId` (string); `capacity` optional. Allowed for viewers (presence, not a document edit) |

| `seat\_checkout` | client → server | Clear a user's seat check-in | Allowed for viewers |

| `seat\_update` | server → all | Broadcast after a check-in/checkout changes a venue's count | Includes `venueId`, `count`, `capacity`, `status` (`green`/`yellow`/`red`), `epoch`, `sequenceId` |

| `seat\_snapshot` | server → new client | Full seat-state snapshot sent right after connecting | Includes `venues` (array of per-venue summaries), `epoch`, `sequenceId` |

| `request\_room\_snapshot` / `request\_snapshot` | client → server | Ask for the current room state | Server replies with `room\_snapshot\_response` including `seats` |

| `room\_snapshot\_response` | server → requester | Response to a snapshot request | Includes `roomId`, `snapshotId`, `timestamp`, `seats` |

| `peer-leave` | server → all | Announces a connection was force-closed due to a missed heartbeat | Includes the connection's `name` if known |

\*\*Authorization rule of thumb:\*\* any message type not explicitly whitelisted for viewers is dropped if the sender's role is `VIEWER` (see the role gate near the end of `onMessage`). Only presence-like types (`seat\_checkin`, `seat\_checkout`, `webrtc-signal`, `spatial\_listener\_update`) are deliberately exempted, since they aren't document edits.

\*\*Seat availability status\*\* is computed as:

\- `count / capacity >= 1` → `red`

\- `count / capacity >= 0.6` → `yellow`

\- otherwise → `green`

\- `capacity <= 0` is treated as `red`

\## Multi-Region Considerations (`party/multiRegionServer.ts`)

The multi-region server extends the same message handling with:

\- \*\*Geo routing\*\* — incoming requests are matched to the nearest `RegionNode` (e.g. `us-east-1`, `us-west-1`, `eu-west-1`) via `resolveRegion`/`selectBestNode`, using geo headers extracted by `extractGeoFromHeaders`.

\- \*\*Cross-region state sync\*\* — `DurableStateSync` (`src/lib/edge/stateSync.ts`) propagates state (like seat check-ins) across regions so presence stays consistent regardless of which region a client lands on.

If you're adding a feature that must work correctly across regions (not just within one PartyKit room instance), you need to consider whether it belongs in `multiRegionServer.ts` as well as `server.ts`, and whether it needs to go through `DurableStateSync`.

\## How to Add a New Real-Time Feature

1\. \*\*Decide if it's presence-like or a document edit.\*\*

&#x20; - Presence-like (ephemeral, latest-value-wins — e.g. cursor position, "who's in the room", live status) → follow the `seat\_checkin`/`cursor` pattern: a simple `type`-tagged message, validated against the sender's verified `userId`, and either broadcast directly or aggregated server-side before broadcasting.

&#x20; - Document edit (needs persistence/conflict resolution — e.g. shared text, shared canvas) → use the existing Yjs integration rather than inventing a new ad-hoc sync mechanism.

2\. \*\*Add a new `type` to the message format table above\*\* and implement handling in `onMessage` in `party/server.ts`:

&#x20; - Validate any user-supplied identifiers (`userId`, `venueId`, etc.) against `sender.state` — never trust the client-supplied value alone for anything security-relevant.

&#x20; - Decide whether `VIEWER` connections should be allowed to send this message type. If yes, add an explicit early-return before the general `role === "VIEWER"` gate (as `seat\_checkin`/`webrtc-signal` do); if no, let the existing gate drop it.

3\. \*\*On the client, use `usePartySocket`\*\* (see any of the hooks listed above for a working example) and send/receive your new `type` over the existing connection — avoid opening a second WebSocket connection for a new feature if an existing room connection is already available in that part of the tree.

4\. \*\*If the feature needs to survive reconnects or brief disconnects,\*\* consider whether it needs a "snapshot" message (like `seat\_snapshot`) sent on connect, similar to how seat availability re-syncs new clients immediately.

5\. \*\*If the feature must work identically across regions,\*\* update `party/multiRegionServer.ts` as well, and check whether the new state needs to flow through `DurableStateSync`.

6\. \*\*Write a test.\*\* See `party/\_\_tests\_\_/server.heartbeat.test.ts` and `src/\_\_tests\_\_/party/seat-race.test.ts` for examples of testing PartyKit server behavior (heartbeat handling and concurrent seat check-in race conditions, respectively).
