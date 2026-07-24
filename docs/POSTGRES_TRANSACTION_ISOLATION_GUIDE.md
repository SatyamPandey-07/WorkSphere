# Postgres Transaction Isolation Levels Guide

This guide provides a comprehensive reference for PostgreSQL transaction isolation levels as used in the WorkSphere codebase. It covers the three common read phenomena, the isolation levels that prevent them, practical Prisma code snippets (including `SELECT FOR UPDATE`), and guidelines for preventing race conditions in financial and booking operations.

---

## 1. Read Phenomena

Before choosing an isolation level, understand the three anomalies that concurrent transactions can produce.

### 1.1 Dirty Read

A **dirty read** occurs when Transaction B reads a row that Transaction A has modified but **not yet committed**. If A rolls back, B has acted on data that never existed.

| Step | Transaction A | Transaction B |
| :--: | :--- | :--- |
| 1 | `BEGIN` | |
| 2 | `UPDATE bookings SET status = 'cancelled' WHERE id = 42;` | |
| 3 | | `BEGIN` |
| 4 | | `SELECT status FROM bookings WHERE id = 42;` → sees `'cancelled'` (dirty) |
| 5 | `ROLLBACK` — the update is undone | |
| 6 | | Proceeds with stale data that was never committed |

> **PostgreSQL note:** Dirty reads are **impossible** in PostgreSQL. Even `Read Uncommitted` behaves like `Read Committed`, so this anomaly is academic for our stack.

### 1.2 Non-Repeatable Read

A **non-repeatable read** happens when Transaction B reads the same row twice and gets **different values** because Transaction A committed a change in between.

| Step | Transaction A | Transaction B |
| :--: | :--- | :--- |
| 1 | | `BEGIN` |
| 2 | | `SELECT credits FROM wallets WHERE user_id = 7;` → `100` |
| 3 | `BEGIN` | |
| 4 | `UPDATE wallets SET credits = 50 WHERE user_id = 7;` | |
| 5 | `COMMIT` | |
| 6 | | `SELECT credits FROM wallets WHERE user_id = 7;` → `50` (different!) |
| 7 | | Business logic that assumed `credits = 100` is now wrong |

### 1.3 Phantom Read

A **phantom read** occurs when Transaction B re-executes a range query and finds **new rows** that Transaction A inserted and committed in between.

| Step | Transaction A | Transaction B |
| :--: | :--- | :--- |
| 1 | | `BEGIN` |
| 2 | | `SELECT COUNT(*) FROM bookings WHERE venue_id = 5 AND date = '2026-08-01';` → `3` |
| 3 | `BEGIN` | |
| 4 | `INSERT INTO bookings (venue_id, date, time) VALUES (5, '2026-08-01', '14:00');` | |
| 5 | `COMMIT` | |
| 6 | | `SELECT COUNT(*) FROM bookings WHERE venue_id = 5 AND date = '2026-08-01';` → `4` (phantom!) |
| 7 | | Capacity check that relied on count `3` is now invalid |

---

## 2. Isolation Levels in PostgreSQL

PostgreSQL supports four isolation levels. The table below compares the three that are meaningfully distinct (remember: `Read Uncommitted` behaves identically to `Read Committed` in Postgres).

| | Dirty Read | Non-Repeatable Read | Phantom Read | Serialization Failure Risk | Performance |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Read Committed** | Prevented | Possible | Possible | None | Best |
| **Repeatable Read** | Prevented | Prevented | Prevented* | Moderate | Good |
| **Serializable** | Prevented | Prevented | Prevented | High | Lowest |

> \* PostgreSQL's `Repeatable Read` uses snapshot isolation, which also prevents phantom reads — unlike the SQL standard's minimum guarantee.

### When to Use Each Level in WorkSphere

| Isolation Level | Use Case | WorkSphere Examples |
| :--- | :--- | :--- |
| **Read Committed** | Standard CRUD, list pages, search, most API routes | Default for all routes; explicit in `folders.ts` batch deletes |
| **Repeatable Read** | Multi-step reads that must see a consistent snapshot (reporting, analytics aggregation) | Financial summaries, admin analytics dashboards |
| **Serializable** | Operations where absolute correctness across concurrent writers is mandatory and you can tolerate retries | Wallet balance transfers, seat-capacity enforcement |

---

## 3. Prisma Transaction Patterns

WorkSphere uses **Prisma 7** with the `@prisma/adapter-pg` driver adapter. The following patterns are used across the codebase.

### 3.1 Interactive Transaction with Explicit Isolation Level

Use interactive transactions when multiple dependent read/write steps must execute atomically. Pass the `isolationLevel` option to control the isolation.

