# Distributed Redlock and Fencing

> **Current integration status:** This document describes the Redlock quorum
> model and the resource-side fencing requirement. It is not a description of
> one active, end-to-end seat-lock protocol. See the
> [unified lock state-machine specification](./DISTRIBUTED_LOCKS_STATE_MACHINE.md)
> for the source audit, current paths, failure behavior, and implementation gaps.

## 1. Relationship between Redlock leases and fencing

A Redlock lease can coordinate contenders while its lease assumptions hold. It
does not, by itself, stop a paused process from resuming after lease expiry and
writing to a protected resource. Fencing requires the resource itself to reject
stale lease generations.

The inspected repository has separate implementations that must not be
conflated:

- The active seat-lock HTTP path in `seatHoldLock.ts` uses a configured Redis
  client and a Lua lock script, with a process-local memory fallback when Redis
  is absent or an acquisition operation fails. It is not configured as a
  multi-node Redlock lock path by the inspected application code.
- The configured PartyKit entry point uses its own in-room seat-hold map and
  room storage. It does not use the HTTP lock key or a fencing token.
- The reservation API uses PostgreSQL transactions and row locks. It does not
  receive or validate the seat-hold fencing token.
- `RedlockManager` and other quorum helpers are separate utilities. No
  production call from the current `/api/reservations/book` route to
  `bookSeatWithAdvisoryLock()` was found.

The token high-water SQL shown below is therefore a **proposed pattern**, not
current PostgreSQL enforcement. Existing database transaction controls provide
reservation concurrency protection independently of fencing.

## 2. Quorum and lease timing

For `N` independent nodes, the Redlock majority is:

```text
Q = floor(N / 2) + 1
```

This formula is implemented by the separate Redlock utilities. It is not a
claim that the active PartyKit or HTTP seat-hold path uses a quorum.

The usable validity period must account for elapsed acquisition time, clock
drift, and network delay:

```text
remaining validity = TTL - acquisition_elapsed - clock_drift - network_delay
```

If the remaining validity is zero or negative, acquisition or renewal must
fail closed. Elapsed time should be measured with a monotonic clock. The
`RedlockManager` utility uses `performance.now()`, a drift factor, a 2 ms
allowance, and per-node timeouts. The PartyKit hold path uses `Date.now()`-based
expiry timestamps and a periodic cleanup sweep; the active HTTP path sets a
Redis TTL and stores a calculated drift allowance, but no production caller was
found that uses `assertLockLeaseValid()` to authorize the booking write.

## 3. Resource-side fencing rule

**Proposed:** Maintain a durable high-water token for every protected resource.
In the same database transaction as the protected mutation, compare the
incoming token with the stored value, reject a lower token, advance the
high-water mark when a higher token is accepted, and apply the mutation
atomically.

An illustrative conditional update is:

```sql
UPDATE seat_allocations
SET status = 'HELD',
    fencing_token = $1,
    updated_at = NOW()
WHERE seat_id = $2
  AND (fencing_token IS NULL OR $1 > fencing_token);
```

The caller must treat an update affecting zero rows as a stale-token rejection.
The data mutation and high-water advancement must be part of the same
transaction. Equal tokens require an explicit same-lease and idempotency policy;
they should not be accepted merely because the number is equal.

No `seat_allocations` fencing model or equivalent high-water field was found in
the inspected Prisma schema, and this SQL is not called by the active booking
route. The presence of standalone fencing helpers does not establish
resource-side enforcement.

## 4. References

- [Unified distributed-locking and fencing-token state machine](./DISTRIBUTED_LOCKS_STATE_MACHINE.md)
- [Redlock fencing-token protocol](./REDLOCK_FENCING_TOKENS.md)
- [Seat-hold lock implementation](../../src/lib/locks/seatHoldLock.ts)
- [Redlock manager](../../src/lib/redis/RedlockManager.ts)
- [Booking engine helper](../../src/lib/reservations/bookingEngine.ts)
- [Reservation API](../../src/app/api/reservations/book/route.ts)
- [Prisma schema](../../prisma/schema.prisma)
