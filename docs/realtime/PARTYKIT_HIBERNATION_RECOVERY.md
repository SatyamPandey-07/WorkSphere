# PartyKit Hibernation Recovery & Lock Revalidation

## 1. PartyKit Room Lifecycle: Connection, Hibernation, Wake-Up, and Flush

PartyKit edge rooms manage WebSocket peers, in-memory CRDT state, and durable snapshots across idle intervals:

1. **Active connection & sync:** Peers connect over WebSockets to `partykit/server.ts`, receive the current CRDT state vector/snapshot, and exchange incremental updates and seat hold requests.
2. **Idle hibernation:** When no active connections or pending timers remain for the idle window, the edge runtime hibernates the room instance while preserving durable storage and external Redis lease state.
3. **Cold wake-up:** A new incoming WebSocket connection or alarm wakes the room into a fresh runtime isolate. In-memory CRDT structures and cached lock views start cold and must be rehydrated before accepting authoritative state mutations.
4. **Persistent storage flushing:** Durable CRDT snapshots and pending state deltas are flushed to persistent storage on clean checkpoints, prior to or alongside hibernation, and coalesced after wake-up to avoid write amplification.

---

## 2. Wake-Up & Redlock Fencing Token Revalidation Sequence

When a hibernated room wakes on a new peer connection, in-memory seat hold state is reconciled against Redis using Redlock fencing tokens (`src/features/seats/seatHoldService.ts`) so a paused/hibernated worker or slow network call cannot commit a stale hold after lease expiry or re-acquisition.

```text
Peer A            PartyKit Server (Wake-Up)       Redis (Redlock)         SeatHoldService
  |                        |                           |                        |
  |-- WS Connect / Join -->|                           |                        |
  |                        |-- Load CRDT Snapshot ---->|                        |
  |                        |<-- Snapshot + Updates ----|                        |
  |                        |-- Revalidate Holds ------------------------------>|
  |                        |                           |-- GET / FENCING ------>|
  |                        |                           |<-- Token #42 (TTL) ----|
  |                        |<-- Hydrated Holds + Fencing Token #42 -----------|
  |<-- Sync + Hold State --|                           |                        |
  |                        |                           |                        |
  |-- Seat Hold Mutation (fencingToken = 42) --------->|                        |
  |                        |-- Compare & Set if token >= currentToken -------->|
  |                        |   (Reject if stale token < currentToken)         |
  |<-- ACK / Conflict -----|                           |                        |