# PostgreSQL Connection Pool Starvation Prevention Runbook

This operational runbook provides WorkSphere developers, contributors, and platform engineers with a practical, definitive guide to preventing, diagnosing, and mitigating PostgreSQL connection pool exhaustion ("pool starvation"). It covers client-side pool architecture, Prisma 7 and `@prisma/adapter-pg` driver adapter mechanics, PgBouncer session vs. transaction pooling, serverless deployment capacity sizing, interactive transaction discipline, and diagnostic SQL monitoring queries.

---

## 1. Overview: PostgreSQL Connection Pool Starvation

In PostgreSQL, each client connection spawns a dedicated backend server process (`postgres`) that consumes significant operating system resources—typically **5 MB to 10 MB of RAM** for process memory, private work buffers, and operating system file descriptors, in addition to CPU context-switching overhead.

```
+----------------------------------------------------------------------------------------------------+
|                                 The Connection Pool Hierarchy                                      |
|                                                                                                    |
|  +---------------------------+        +---------------------------+                                |
|  | Next.js Serverless Lambdas|        |  Long-running Node Server |                                |
|  |  (N instances x Pools)    |        |  (Singleton Client Pool)  |                                |
|  +---------------------------+        +---------------------------+                                |
|               \                                     /                                              |
|                \                                   /                                               |
|           [Application Connection Pool: pg.Pool (max: 20 per client)]                              |
|                                       |                                                            |
|                                       v                                                            |
|              +-------------------------------------------------+                                   |
|              |  External Pooler: PgBouncer / Managed Pooler   |  (Optional Gateway)                |
|              |  (Translates M incoming to N backend connections)|                                   |
|              +-------------------------------------------------+                                   |
|                                       |                                                            |
|                                       v                                                            |
|             +---------------------------------------------------+                                  |
|             |        PostgreSQL Database Instance (max_connections) |                              |
|             +---------------------------------------------------+                                  |
+----------------------------------------------------------------------------------------------------+
```

### 1.1 What is Connection Pool Exhaustion?

**Connection pool starvation** occurs when the rate of concurrent database queries or the duration of open connections exceeds the maximum number of connections available in the pool. When all connections in a pool are busy:
1. Incoming queries are placed into a FIFO wait queue.
2. If a connection is not freed before the connection timeout expires, the query fails with a client-side timeout error (e.g., `Timeout waiting for connection from pool`).
3. If multiple application instances open direct connections to PostgreSQL, total connections exceed the engine limit, resulting in PostgreSQL's native error: `FATAL: remaining connection slots are reserved for non-replicated superuser connections` or `FATAL: sorry, too many clients already`.

### 1.2 Why WorkSphere is Susceptible Under High Concurrency

WorkSphere handles write-intensive and bursty workloads:
- **Spatial Venue & Proximity Searches:** High-throughput read spikes across PostGIS GiST indexes during rush hours.
- **Concurrent Seat Hold Leases & Bookings:** Multi-row verification, duplicate checks, and reservation locks executed inside transactions.
- **Serverless Edge & Next.js Lambdas:** In serverless deployments (such as Vercel or AWS Lambda), each auto-scaled container runs an isolated Node.js process. If 50 lambda instances spin up during a traffic surge, and each allocates a default pool of 20 connections, the instances will collectively attempt to open **1,000 concurrent TCP connections** to PostgreSQL, instantly overwhelming standard database instance tiers (which typically permit 50–200 connections).

### 1.3 Application-Level vs. Database-Side Pooling

| Characteristic | Application-Level Pooling (`pg.Pool` / Prisma) | Database-Side Pooling (PgBouncer / AWS RDS Proxy) |
|---|---|---|
| **Location** | Inside the Node.js application process memory | Standalone proxy between application and PostgreSQL |
| **Scope** | Manages connections for a single application process | Multiplexes connections across hundreds of application containers |
| **Serverless Fit** | Ineffective across autoscaled ephemeral containers | Essential for autoscaled serverless functions |
| **Overhead** | Zero extra network hops; local to app | Adds sub-millisecond network hop; vastly reduces DB process RAM |

