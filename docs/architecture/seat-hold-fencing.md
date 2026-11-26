# Monotonic Fence Token Invariant on Seat Hold Lock Extensions

## 1. Overview & Architectural Problem

In high-concurrency seat reservation systems, double-booking and split-brain states occur when a seat hold lease extension request arrives out-of-order, is replayed, or is processed after the original lease has already expired and been re-acquired by a different user.

To eliminate this vulnerability without introducing distributed deadlocks, WorkSphere enforces a **Monotonic Fence Token Invariant** across `src/lib/locks/seatHoldLock.ts` and `src/features/seats/seatHoldService.ts`.

---

## 2. What a Seat Hold Fence Token Represents

A **seat hold fence token** is an opaque, strictly increasing monotonic 64-bit integer (`bigint` serialized as a decimal string in JSON payloads). 

- **Causal Ordering:** It represents the total logical generation of a hold on a specific seat resource (`seat:hold:{venueId}:{seatId}`).
- **Authority:** A client presenting a fence token is asserting that it possesses the lease issued at that specific generation.
- **Lease Invalidation:** Any token numerically lower than or equal to the high-water mark stored in the active lock represents a superseded, stale, or expired lease.

---

## 3. Monotonic Token Generation (`src/lib/locks/seatHoldLock.ts`)

Fence tokens are generated using `nextMonotonicFencingToken()` in `src/lib/locks/seatHoldLock.ts`:

```typescript
let monotonicFencingSeq: bigint = BigInt(0);

export function nextMonotonicFencingToken(
  previousToken?: bigint | string | number,
): bigint {
  const prev =
    typeof previousToken === "bigint"
      ? previousToken
      : previousToken !== undefined && previousToken !== null
        ? BigInt(previousToken)
        : BigInt(0);
  const candidate = monotonicFencingSeq + BigInt(1);
  const next = candidate > prev ? candidate : prev + BigInt(1);
  monotonicFencingSeq = next;
  return next;
}
```

### Invariants:
1. **Strict Monotonicity:** Every generated token is guaranteed to be strictly greater than both the previous sequence counter and any observed `previousToken` ($T_{next} > T_{prev}$).
2. **64-bit BigInt Safety:** Immune to 32-bit integer overflow and JavaScript `MAX_SAFE_INTEGER` precision truncation.
3. **Cluster Quorum Fencing:** When Redis multi-node Redlock clusters are configured (`acquireQuorumFencingToken`), sequence counters use atomic Redis `INCR` commands across majority nodes ($N/2 + 1$) to preserve monotonic ordering across master failovers.

---

## 4. Atomic Lock Extension Semantics: Redis Lua Script

When a client attempts to extend a seat hold (via `POST /api/venues/[venueId]/seats/[seatId]/lock/extend`), the operation executes inside an atomic Redis Lua script (`SEAT_HOLD_EXTEND_FENCE_LUA` / `SEAT_LOCK_EXTEND_LUA`).

### 4.1 Redis Lua Script Implementation

```lua
local current = redis.call('GET', KEYS[1])
if not current then
  return { 0, "MISSING" }
end

local ok, decoded = pcall(cjson.decode, current)
if not ok or type(decoded) ~= 'table' then
  return { 0, "MISSING" }
end

-- 1. Ownership validation
if decoded.userId ~= ARGV[1] then
  return { -1, "NOT_OWNER" }
end

local incomingToken = tonumber(ARGV[2])
if not incomingToken or incomingToken <= 0 then
  return { -3, "INVALID_TOKEN" }
end

local currentToken = tonumber(decoded.fencingToken) or 0

-- 2. Monotonic fence token invariant check
if incomingToken <= currentToken then
  return { -2, "STALE_TOKEN", tostring(currentToken) }
end

-- 3. Atomic state update & TTL extension
decoded.fencingToken = tostring(incomingToken)
decoded.expiresAt = tonumber(ARGV[3])
decoded.version = (tonumber(decoded.version) or 1) + 1

local updated = cjson.encode(decoded)
redis.call('SET', KEYS[1], updated, 'EX', tonumber(ARGV[4]))
return { 1, updated }
```

### 4.2 Script Arguments and Keys:
- `KEYS[1]`: Lock key (`seat:hold:{venueId}:{seatId}`).
- `ARGV[1]`: Authenticated `userId` requesting the extension.
- `ARGV[2]`: Supplied incoming `fencingToken`.
- `ARGV[3]`: New absolute expiration timestamp (`newExpiresAt` in ms).
- `ARGV[4]`: New TTL in seconds (`clampedTtl`).

---

## 5. In-Memory Fallback Behavior

When Redis is unconfigured or offline (local development / offline testing), `seatHoldService.ts` and `seatHoldLock.ts` fall back to an atomic in-memory validation path:

