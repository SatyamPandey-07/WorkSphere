# Reservation Concurrency Guide

## Overview

The WorkSphere reservation API is designed to safely process multiple booking requests for the same seats without creating duplicate reservations. During periods of high traffic, several users may attempt to reserve identical seats simultaneously. To maintain consistency, the booking endpoint combines Prisma interactive transactions, PostgreSQL row-level locking, deterministic seat ordering, Serializable transaction isolation, and automatic retry logic.

These mechanisms ensure that only one transaction can successfully reserve a seat while transient database conflicts are handled safely through retries.

This guide describes the concurrency strategy implemented in `src/app/api/reservations/book/route.ts`.

---

## Reservation Workflow

Each reservation request follows the same sequence:

```text
Client Request
      │
      ▼
Validate Request
      │
      ▼
Normalize & Sort Seat IDs
      │
      ▼
Start Serializable Transaction
      │
      ▼
Acquire Row Locks
      │
      ▼
Load Seats
      │
      ▼
Check Booking Conflicts
      │
      ▼
Create Booking Records
      │
      ▼
Commit Transaction
      │
      ▼
Publish Availability Updates
```

Using a consistent workflow helps ensure reliable booking behavior even when many requests are processed concurrently.

---

## Why Concurrency Protection Is Needed

Without concurrency control, two users could attempt to reserve the same seat at nearly the same time. If both requests read the seat as available before either transaction completes, duplicate reservations could be created.

To prevent this, the reservation endpoint locks the requested seat records before checking availability. This ensures only one transaction can reserve a seat while competing requests wait or fail safely.

---

## Interactive Prisma Transactions

Reservations are processed using Prisma's interactive transaction API.

```ts
await prisma.$transaction(
  async (tx) => {
    // Reservation logic
  },
  {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  },
);
```

Interactive transactions execute multiple database operations within a single transaction. If any step fails, all changes are rolled back, preventing partial reservations and keeping booking data consistent.

---

## Serializable Transaction Isolation

The reservation endpoint uses the **Serializable** isolation level:

```ts
Prisma.TransactionIsolationLevel.Serializable
```

Serializable is PostgreSQL's strongest isolation level and ensures concurrent transactions behave as though they execute one after another.

This helps prevent:

* Dirty reads
* Non-repeatable reads
* Phantom reads
* Race conditions during seat booking

Although Serializable transactions may occasionally abort due to serialization conflicts, the reservation endpoint automatically retries eligible transient failures.

## Seat ID Normalization

The reservation endpoint accepts either a single seat ID or multiple seat IDs. Before processing, duplicate values are removed and the remaining IDs are converted into a unique list.

```ts
const uniqueSeatIds = Array.from(new Set(seatIds)).sort();
```

Normalizing the input prevents duplicate processing and prepares the request for deterministic lock ordering.

---

## Deterministic Seat Ordering

After removing duplicates, the seat IDs are sorted before any database locks are acquired.

Sorting ensures that every transaction requests locks in the same order, reducing the likelihood of deadlocks when multiple users reserve overlapping sets of seats.

For example, if two requests contain the same seats in different orders, both transactions will still acquire locks in the identical sequence.

---

## PostgreSQL Row-Level Locking

Once the seat IDs are sorted, the reservation transaction attempts to acquire row-level locks using PostgreSQL's `SELECT ... FOR UPDATE`.

```sql
SELECT 1
FROM "VenueSeat"
WHERE id IN (...)
FOR UPDATE;
```

These locks prevent other transactions from modifying the same seat records until the current transaction either commits or rolls back. Locking the rows before validation helps avoid race conditions during concurrent reservations.

---

## Seat Validation

After acquiring locks, the endpoint loads the requested seat records and verifies that:

* Every seat exists.
* Every seat belongs to the requested venue.

If any requested seat cannot be found, the transaction stops immediately and returns an error instead of creating an incomplete reservation.

---

## Booking Conflict Detection

The transaction checks for existing bookings that:

* Match one of the requested seat IDs.
* Occur on the same date.
* Have a status of `CONFIRMED` or `PENDING`.

If an existing booking overlaps with the requested reservation time, the request is rejected with a conflict response.

The overlap calculation compares the booking start and end times to ensure that only non-overlapping reservations are accepted.

---

## Reservation Creation

If all validation checks succeed, booking records are created inside the same transaction. Each reserved seat receives its own booking record, while all bookings generated from a single request share the same confirmation ID.

Executing these operations within one transaction guarantees that either every booking is committed successfully or all changes are rolled back if an error occurs.

---

## Transaction Commit

After the booking records are created successfully, Prisma commits the transaction. Once the commit completes:

* Row locks are released.
* Seat availability is updated.
* Reservation events are published.
* Guest processing can begin.

Publishing updates only after a successful commit ensures that other parts of the application receive notifications for confirmed reservations only.

## Automatic Retry Strategy

Not every transaction failure represents a permanent error. Under heavy concurrency, the database may temporarily abort a transaction to preserve consistency. Instead of immediately returning an error, the reservation endpoint retries eligible transient failures.

The current implementation retries a transaction up to **three times** before returning an error.