---

## 2. WorkSphere Prisma Client Architecture

WorkSphere uses **Prisma 7.10** with `@prisma/adapter-pg` and the native Node.js `pg` driver adapter.

### 2.1 The Singleton Pattern in `src/lib/prisma.ts`

In WorkSphere, Prisma is instantiated as a persistent global singleton to survive Hot Module Replacement (HMR) during development and prevent connection leaks:

```typescript
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { recordQueryDuration } from "@/lib/dbTelemetry";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

// Prisma 7 requires a driver adapter for PostgreSQL
function createPrismaClient() {
  const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://dummy:dummy@localhost:5432/dummy";
  const pool = new Pool({
    connectionString,
    max: 20,
    min: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  const adapter = new PrismaPg(pool);

  // Client extension records per-query duration for admin telemetry
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();
          try {
            return await query(args);
          } finally {
            recordQueryDuration(model ?? operation, performance.now() - start);
          }
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

### 2.2 Architectural Analysis of the Pool Configuration

1. **Explicit Driver Adapter (`@prisma/adapter-pg`):**
   Unlike legacy Prisma versions where the Rust query engine managed an internal C-based connection pool via connection URL parameters, Prisma 7 with `PrismaPg` delegates pool lifecycle management directly to Node-Postgres (`pg.Pool`).
2. **Hardcoded Process Limit:**
   `max: 20` limits each individual Node.js process to at most 20 active sockets.
3. **Fail-Fast Acquisition:**
   `connectionTimeoutMillis: 5_000` causes queries to fail after 5 seconds if a connection cannot be acquired, preventing requests from hanging indefinitely.
4. **Statement Protection:**
   `statement_timeout: 10_000` instructs PostgreSQL to abort any single query exceeding 10 seconds, preventing runaway sequential scans from locking pooled connections.
5. **Development Global Caching:**
   `globalForPrisma.prisma` binds the client to the Node `globalThis` object during development. When Next.js recompiles routes upon code changes, existing connections are preserved rather than re-allocated on every reload.

---

## 3. Prisma Connection URL and Pool Configuration

### 3.1 Legacy Engine vs. Driver Adapter Parameters

In traditional Prisma deployments without a driver adapter, connection pool limits are passed as query parameters in the connection string:

```text
postgresql://USER:PASSWORD@HOST:5432/DATABASE?connection_limit=10&pool_timeout=20
```

- **`connection_limit`**: Maximum number of active connections maintained by the client instance.
- **`pool_timeout`**: Duration (in seconds) the client waits to acquire an idle connection from the pool before throwing a timeout exception.

> [!NOTE]
> **Prisma 7 Driver Adapter Distinction:**
> When using `@prisma/adapter-pg` (as configured in `src/lib/prisma.ts`), connection pooling is controlled by the `pg.Pool` constructor options (`max`, `connectionTimeoutMillis`). However, when using Prisma CLI tools (`prisma migrate`, `prisma db push`, `prisma introspect`), the CLI bypasses `src/lib/prisma.ts` and connects directly via the Rust query engine, where `connection_limit` and `pool_timeout` in the URL remain authoritative.

### 3.2 URL Encoding Guidelines

Special characters in database passwords (such as `@`, `:`, `/`, `?`, `#`, `&`, `%`, `+`) must be percent-encoded (URL-encoded) to avoid connection failure:

| Character | Percent-Encoded Value | Character | Percent-Encoded Value |
|---|---|---|---|
| `@` | `%40` | `?` | `%3F` |
| `:` | `%3A` | `#` | `%23` |
| `/` | `%2F` | `&` | `%26` |
| `+` | `%2B` | `%` | `%25` |

*Safe Configuration Template:*
```env
# URL with encoded password 'P@ss#w+rd' -> 'P%40ss%23w%2Brd'
DATABASE_URL="postgresql://db_app_user:P%40ss%23w%2Brd@db.example.com:5432/worksphere?sslmode=require&connection_limit=10&pool_timeout=20"
```