1. Retrieves active lock via `getSeatWebLock(venueId, seatId)`.
2. Validates lock existence: If absent or expired (`Date.now() >= existing.expiresAt`), returns `{ status: "REJECTED", reason: "MISSING" }`.
3. Validates ownership: If `existing.userId !== userId`, returns `{ status: "REJECTED", reason: "NOT_OWNER" }`.
4. Validates monotonic invariant: Compares `parsedIncoming <= currentToken`. If true, rejects with `{ status: "REJECTED", reason: "STALE_TOKEN", currentFencingToken: currentToken.toString() }`.
5. Updates lock state: Bumps `version = (existing.version ?? 1) + 1`, updates `fencingToken` to incoming token, extends `expiresAt`, and saves into `memoryLocks`.

---

## 6. Success and Rejection Conditions

| Status | Reason Code | HTTP Status | Description |
| :--- | :--- | :--- | :--- |
| `EXTENDED` | *None* | `200 OK` | Incoming token is valid, owner matches, and `incomingToken > currentToken`. TTL extended. |
| `REJECTED` | `STALE_TOKEN` | `409 Conflict` | Incoming token is $\le$ the currently stored token. Request was delayed, replayed, or superseded. |
| `REJECTED` | `NOT_OWNER` | `403 Forbidden` | Lock exists but is held by a different `userId`. |
| `REJECTED` | `MISSING` / `NOT_FOUND` | `404 Not Found` | Seat lock has already expired or was released. |
| `REJECTED` | `INVALID_TOKEN` / `MISSING_FENCE_TOKEN` | `400 Bad Request` | Supplied token is missing, null, non-numeric, or $\le 0$. |
| `REJECTED` | `ALREADY_EXTENDED` | `409 Conflict` | Single-extension policy: lock has already used its checkout extension quota. |
| `REJECTED` | `TOO_CLOSE_TO_EXPIRY` | `409 Conflict` | Remaining lease TTL is $\le 60$ seconds (extension window closed). |

---

## 7. Sequence Diagram: Stale vs. Valid Extension Race Condition

The following sequence diagram illustrates how monotonic fencing prevents stale or out-of-order extension requests from reviving or overwriting active seat holds:

```mermaid
sequenceDiagram
    autonumber
    actor Alice as User Alice (Holder 1)
    actor Bob as User Bob (Holder 2)
    participant API as /api/.../seats/{id}/lock/extend
    participant Redis as Redis / Lock Manager

    Note over Alice,Redis: Step 1: Alice acquires seat hold
    Alice ->> Redis: acquireSeatWebLock(venueId, seatId, "user-alice")
    Redis -->> Alice: Lock Acquired: fencingToken = "101", expiresAt = T1

    Note over Alice,Bob: Step 2: Alice's lease expires; Bob acquires seat
    Alice -x Alice: Network Lag / Tab Backgrounded
    Redis ->> Redis: Lease expires (TTL reaches 0)
    Bob ->> Redis: acquireSeatWebLock(venueId, seatId, "user-bob")
    Redis -->> Bob: Lock Acquired: fencingToken = "102", expiresAt = T2

    Note over Alice,Redis: Step 3: Alice awakens and attempts delayed extension
    Alice ->> API: POST /lock/extend (userId = "user-alice", token = "101")
    API ->> Redis: EVAL SEAT_HOLD_EXTEND_FENCE_LUA
    Redis ->> Redis: Check: decoded.userId ("user-bob") != "user-alice"
    Redis -->> API: Return {-1, "NOT_OWNER"}
    API -->> Alice: 403 Forbidden ("Seat lock held by another user")

    Note over Alice,Bob: Step 4: Out-of-Order / Stale Token Replay Prevention
    Alice ->> API: POST /lock/extend (spoofed or stale token <= 102)
    API ->> Redis: EVAL SEAT_HOLD_EXTEND_FENCE_LUA (incomingToken <= 102)
    Redis -->> API: Return {-2, "STALE_TOKEN", "102"}
    API -->> Alice: 409 Conflict (STALE_FENCE_TOKEN)

    Note over Bob,Redis: Step 5: Bob extends with strictly higher monotonic token
    Bob ->> API: POST /lock/extend (userId = "user-bob", token = "103")
    API ->> Redis: EVAL SEAT_HOLD_EXTEND_FENCE_LUA (103 > 102)
    Redis ->> Redis: Update lock: fencingToken = "103", new TTL
    Redis -->> API: Return {1, updatedLock}
    API -->> Bob: 200 OK (Extended, expiresAt = T3)
```

---

## 8. Concurrency, Expiry & System Limitations

1. **Clock Skew Tolerances:** Expiration calculations account for dynamic drift via `computeDynamicClockDriftMs()`, ensuring inter-node clock differences do not falsely expire valid leases before quorum verification.
2. **Atomic Single-Roundtrip:** Existence checking, token comparison, and write-back occur in a single Lua execution step in Redis, eliminating check-then-act race windows.
3. **Database Fencing Synchronization:** When booking transactions finalize against PostgreSQL (`verifyAndAdvanceDbFencingToken`), the database checks that the final token submitted is strictly greater than `last_seen_token`, rejecting split-brain checkout writes at the relational layer.
