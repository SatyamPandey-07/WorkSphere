# PartyKit Seat Reservation Concurrency Protocol

This document describes how WorkSphere resolves race conditions when multiple users attempt to check in to the same venue seat simultaneously on a PartyKit server.

---

## Overview

Each PartyKit server instance maintains two in-memory data structures for a venue's seat state:

| Structure | Purpose |
|-----------|---------|
| `seatCheckins: Map<connId, SeatCheckin>` | Records which connection is checked in to which venue, along with a monotone `version` counter |
| `seatCheckinLocks: Set<connId>` | Per-connection mutex — prevents interleaved operations on the same connection |

The concurrency model combines:
1. **Per-connection locking** — prevents a second check-in operation on the same connection while one is already in flight
2. **Optimistic concurrency control** — a `version` counter on each `SeatCheckin` document detects concurrent modifications; the operation retries up to 3 times on conflict

---

## Sequence Diagram — Successful Check-in

```mermaid
sequenceDiagram
    participant ClientA as Client A (conn-a)
    participant ClientB as Client B (conn-b)
    participant Party as PartyKit Server

    ClientA->>Party: seat_checkin { venueId: "v1", capacity: 20 }
    ClientB->>Party: seat_checkin { venueId: "v1", capacity: 20 }

    Note over Party: Both messages arrive concurrently.<br/>PartyKit processes them sequentially<br/>within a single server instance.

    Party->>Party: Lock conn-a (seatCheckinLocks.add)
    Party->>Party: Read seatCheckins[conn-a] → version 0
    Party->>Party: No concurrent modification → write version 1
    Party->>Party: Unlock conn-a (seatCheckinLocks.delete)
    Party-->>ClientA: seat_update { venue: "v1", occupancy: 1 }
    Party-->>ClientB: seat_update (broadcast)

    Party->>Party: Lock conn-b (seatCheckinLocks.add)
    Party->>Party: Read seatCheckins[conn-b] → version 0
    Party->>Party: No concurrent modification → write version 1
    Party->>Party: Unlock conn-b
    Party-->>ClientA: seat_update (broadcast)
    Party-->>ClientB: seat_update { venue: "v1", occupancy: 2 }
```

---

## Sequence Diagram — Optimistic Lock Conflict and Retry

```mermaid
sequenceDiagram
    participant ClientA as Client A (conn-a)
    participant Party as PartyKit Server

    ClientA->>Party: seat_checkin (attempt 1)
    Party->>Party: Lock conn-a
    Party->>Party: Read version 0
    Party->>Party: Another fiber modifies conn-a → version 1
    Party->>Party: Check: current.version (1) ≠ expectedVersion (0)
    Party->>Party: Conflict detected → continue to next attempt
    Party->>Party: Unlock conn-a

    Party->>Party: Retry attempt 2
    Party->>Party: Lock conn-a
    Party->>Party: Read version 1 (current)
    Party->>Party: Write version 2 → success
    Party->>Party: Unlock conn-a
    Party-->>ClientA: seat_update (broadcast)
```

---

## Sequence Diagram — Check-out on Disconnect

```mermaid
sequenceDiagram
    participant Client as Client (conn-x)
    participant Party as PartyKit Server

    Client->>Party: WebSocket close
    Party->>Party: onClose(conn-x)
    Party->>Party: seatCheckins.delete(conn-x)
    Party->>Party: seatCheckinLocks.delete(conn-x)
    Party-->>Client: (connection closed)
    Party->>Party: broadcastSeatUpdate(venueId)
    Note over Party: Occupancy count decremented.<br/>All connected clients receive updated seat count.
```

---

## Key Properties

| Property | Value |
|----------|-------|
| Max retries per check-in | 3 |
| Default seat capacity (no client value) | `DEFAULT_SEAT_CAPACITY` |
| Version counter | Per-connection monotone integer, starts at 0 |
| Lock scope | Per-connection (not per-venue) |
| Broadcast trigger | After every successful check-in or check-out |

---

## Source Reference

`party/server.ts` — `handleSeatCheckin()` method starting at line ~314.