---

## 4. PgBouncer: Session Mode vs. Transaction Mode

When running multiple Next.js processes or serverless functions, an intermediary pooler like **PgBouncer** is mandatory. PgBouncer supports different pooling modes with distinct trade-offs.

### 4.1 Mode Comparison

| Feature / Capability | Session Pooling (`pool_mode = session`) | Transaction Pooling (`pool_mode = transaction`) |
|---|---|---|
| **Connection Lifetime** | Bound to client socket from connect to disconnect | Bound to client socket only for the duration of a single transaction or query |
| **Serverless Multiplexing**| Poor. 100 lambda instances consume 100 DB connections | Exceptional. 1,000 lambda instances can share 20–30 DB connections |
| **Memory Efficiency** | Low (many idle backend processes) | High (PostgreSQL processes remain active only while running SQL) |
| **Prepared Statements** | Supported natively | Disabled by default (must add `?pgbouncer=true` or set protocol settings) |
| **Advisory Locks** | Supported (`pg_advisory_lock`) | **Unsupported / Dangerous** (locks can leak to other clients) |
| **Session Variables** | `SET TIME ZONE`, `SET ROLE` persist per session | **Unsupported** (settings leak across transactions) |
| **Temporary Tables** | Supported across multiple queries | **Unsupported** (temp table vanishes when transaction ends) |
| **Prisma Migrations** | Supported | **Unsupported** (schema migrations require Session mode or direct URL) |

### 4.2 PgBouncer Configuration Walkthrough

Below is a production-hardened `pgbouncer.ini` configuration for WorkSphere:

```ini
[databases]
;; Route 'worksphere' database requests to the local PostgreSQL daemon
worksphere = host=127.0.0.1 port=5432 dbname=worksphere auth_user=postgres

[pgbouncer]
logfile = /var/log/postgresql/pgbouncer.log
pidfile = /var/run/postgresql/pgbouncer.pid
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

;; Pool Mode: Use transaction pooling for high-concurrency web applications
pool_mode = transaction

;; Maximum total client connections accepted by PgBouncer
max_client_conn = 2000

;; Maximum backend connections PgBouncer will open to PostgreSQL
default_pool_size = 25
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3

;; Sockets and timeouts
server_idle_timeout = 600
client_idle_timeout = 60
query_timeout = 15
```

### 4.3 WorkSphere Dual-URL Configuration

Because schema migrations and advisory locks require session-level connection binding, WorkSphere adopts the standard two-URL pattern documented in `.env.example`:

1. **`DATABASE_URL` (Pooled):** Points to PgBouncer port `6432` with `?pgbouncer=true`. Used by application routes and API endpoints.
2. **`DIRECT_URL` (Unpooled):** Points directly to PostgreSQL port `5432`. Used exclusively by Prisma Migrate, partition management scripts (`src/lib/partitionRetention.ts`), and administrative tasks.

```env
# Application pooled connection (Transaction mode on PgBouncer)
DATABASE_URL="postgresql://worksphere_user:SecretPass123@db-proxy.example.com:6432/worksphere?sslmode=require&pgbouncer=true"

# Direct unpooled connection for migrations & maintenance
DIRECT_URL="postgresql://worksphere_user:SecretPass123@db-direct.example.com:5432/worksphere?sslmode=require"
```

---

## 5. Serverless PostgreSQL Deployment Walkthrough

To size database capacity properly for serverless deployments (such as Vercel, AWS Lambda, or Cloudflare Workers via node bridge), use the sizing calculation below.

### 5.1 Connection Budget Calculation Formula

$$\text{Total DB Connections Required} = (\text{Peak Serverless Instances} \times \text{Connections Per Instance}) + \text{Reserved Buffer}$$