```typescript
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

async function transferCredits(fromUserId: string, toUserId: string, amount: number) {
  return prisma.$transaction(
    async (tx) => {
      // Step 1: Read the sender's balance
      const sender = await tx.wallet.findUniqueOrThrow({
        where: { userId: fromUserId },
      });

      if (sender.credits < amount) {
        throw new Error("INSUFFICIENT_FUNDS");
      }

      // Step 2: Debit sender
      await tx.wallet.update({
        where: { userId: fromUserId },
        data: { credits: { decrement: amount } },
      });

      // Step 3: Credit receiver
      await tx.wallet.update({
        where: { userId: toUserId },
        data: { credits: { increment: amount } },
      });

      return { success: true };
    },
    {
      maxWait: 5_000,    // max time to acquire a connection from the pool
      timeout: 10_000,   // max transaction duration
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
```

### 3.2 SELECT FOR UPDATE (Pessimistic Locking)

When you need to **lock specific rows** for the duration of a transaction to prevent concurrent modifications, use `SELECT ... FOR UPDATE` via a raw query inside an interactive transaction.

```typescript
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

async function claimSeat(venueId: string, date: string, time: string, userId: string) {
  return prisma.$transaction(
    async (tx) => {
      // Lock the venue row — any concurrent transaction trying to lock
      // the same row will block until this transaction commits or rolls back.
      const [venue] = await tx.$queryRaw<{ id: string; capacity: number }[]>(
        Prisma.sql`SELECT id, capacity FROM "Venue" WHERE id = ${venueId} FOR UPDATE`
      );

      if (!venue) throw new Error("VENUE_NOT_FOUND");

      // Count existing bookings for this slot (safe because the venue row is locked)
      const currentCount = await tx.booking.count({
        where: { venueId, date, time },
      });

      if (currentCount >= venue.capacity) {
        throw new Error("SLOT_FULL");
      }

      // Safe to insert — no other transaction can pass the capacity check concurrently
      return tx.booking.create({
        data: { venueId, date, time, userId },
      });
    },
    {
      maxWait: 5_000,
      timeout: 10_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}
```

> **Key point:** `SELECT FOR UPDATE` acquires a row-level exclusive lock. Only one transaction can hold it on the same row at a time. This is the correct tool when you need to read-then-write and guarantee no concurrent modification between the two steps.

#### Lock Modes at a Glance

| Lock Clause | Behavior |
| :--- | :--- |
| `FOR UPDATE` | Exclusive row lock — blocks other `FOR UPDATE`, `FOR SHARE`, `UPDATE`, and `DELETE` |
| `FOR NO KEY UPDATE` | Like `FOR UPDATE` but allows concurrent `FOR KEY SHARE` (useful when you are not changing the primary key) |
| `FOR SHARE` | Shared lock — blocks `UPDATE` and `DELETE` but allows concurrent `FOR SHARE` reads |
| `FOR KEY SHARE` | Weakest lock — only blocks changes to key columns |
| `NOWAIT` | Fail immediately instead of blocking (e.g., `FOR UPDATE NOWAIT`) |
| `SKIP LOCKED` | Skip already-locked rows (useful for job queue patterns) |

### 3.3 Batched Array Transactions