```ts
const MAX_RETRIES = 3;
```

---

## Retryable Database Errors

The reservation endpoint retries the following transient database failures:

| Error              | Description                                        |
| ------------------ | -------------------------------------------------- |
| `P2028`            | Interactive transaction failure.                   |
| `P2034`            | Transaction conflict or serialization failure.     |
| `40001`            | PostgreSQL serialization failure.                  |
| Deadlock errors    | Temporary lock conflicts between transactions.     |
| Connection timeout | Temporary database connection acquisition failure. |

These errors are considered temporary and usually succeed when retried after a short delay.

The implementation checks for these conditions before deciding whether a retry should occur.

```ts
const isTransient =
  err.code === "P2028" ||
  err.code === "P2034" ||
  err.code === "40001" ||
  err.message?.includes("Timed out fetching a new connection") ||
  err.message?.includes("deadlock") ||
  err.message?.includes("serialization");
```

---

## Exponential Backoff

Instead of retrying immediately, the reservation endpoint waits for a progressively longer interval between attempts.

Current implementation:

```ts
const backoff =
  Math.pow(2, attempt) * 100 + Math.random() * 50;
```

Approximate retry delays are:

| Attempt | Delay      |
| ------- | ---------- |
| Retry 1 | 200–250 ms |
| Retry 2 | 400–450 ms |
| Retry 3 | 800–850 ms |

A small random delay (jitter) is included to reduce the chance that multiple clients retry at the same time, helping lower contention during periods of high traffic.

---

## Deadlock Prevention

Deadlocks can occur when multiple transactions attempt to lock the same resources in different orders.

The reservation endpoint minimizes this risk by:

* Sorting seat IDs before locking.
* Acquiring locks in a consistent order.
* Using Serializable transaction isolation.
* Retrying transient transaction failures automatically.

Together, these strategies significantly reduce the likelihood of deadlocks while maintaining data consistency.

---

## Example Deadlock-Safe Transaction

The following pattern demonstrates the reservation flow used by WorkSphere.

```ts
const uniqueSeatIds = Array.from(new Set(seatIds)).sort();

await prisma.$transaction(
  async (tx) => {
    // Acquire row locks
    // Validate requested seats
    // Check booking conflicts
    // Create booking records
  },
  {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  },
);
```

Sorting seat IDs before acquiring locks ensures that concurrent transactions request resources in the same order, reducing circular wait conditions.

## Error Handling

The reservation endpoint distinguishes between validation errors and transient database failures.

| Error                       | HTTP Status | Description                                   |
| --------------------------- | :---------: | --------------------------------------------- |
| Unauthorized                |     401     | User is not authenticated.                    |
| Invalid reservation details |     400     | Request validation failed.                    |
| Seat not found              |     404     | Requested seat does not exist.                |
| Seat conflict               |     409     | The requested seat has already been reserved. |
| Rate limit exceeded         |     429     | Too many booking requests.                    |
| Internal server error       |     500     | Unexpected server failure.                    |

Validation errors are returned immediately, while only eligible transient database failures trigger the automatic retry mechanism.

---

## Rate Limiting

Before any database transaction begins, the booking endpoint applies request rate limiting to reduce abuse and accidental duplicate submissions.

When the configured request limit is exceeded, the API responds with **HTTP 429 (Too Many Requests)** along with retry information in the response headers.

---

## Best Practices

When modifying the reservation system, follow these guidelines:

* Keep transactions as short as possible.
* Acquire row locks before checking seat availability.
* Preserve deterministic seat ID ordering.
* Retry only transient database failures.
* Keep the Serializable isolation level unless the reservation architecture changes.

Following these practices helps maintain consistency while minimizing lock contention.

---

## Testing Concurrent Reservations

The concurrency implementation can be validated using concurrent booking requests.

### Simultaneous Booking Test

1. Open two browser sessions.
2. Select the same venue and seat.
3. Submit both reservations simultaneously.

**Expected result**

* One reservation succeeds.
* The second request receives a **409 Conflict** response.

### Multi-Seat Reservation Test

Create a reservation containing multiple seats and verify that:

* All requested seats are reserved.
* A shared confirmation ID is generated.
* No duplicate booking records are created.

---

## Performance Considerations

The reservation endpoint is designed to balance consistency and performance through several techniques:

* Deduplicating seat identifiers.
* Sorting seat IDs before locking.
* Locking only the requested rows.
* Using interactive Prisma transactions.
* Retrying transient failures with exponential backoff.

These measures reduce unnecessary contention while maintaining reliable reservation behavior.

---

## Summary

The WorkSphere reservation system combines multiple concurrency control techniques to provide reliable seat booking under concurrent load.

Key mechanisms include:

* Prisma interactive transactions.
* Serializable transaction isolation.
* Deterministic seat ID sorting.
* PostgreSQL `SELECT ... FOR UPDATE` row locking.
* Booking conflict detection.
* Automatic retries for transient database failures.
* Exponential backoff with randomized jitter.

Together, these techniques help prevent double-booking, reduce deadlocks, and maintain database consistency even when multiple users attempt to reserve the same seats simultaneously.