Where:
- **`Peak Serverless Instances`**: Maximum concurrent containers during traffic bursts.
- **`Connections Per Instance`**: `max` setting configured in `pg.Pool` or Prisma client (in `src/lib/prisma.ts`).
- **`Reserved Buffer`**: Connections dedicated to background workers (CDC worker, cron jobs), admin dashboards, Prisma migrations, and DBA monitoring ($10\text{ to }20$ connections minimum).

### 5.2 Worked Sizing Example (Illustrative)

Suppose WorkSphere is deployed with the following scenario:
- PostgreSQL tier configured with `max_connections = 100`.
- Peak concurrent serverless instances during product launch: `50 instances`.
- Administrative, CDC worker, and monitoring buffer reserved: `15 connections`.

#### Without External Pooler (Direct Connection Architecture)
- Total connection capacity available for web instances: $100 - 15 = 85$.
- Maximum safe connections per serverless instance:
  $$\frac{85 \text{ connections}}{50 \text{ instances}} = 1.7 \implies \text{Set pool max to } 1$$
- *Risk:* With `max: 1`, any instance processing concurrent sub-queries or transactions will experience severe internal request queuing and timeouts.

#### With PgBouncer (Transaction Pooling Architecture)
- PgBouncer backend pool size connected to PostgreSQL: `25 connections`.
- Reserved administrative buffer: `15 connections`.
- Total connections used on PostgreSQL: $25 + 15 = 40 \ll 100$ (well within safety limits).
- PgBouncer accepts up to `1,000` client connections on port `6432`.
- Serverless instances can each configure `max: 5`, allowing internal parallelism without exhausting PostgreSQL.

---

## 6. Diagnosing and Shortening Interactive Transactions

Prisma interactive transactions (`prisma.$transaction(async (tx) => { ... })`) lease a dedicated connection from the pool and hold it until the asynchronous callback resolves or rejects.

> [!WARNING]
> **Any latency introduced inside the callback directly holds the PostgreSQL connection open.**
> If an interactive transaction makes an external HTTP request, sends an email, or generates a cryptographic hash, the connection cannot be used by any other request, rapidly starving the pool.

### 6.1 Transaction Discipline Rules

1. **Perform Validation & Hashing First:** Verify user input, hash passwords, and fetch preliminary third-party metadata before opening the transaction.
2. **Execute Only Database Queries Inside:** Keep the transaction body limited strictly to atomic reads and writes (`tx.model.findUnique`, `tx.model.update`).
3. **Dispatch Events & Emails After Commit:** Run side-effects, webhooks, analytics tracking, and notification emails in the background *after* the transaction has successfully committed.

### 6.2 Code Pattern: Bad vs. Better

#### ❌ Anti-Pattern: Slow External Operations Inside Transaction

```typescript
// BAD: Holds database connection open during slow external API and email calls
export async function confirmBookingBad(userId: string, venueId: string, dates: string[]) {
  return await prisma.$transaction(async (tx) => {
    // 1. Database check
    const existing = await tx.booking.findMany({ where: { userId, venueId, date: { in: dates } } });
    if (existing.length > 0) throw new Error("Duplicate booking");

    // 2. Slow external payment API call (200ms - 2,000ms delay!)
    const paymentResult = await stripe.paymentIntents.create({ amount: 5000, currency: "usd" });

    // 3. Database write
    const booking = await tx.booking.create({
      data: { userId, venueId, paymentId: paymentResult.id, status: "CONFIRMED" },
    });

    // 4. Slow email transmission (500ms delay!)
    await sendConfirmationEmail(booking);

    return booking;
  }); // Connection held open for > 2 seconds!
}
```

#### ✅ Best Practice: Narrow Transaction Boundary with Post-Commit Side Effects

As implemented in WorkSphere's booking confirmation endpoint (`src/app/api/bookings/confirm/route.ts`):