For independent writes that must all succeed or all fail (but don't need intermediate reads), use the array form. This is more efficient because Prisma can batch the queries.

```typescript
import { prisma } from "@/lib/prisma";

// Example: deterministic-order bulk updates to avoid deadlocks
const orderedIds = sortTagIdsDeterministically([...tagMap.keys()]);

await prisma.$transaction(
  orderedIds.map((id) =>
    prisma.favoriteTag.update({
      where: { id },
      data: tagMap.get(id)!,
    }),
  ),
);
```

> **Deadlock prevention:** Always sort the IDs or keys before passing them to a batch transaction. If two concurrent requests lock rows in different orders, PostgreSQL will detect a deadlock and abort one of them. Deterministic ordering eliminates this.

---

## 4. Preventing Race Conditions in Financial Operations

Financial and booking operations are the most concurrency-sensitive areas in WorkSphere. Follow these guidelines to prevent race conditions.

### 4.1 Never Read-Then-Write Without a Lock

The classic race condition:

```
Thread A: SELECT credits → 100
Thread B: SELECT credits → 100
Thread A: UPDATE credits = 100 - 30 = 70
Thread B: UPDATE credits = 100 - 50 = 50   ← should be 20, not 50!
```

**Fix options:**

| Strategy | How | When to Use |
| :--- | :--- | :--- |
| **Atomic update** | `UPDATE wallets SET credits = credits - 30 WHERE ...` | Simple increment/decrement (counters, upvotes) |
| **SELECT FOR UPDATE** | Lock the row, read, validate, then write (see §3.2) | Conditional logic depends on the current value |
| **Serializable isolation** | Let Postgres detect the conflict and retry (see §5) | Multiple rows or range queries involved |

### 4.2 Booking Collision Prevention

The existing booking confirmation route demonstrates the recommended pattern:

1. Wrap the entire check-then-insert flow in an **interactive transaction**.
2. Query for conflicting bookings **inside** the transaction.
3. Throw a clear collision error if a conflict is detected.
4. Catch `P2002` (unique constraint) at the API boundary as a safety net.

```typescript
const { bookings } = await prisma.$transaction(async (tx) => {
  // Check for existing bookings (inside the transaction!)
  const existing = await tx.booking.findMany({
    where: { venueId, date: { in: bookingDates }, time },
  });

  if (existing.length > 0) {
    throw new Error("COLLISION");
  }

  // Safe to insert
  const created = [];
  for (const d of bookingDates) {
    created.push(await tx.booking.create({ data: { venueId, date: d, time, userId } }));
  }
  return { bookings: created };
});
```

### 4.3 Counter Updates

For counters like upvote counts, always use atomic operations instead of read-then-write:

```typescript
// ✅ Correct: atomic increment
await tx.folder.update({
  where: { id: folderId },
  data: { upvotes: { increment: 1 } },
});

// ❌ Wrong: read-then-write race
const folder = await tx.folder.findUnique({ where: { id: folderId } });
await tx.folder.update({
  where: { id: folderId },
  data: { upvotes: folder.upvotes + 1 },
});
```

---

## 5. Retry Strategies for Serialization Failures

When using `Repeatable Read` or `Serializable` isolation, PostgreSQL may abort a transaction with a serialization failure. Prisma surfaces this as error code **P2034**.

### 5.1 The Retry Pattern

The following pattern (based on the `folders.ts` implementation) provides bounded retries with linear backoff:

```typescript
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 50;

function isTransientWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function runWithRetry<T>(
  fn: (tx: any) => Promise<T>,
  isolationLevel: Prisma.TransactionIsolationLevel =
    Prisma.TransactionIsolationLevel.ReadCommitted,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await prisma.$transaction(fn, {
        maxWait: 5_000,
        timeout: 10_000,
        isolationLevel,
      });
    } catch (error) {
      attempt += 1;
      if (!isTransientWriteConflict(error) || attempt > MAX_RETRIES) {
        throw error;
      }
      // Linear backoff: 50ms, 100ms, 150ms
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BACKOFF_MS * attempt),
      );
    }
  }
}
```

### 5.2 When to Retry vs. When to Fail

| Scenario | Action |
| :--- | :--- |
| P2034 — serialization failure / write conflict | Retry (bounded) |
| P2002 — unique constraint violation | Do **not** retry — this is a business logic conflict (e.g., duplicate booking) |
| P2025 — record not found | Do **not** retry — the data does not exist |
| Connection timeout | Retry once, then fail — may indicate pool exhaustion |

---

## 6. Best Practices Checklist

Use this checklist when writing or reviewing database operations that involve concurrency:

- [ ] **Default to `Read Committed`** — only escalate when you have a documented reason.
- [ ] **Keep transactions short** — never perform network calls, file I/O, or heavy computation inside a transaction block.
- [ ] **Use atomic updates** for simple counters (`{ increment: 1 }`) instead of read-then-write.
- [ ] **Lock rows explicitly** with `SELECT FOR UPDATE` when conditional write logic depends on the current row state.
- [ ] **Sort lock acquisition order** deterministically (by ID or another stable key) to prevent deadlocks.
- [ ] **Handle P2034 retries** with bounded attempts and backoff when using `Repeatable Read` or `Serializable`.
- [ ] **Catch P2002 at the API boundary** as a safety net for unique constraint races.
- [ ] **Batch independent writes** using the Prisma array transaction form (`prisma.$transaction([...])`) for better throughput.
- [ ] **Set `maxWait` and `timeout`** on every interactive transaction to prevent connection pool starvation.
- [ ] **Test with concurrent requests** — use tools like `autocannon` or parallel test runners to verify that race conditions are actually prevented.

---

## Further Reading

- [PostgreSQL Documentation — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Prisma Docs — Transactions and Batch Queries](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [WorkSphere — High Concurrency Database Guide](./HIGH_CONCURRENCY_DATABASE_GUIDE.md)
- [WorkSphere — Database Connection Pooling](./DATABASE_CONNECTION_POOLING.md)
