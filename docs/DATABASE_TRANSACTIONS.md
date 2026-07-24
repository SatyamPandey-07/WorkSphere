# Database Transactions and Concurrency Patterns

## Overview

WorkSphere uses Prisma interactive transactions to safely handle seat reservations under concurrent access.

The reservation implementation is located at:

```
src/app/api/reservations/book/route.ts
```

The transaction workflow ensures:

- Seat availability is checked before booking.
- Conflicting reservations are prevented.
- Multiple seat bookings are created atomically.
- Temporary database failures are retried safely.

---

## Prisma Interactive Transactions

WorkSphere uses Prisma interactive transactions:

```ts
await prisma.$transaction(async (tx) => {
  // transactional operations
});
```

All operations inside the transaction callback execute as one atomic unit.

If any operation fails:

- The transaction is rolled back.
- Partial reservation data is not saved.

The reservation transaction performs:

1. Seat validation.
2. Existing booking lookup.
3. Time overlap detection.
4. Booking creation.

---

# Reservation Transaction Flow

The booking API follows this sequence:

## 1. Validate requested seats

Requested seat IDs are normalized before starting the transaction:

```ts
const uniqueSeatIds = Array.from(new Set(seatIds)).sort();
```

This:

- Removes duplicate seat IDs.
- Sorts seats into a deterministic order.

Deterministic ordering reduces deadlock risk when multiple transactions attempt to reserve the same resources.

---

## 2. Verify seat availability

Inside the transaction:

```ts
const seats = await tx.seat.findMany({
  where: {
    id: { in: uniqueSeatIds },
    venueId,
  },
});
```

If any requested seat does not exist:

```ts
throw new Error("SEAT_NOT_FOUND");
```

the transaction is aborted.

---

## 3. Check existing reservations

Existing confirmed and pending bookings are loaded:

```ts
const existingBookings = await tx.booking.findMany({
  where: {
    seatId: { in: uniqueSeatIds },
    date,
    status: {
      in: ["CONFIRMED", "PENDING"],
    },
  },
});
```

The API checks whether the requested time overlaps with an existing reservation.

If a conflict exists:

```ts
throw new Error("CONFLICT");
```

No booking is created.

---

# Transaction Isolation and Concurrency

Interactive transactions protect reservation consistency by ensuring that database operations happen together.

The reservation process avoids race conditions by:

- Validating availability inside the transaction.
- Creating bookings inside the same transaction.
- Processing seat IDs in a predictable order.

This prevents scenarios where multiple users successfully reserve the same seat at the same time.

---

# Retry Strategy

Database transactions can fail temporarily due to concurrency conflicts or connection issues.

WorkSphere retries transient transaction failures.

Configuration:

```ts
const MAX_RETRIES = 3;
```

The transaction is retried until:

- It succeeds, or
- The maximum retry count is reached.

---

# Exponential Backoff

Retries use exponential backoff with random jitter:

```ts
const backoff =
  Math.pow(2, attempt) * 100 + Math.random() * 50;

await new Promise((resolve) =>
  setTimeout(resolve, backoff)
);
```

The increasing delay avoids multiple clients retrying at the same time.

Retry pattern:

| Attempt | Delay |
|---|---|
| 1 | ~250ms |
| 2 | ~450ms |
| 3 | ~850ms |

---

# Retryable Database Errors

WorkSphere retries these transient failures:

## Prisma Error P2028

P2028 represents interactive transaction failures.

Possible causes include:

- Transaction timeout.
- Transaction state problems.
- Temporary database connection issues.

---

## Prisma Error P2034

P2034 indicates a transaction conflict.

Common causes:

- Concurrent writes.
- Serialization conflicts.

Retrying allows the transaction to execute again safely.

---

## PostgreSQL Deadlocks

Deadlocks happen when multiple transactions wait for each other to release database locks.

WorkSphere detects deadlocks using:

```ts
error.message?.includes("deadlock")
```

When detected, the operation is retried using exponential backoff.

---

# Deadlock-Safe Transaction Handler Example

A safe transaction pattern:

```ts
const MAX_RETRIES = 3;

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    return await prisma.$transaction(async (tx) => {
      const resources = await tx.resource.findMany({
        where: {
          id: {
            in: resourceIds.sort(),
          },
        },
      });

      // Perform database operations

      return resources;
    });
  } catch (error) {
    if (isTransientError(error) && attempt < MAX_RETRIES) {
      const delay =
        Math.pow(2, attempt) * 100 +
        Math.random() * 50;

      await new Promise((resolve) =>
        setTimeout(resolve, delay)
      );

      continue;
    }

    throw error;
  }
}
```

---

# Prisma 7 Adapter Configuration

WorkSphere uses Prisma 7 with the PostgreSQL driver adapter.

Configuration is defined in:

```
prisma.config.ts
```

The project uses:

```ts
import { defineConfig } from "prisma/config";
```

The PostgreSQL adapter is configured using:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
```

A PostgreSQL connection pool is created:

```ts
const pool = new Pool({
  connectionString,
});
```

The adapter is then passed to Prisma:

```ts
const adapter = new PrismaPg(pool);
```

---

# Connection Pooling

The Prisma client configuration is located at:

```
src/lib/prisma.ts
```

WorkSphere configures PostgreSQL pooling:

```ts
const pool = new Pool({
  connectionString,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
```

## Pool Settings

| Setting | Purpose |
|---|---|
| max | Maximum database connections |
| min | Minimum available connections |
| idleTimeoutMillis | Removes unused connections |
| connectionTimeoutMillis | Maximum connection wait time |
| statement_timeout | Prevents long-running queries |

---

# Connection Fallback

Both Prisma configuration files provide a fallback connection string:

```
postgresql://dummy:dummy@localhost:5432/dummy
```

This prevents application startup failures when `DATABASE_URL` is missing.

Production deployments should always configure:

```
DATABASE_URL
```

with a valid PostgreSQL connection string.

---

# Best Practices

When adding new transactional workflows:

- Keep transactions short.
- Validate input before database operations.
- Lock resources in deterministic order.
- Retry only transient failures.
- Avoid external API calls inside transactions.
- Use connection pooling for production workloads.

Following these practices keeps WorkSphere reservation workflows reliable under concurrent usage.