```typescript
// BETTER: Executes external operations before and after the database transaction
export async function confirmBookingBetter(userId: string, venueId: string, dates: string[]) {
  // 1. Perform external payment call OUTSIDE the database transaction
  const paymentResult = await stripe.paymentIntents.create({ amount: 5000, currency: "usd" });

  // 2. Open transaction ONLY for atomic read-and-create operations (< 15ms)
  const booking = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.booking.findMany({
        where: { userId, venueId, date: { in: dates }, status: { notIn: ["CANCELLED"] } },
      });
      if (existing.length > 0) throw new Error("Duplicate booking detected");

      return await tx.booking.create({
        data: { userId, venueId, paymentId: paymentResult.id, status: "CONFIRMED" },
      });
    },
    {
      maxWait: 3000, // Maximum time to acquire transaction connection (3s)
      timeout: 5000, // Maximum execution time before auto-rollback (5s)
    }
  );

  // 3. Dispatch background notifications AFTER connection is released
  void sendConfirmationEmail(booking).catch((err) => {
    console.error("Non-blocking background email failed:", err);
  });

  return booking;
}
```

---

## 7. Diagnostic SQL Queries

Database administrators and contributors can execute the following read-only SQL queries against PostgreSQL to identify connection bottlenecks.

### A. Connection Counts by State

Displays how many connections are actively executing queries, idle, or lingering in a transaction:

```sql
SELECT
  state,
  count(*) AS connection_count,
  round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS percentage
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
GROUP BY state
ORDER BY connection_count DESC;
```
*Interpretation:* A high proportion of `idle in transaction` indicates application code failing to close transactions promptly. A high count of `active` connections during low traffic points to slow queries.

### B. Active Queries and Elapsed Duration

Identifies currently running queries and their execution duration:

```sql
SELECT
  pid,
  usename,
  client_addr,
  now() - query_start AS duration,
  state,
  left(query, 120) AS query_preview
FROM pg_stat_activity
WHERE state = 'active'
  AND pid <> pg_backend_pid()
ORDER BY duration DESC
LIMIT 15;
```
*Interpretation:* Pinpoints queries blocked on row locks or performing unindexed table scans.

### C. Long-Running Interactive Transactions

Flags transactions open for longer than 5 seconds:

```sql
SELECT
  pid,
  usename,
  client_addr,
  now() - xact_start AS transaction_age,
  state,
  left(query, 100) AS current_query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND now() - xact_start > interval '5 seconds'
  AND pid <> pg_backend_pid()
ORDER BY transaction_age DESC;
```
*Interpretation:* Any transaction exceeding 5 seconds in a web workload is a prime candidate for refactoring.

### D. Idle-in-Transaction Sessions

Detects sessions holding a database lock while waiting on external code or network requests:

```sql
SELECT
  pid,
  usename,
  client_addr,
  now() - state_change AS idle_duration,
  now() - xact_start AS total_xact_duration,
  left(query, 100) AS last_executed_statement
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND pid <> pg_backend_pid()
ORDER BY idle_duration DESC;
```
*Interpretation:* Indicates application code that called `BEGIN`, executed SQL, and paused without calling `COMMIT` or `ROLLBACK`.

### E. Connection Usage by Database and Role

Shows connection distribution across databases and application roles:

```sql
SELECT
  datname AS database_name,
  usename AS user_name,
  count(*) AS open_connections
FROM pg_stat_activity
GROUP BY datname, usename
ORDER BY open_connections DESC;
```
*Interpretation:* Verifies whether a specific service or worker (such as the CDC replication worker) is consuming an unexpected share of connections.

### F. Configured Connection Capacity and Utilization

Compares current connection usage against the PostgreSQL maximum limit:

```sql
SELECT
  current_setting('max_connections')::int AS max_connections,
  count(*) AS total_used_connections,
  current_setting('max_connections')::int - count(*) AS remaining_capacity,
  round(100.0 * count(*) / current_setting('max_connections')::numeric, 1) AS percent_utilized
FROM pg_stat_activity;
```
*Interpretation:* When `percent_utilized` exceeds 80%, immediate pool resizing or client throttling is necessary.

---

## 8. Troubleshooting and Recovery Runbook

