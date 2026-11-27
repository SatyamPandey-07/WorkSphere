# Live Folder ACL Revocation Across Active PartyKit WebSocket Connections

Live folder ACL revocation combines short-lived **Folder ACL Leases** (`src/lib/realtime/folderAclLease.ts`) with **PartyKit Connection Authorization** (`src/app/api/partykit/auth/route.ts`). Active PartyKit connections hold a time-bounded lease over a `folderId` and `aclVersion`. When permissions change or are revoked, the room broadcasts an invalidation notice and closes affected sockets, forcing re-authorization against `/api/partykit/auth` before any subsequent room events are accepted.

## 1. Lease TTL Lifecycle (`src/lib/realtime/folderAclLease.ts`)

Each active subscriber on a folder receives a lease scoped to `(userId, folderId, roomId, aclVersion)`:

* **Time-To-Live (TTL):** Leases are issued with a finite `ttlMs` (`expiresAtMs = issuedAtMs + ttlMs`) plus explicit `revokedAtMs` and `revokedReason` metadata.
* **Validity & Renewal Checks:** A lease is valid only when `nowMs < expiresAtMs` and `revokedAtMs === undefined`. Room coordinators renew active leases prior to `expiresAtMs`; once expired, read/write/presence operations gated by that lease are rejected until a fresh lease is minted.
* **Monotonic ACL Version:** Every ACL mutation increments or updates the folder's `aclVersion`. Any lease bound to an older `aclVersion` or matching a revoked `(userId, folderId)` pair is immediately invalidated.

## 2. Revocation Broadcast & Socket Termination (`src/app/api/partykit/auth/route.ts`)

When an administrator or owner revokes or downgrades a user's folder access:

1. **Lease Invalidation:** `folderAclLease` revokes the target `(userId, folderId)` lease and increments `aclVersion`, immediately rejecting subsequent lease checks.
2. **Revocation Broadcast:** The PartyKit room dispatches a revocation message (`{ type: 'acl:revoked', folderId, userId, aclVersion, reason }`) to active connections subscribed to that folder so clients drop cached folder state immediately.
3. **Connection Closure:** Active WebSocket connections belonging to the revoked `userId` (or bound to a stale `aclVersion`) are closed from the server with close code `1008` (Policy Violation) or `4003` (Unauthorized / Revoked).

## 3. Reconnect & Re-Authorization Behavior

PartyKit clients (`PartySocket`) automatically attempt reconnection after a non-normal close unless halted by application policy:

* **Auth Gate on Reconnect:** On reconnect, the client requests a fresh session/connection token from `src/app/api/partykit/auth/route.ts`.
* **Fresh ACL Evaluation:** `/api/partykit/auth/route.ts` verifies the caller's session and evaluates current folder ACLs and lease status:
  * **Still revoked:** Returns `401`/`403` without minting a lease, blocking re-entry into restricted folder rooms.
  * **Restored or re-scoped:** Issues a new token and mints a fresh `folderAclLease` with the updated `aclVersion` and `ttlMs`, allowing the WebSocket connection to resume cleanly.

## 4. Sequence Diagram

``text
Client (PartySocket)      /api/partykit/auth          folderAclLease           PartyKit Room (WS)
       |                         |                         |                         |
       |-- 1. Request auth ----->|                         |                         |
       |                         |-- 2. Mint lease (TTL) ->|                         |
       |                         |<-- Lease + aclVersion --|                         |
       |<-- 3. Auth token/lease -|                         |                         |
       |                         |                         |                         |
       |======================== 4. Active WebSocket stream (valid lease) ===========>|
       |                         |                         |                         |
       |                         |   [Folder ACL Revoked]  |                         |
       |                         |-- 5. Revoke lease ----->|                         |
       |                         |                         |-- 6. Broadcast revoke ->|
       |<======================== 7. `acl:revoked` event & WS close (1008/4003) =====|
       |                         |                         |                         |
       |-- 8. Auto-reconnect --->|-- 9. Re-check ACL ----->|                         |
       |                         |<-- Denied / New lease --|                         |
       |<-- 10. 403 or new token-|                         |                         |
       |                         |                         |== 11. Re-open if allowed|
``