| Symptom | Root Cause | Immediate Action & Resolution |
|---|---|---|
| **Prisma Error:** `Timed out fetching a new connection from the connection pool` | Application pool (`max: 20`) is exhausted because queries are slow or transactions are taking too long. | 1. Check `pg_stat_activity` for long-running queries.<br>2. Verify `statement_timeout: 10_000` is active.<br>3. Inspect interactive transactions for slow external API calls.<br>4. Increase `connectionTimeoutMillis` temporarily if database is under heavy load. |
| **PostgreSQL Error:** `FATAL: remaining connection slots are reserved for non-replicated superuser connections` | Combined pool sizes across all serverless instances exceeded `max_connections`. | 1. Reduce `max` in `src/lib/prisma.ts` or deploy PgBouncer.<br>2. Terminate idle sessions via emergency query.<br>3. Point web endpoints to a pooled connection URL (`DATABASE_URL`). |
| **High number of `idle in transaction` sessions** | Unhandled JavaScript promise rejections or unhandled exceptions inside transaction callbacks. | 1. Terminate orphaned backends: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND now() - state_change > interval '30 seconds';`<br>2. Configure PostgreSQL `idle_in_transaction_session_timeout = '10s'`. |
| **Connection spike immediately after deployment** | Serverless function cold starts creating fresh pools concurrently. | 1. Deploy PgBouncer in transaction pooling mode.<br>2. Enable connection reuse in serverless runtime.<br>3. Set `min: 0` or `min: 1` in `pg.Pool` configuration for ephemeral containers. |
| **Slow reservation lease operations under high load** | Row lock contention on venue or desk tables during concurrent check-in operations. | 1. Review lock ordering in transaction.<br>2. Ensure queries use indexed columns (`venueId`, `date`, `time`).<br>3. Use optimistic concurrency or Redis-backed distributed locks (`src/lib/reservations/`). |

---

## 9. Operational Monitoring and Prevention Checklist

Use this checklist during code reviews, architecture changes, and production release drills:

- [ ] **Prisma Singleton Verification:** Ensure all database queries import `prisma` from `@/lib/prisma` and never instantiate `new PrismaClient()` inside route handlers or component functions.
- [ ] **Transaction Cleanliness:** Confirm that no network requests (Stripe, Clerk, Resend, S3, external webhooks) execute inside `prisma.$transaction`.
- [ ] **Explicit Transaction Timeouts:** Always supply `{ timeout: 5000, maxWait: 3000 }` options to interactive transactions.
- [ ] **Serverless Pool Sizing:** Verify that `max_connections` on the PostgreSQL server is greater than $\text{Max Lambdas} \times \text{Connections Per Lambda} + 15$.
- [ ] **PgBouncer Mode Validation:** When using PgBouncer, ensure the pool mode is set to `transaction` and migrations use `DIRECT_URL`.
- [ ] **Database Statement Timeout:** Enforce `statement_timeout` (configured at 10 seconds in `src/lib/prisma.ts`) so hung queries are terminated automatically.
- [ ] **Active Idle Timeout:** Configure `idle_in_transaction_session_timeout = '15s'` in PostgreSQL to automatically kill orphaned transactions.
- [ ] **Automated Telemetry:** Monitor query latencies via the built-in WorkSphere telemetry extension (`src/lib/dbTelemetry.ts`).

---

## 10. References

- [Prisma Connection Management Guide](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)
- [Prisma Driver Adapters Architecture](https://www.prisma.io/docs/orm/overview/databases/database-drivers)
- [Prisma Interactive Transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions#interactive-transactions)
- [Node-Postgres (`pg.Pool`) Configuration Options](https://node-postgres.com/apis/pool)
- [PostgreSQL Documentation: `pg_stat_activity`](https://www.postgresql.org/docs/current/monitoring-stats.html#PG-STAT-ACTIVITY-VIEW)
- [PgBouncer Official Documentation](https://www.pgbouncer.org/usage.html)
- [WorkSphere Prisma Migration Troubleshooting Guide](../troubleshooting/prisma.md)
