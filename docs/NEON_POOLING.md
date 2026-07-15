# Neon Connection Pooling Guide

This document explains how database connection pooling works for WorkSphere, how to configure Neon's built-in PgBouncer pooler correctly, and how to make sure the Prisma client is reused across serverless/lambda invocations instead of exhausting the connection pool.

WorkSphere runs on Vercel (serverless functions), uses **Neon PostgreSQL** as its database, and connects via **Prisma 7.2** with the `@prisma/adapter-pg` driver adapter. Serverless environments create a new function instance per request (or per burst of concurrent requests), so connection handling needs to be explicit — otherwise you'll hit Neon's connection limits very quickly.

---

## 1. Neon Pooling Limits & Connection Parameters

Neon provides two distinct connection endpoints for every project/branch:

| Endpoint type          | Hostname pattern                      | Use for                                                         |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------- |
| **Pooled** (PgBouncer) | `ep-xxxx-pooler.region.aws.neon.tech` | Application runtime queries (API routes, serverless functions)  |
| **Direct** (unpooled)  | `ep-xxxx.region.aws.neon.tech`        | Migrations, schema introspection, long-running admin operations |
| Endpoint type          | Hostname pattern                      | Use for                                                         |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------- |
| **Pooled** (PgBouncer) | `ep-xxxx-pooler.region.aws.neon.tech` | Application runtime queries (API routes, serverless functions)  |
| **Direct** (unpooled)  | `ep-xxxx.region.aws.neon.tech`        | Migrations, schema introspection, long-running admin operations |

**Always use the pooled endpoint for `DATABASE_URL`** in a serverless app like WorkSphere. Use the direct/unpooled endpoint for a separate `DIRECT_URL` used only by Prisma Migrate.

### Recommended `.env.local` setup

```bash
# Pooled connection — used by the app at runtime (Prisma Client / adapter-pg Pool)
DATABASE_URL="postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true"
DATABASE_URL="postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true&connection_limit=1"

# Direct connection — used only for migrations (npx prisma migrate deploy / db push)
DIRECT_URL="postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require"
```

### Key query parameters

| Parameter        | Recommended value | Why                                                                                                                                                                                                           |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pgbouncer=true` | `true`            | Tells Prisma the target is a PgBouncer-fronted endpoint, which disables features PgBouncer's transaction mode can't support (e.g. Prisma's own prepared-statement caching path, certain advisory-lock usage). |
| `sslmode`        | `require`         | Neon requires TLS; this is mandatory.                                                                                                                                                                         |

> **Note:** `connection_limit`, `pool_timeout`, and `connect_timeout` are Prisma-native-engine URL params and are **not read** when using `@prisma/adapter-pg`, which is what WorkSphere uses. Equivalent settings for this project are configured on the `pg.Pool` instance in `src/lib/prisma.ts` (`max`, `connectionTimeoutMillis`, and an idle/statement timeout) — see the "Client-side pool sizing" section below.
> | Parameter | Recommended value | Why |
> | ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `pgbouncer=true` | `true` | Tells Prisma the target is a PgBouncer-fronted endpoint, which disables features PgBouncer's transaction mode can't support (e.g. Prisma's own prepared-statement caching path, certain advisory-lock usage). |
> | `connection_limit` | `1` per serverless function instance | Each Lambda/Vercel function instance should only ever hold **one** connection from the pool. With many concurrent invocations, `N instances × connection_limit` must stay under Neon's pooled connection ceiling (see below). Setting this higher per-instance multiplies your total connection usage needlessly. |
> | `pool_timeout` | `10`–`20` (seconds) | How long Prisma waits for a free connection from its internal pool before throwing. Keep this short in serverless so failed requests fail fast instead of holding the function open. |
> | `sslmode` | `require` | Neon requires TLS; this is mandatory. |
> | `connect_timeout` | `10` | Caps how long a cold connection attempt can take before failing, important for keeping serverless function duration predictable. |

Example with all parameters:

```
postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true
postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true&connection_limit=1&pool_timeout=15&connect_timeout=10
```

### Neon plan limits to be aware of

Neon's pooled endpoint multiplexes many client connections onto a smaller number of Postgres backend connections, but the pooler itself still has a ceiling on **client-side** connections it will accept, and Neon's free/launch tiers cap concurrent Postgres connections on the branch's compute. Check your current project's limits on the Neon dashboard (Settings → Limits) before assuming headroom — these numbers vary by plan and change over time, so don't hardcode an assumption into application logic. Design for "as few simultaneous connections as possible" rather than for a specific number.

---

## 2. PgBouncer Setup & Transaction Pooling Best Practices

Neon's pooler runs PgBouncer in **transaction pooling mode**. This has real implications for how WorkSphere's Prisma queries must be written:

- **A connection is only borrowed for the duration of a single transaction**, then returned to the pool. This is what allows a small number of backend Postgres connections to serve a large number of app instances.
- **Session-level Postgres features do not work reliably** in transaction pooling mode, including:
  - `SET` statements meant to persist across queries in the same session
  - Named prepared statements that outlive a single transaction (Prisma handles this automatically when `pgbouncer=true` is set — see above)
  - Session-scoped advisory locks (`pg_advisory_lock`, as opposed to the transaction-scoped `pg_advisory_xact_lock`)
  - `LISTEN`/`NOTIFY` (WorkSphere's real-time updates use Server-Sent Events instead, precisely to avoid depending on this)

### Best practices for WorkSphere's usage

1. **Keep transactions short.** Multi-step Prisma `$transaction([...])` calls (e.g. creating a `Venue` + related `VenueRating` rows) should complete quickly — don't do slow work like external API calls (Pexels, OSRM, Overpass) _inside_ a Prisma transaction. Fetch external data first, then write to the database in a short transaction.
2. **Avoid interactive transactions that wait on user/network input.** Prisma's interactive transaction API (`prisma.$transaction(async (tx) => {...})`) holds a pooled connection open for its entire callback. If the callback awaits a slow network call, it starves the pool. Restructure so all async I/O happens before entering the transaction block.
3. **Don't rely on transaction pooling for session state.** If a future feature needs session-level features (e.g. `SET search_path`), route that specific query through the **direct** (unpooled) connection, not the pooled one.
4. **Set an explicit statement timeout for safety.** Since WorkSphere connects via `@prisma/adapter-pg`, set this per-connection when the pool is created, e.g.:

```ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000, // ms — abort any single query that runs longer than this
});
```

A runaway query in transaction-pooling mode can tie up a backend connection for other tenants of the pool, so this timeout is a safety net independent of query optimization. Keeping queries small and indexed is still good practice, but it doesn't guarantee a bound on worst-case runtime the way an explicit timeout does — treat them as complementary, not equivalent.

### Client-side pool sizing (this is the part WorkSphere controls directly)

Since Neon manages the PgBouncer side, and WorkSphere uses `@prisma/adapter-pg` rather than Prisma's native connection engine, the pooling knob WorkSphere actually configures is the **client-side `pg.Pool`** options passed to the adapter — not any `connection_limit`/`pool_timeout`/`connect_timeout` query params, which this adapter ignores:

1. **Keep transactions short.** Multi-step Prisma `$transaction([...])` calls (e.g. creating a `Venue` + related `VenueRating` rows) should complete quickly — don't do slow work like external API calls (Pexels, OSRM, Overpass) _inside_ a Prisma transaction. Fetch external data first, then write to the database in a short transaction.
2. **Avoid interactive transactions that wait on user/network input.** Prisma's interactive transaction API (`prisma.$transaction(async (tx) => {...})`) holds a pooled connection open for its entire callback. If the callback awaits a slow network call, it starves the pool. Restructure so all async I/O happens before entering the transaction block.
3. **Don't rely on transaction pooling for session state.** If a future feature needs session-level features (e.g. `SET search_path`), route that specific query through the **direct** (unpooled) connection, not the pooled one.
4. **Set an explicit statement timeout for safety.** Add `-c statement_timeout=15000` equivalent behavior by keeping queries small and indexed; a runaway query in transaction-pooling mode can tie up a backend connection for other tenants of the pool.

### Client-side pool sizing (this is the part WorkSphere controls directly)

Since Neon manages the PgBouncer side, the pooling knob WorkSphere actually configures is the **client-side pool** — either Prisma's internal pool (via `connection_limit` in the URL) or, since WorkSphere uses `@prisma/adapter-pg`, the `pg.Pool` options passed to the adapter:

```ts
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // max connections this Pool instance will open — keep at 1 per serverless instance
  max: 1, // max connections this Pool instance will open — keep at 1 per serverless instance
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
```

Keep `max: 1` (or a very small number) here — this is a per-function-instance pool, and it stacks on top of however many concurrent function instances Vercel spins up. A larger `max` here does not make the app faster in a serverless context; it just consumes more of Neon's shared pooled-connection budget per instance.

---

## 3. Client Reuse Across Serverless/Lambda Invocations

The single most impactful thing WorkSphere can do to avoid connection exhaustion is **never construct a new `PrismaClient` (or a new `pg.Pool`) per request**. Each `new PrismaClient()` call opens its own connection(s); in a serverless environment where handlers can be invoked at high concurrency, this multiplies fast and will exceed Neon's limits even with a correctly configured pooled URL.

### The singleton pattern

Vercel/Next.js serverless functions can reuse a "warm" container across invocations, and in development, Next.js hot-reloading can otherwise cause repeated module re-evaluation. Guard against both with a module-level singleton cached on `globalThis`:

```ts
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function createPrismaClient() {
  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pgPool = pool;
  }

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Then **every** API route, agent (`src/agents/*`), and library file must import this shared instance rather than instantiating its own client:

```ts
// ✅ correct — every module imports the shared client
import { prisma } from "@/lib/prisma";

export async function GET() {
  const venues = await prisma.venue.findMany();
  // ...
}
```

```ts
// ❌ wrong — creates a brand-new connection pool on every request
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient(); // do NOT do this inside a route handler
```

### Checklist for WorkSphere specifically

- [ ] Confirm `src/lib/prisma.ts` exports a single cached instance and that it's the _only_ place `new PrismaClient()` / `new Pool()` is called in the codebase.
- [ ] Audit `src/app/api/**/route.ts` files, `src/agents/*.tsx`, and `src/lib/*.ts` for any stray `new PrismaClient()` calls (grep for `new PrismaClient` and `new Pool(`).
- [ ] Confirm `prisma.config.ts` / migration scripts use `DIRECT_URL`, not the pooled `DATABASE_URL`, since `prisma migrate` needs a session-level connection.
- [ ] Set `max: 1` on the adapter's `pg.Pool` (in `src/lib/prisma.ts`) so each warm function instance holds at most one pooled connection. Do not rely on `connection_limit` in the URL — it's ignored by `@prisma/adapter-pg`.
- [ ] Confirm `src/lib/prisma.ts` exports a single cached instance and that it's the _only_ place `new PrismaClient()` / `new Pool()` is called in the codebase.
- [ ] Audit `src/app/api/**/route.ts` files, `src/agents/*.tsx`, and `src/lib/*.ts` for any stray `new PrismaClient()` calls (grep for `new PrismaClient` and `new Pool(`).
- [ ] Confirm `prisma.config.ts` / migration scripts use `DIRECT_URL`, not the pooled `DATABASE_URL`, since `prisma migrate` needs a session-level connection.
- [ ] Set `connection_limit=1` (URL) and `max: 1` (adapter Pool) so each warm function instance holds at most one pooled connection.
- [ ] If a route does heavy concurrent work (e.g. `POST /api/venues/updates` bulk photo updates), batch the Prisma calls rather than firing many parallel queries that each try to grab a connection from the same size-1 pool — a size-1 pool serializes concurrent queries within one instance, which is intentional but should be accounted for in code that assumes parallelism.
- [ ] Add a lightweight health check (e.g. periodic `SELECT 1`) only if you observe idle connections being dropped by Neon's autosuspend on scale-to-zero branches — reconnect logic in `src/lib/prisma.ts` should let `pg.Pool` reconnect transparently rather than requiring a manual keep-alive ping.

---

## Summary

- Use Neon's **pooled** endpoint (`...-pooler...`) for `DATABASE_URL`, with `pgbouncer=true`; use the **direct** endpoint for `DIRECT_URL` (migrations only). Pool sizing (`max: 1`) is configured on the `pg.Pool` in code, not via URL params.
- Use Neon's **pooled** endpoint (`...-pooler...`) for `DATABASE_URL`, with `pgbouncer=true&connection_limit=1`; use the **direct** endpoint for `DIRECT_URL` (migrations only).
- Neon's pooler runs **transaction-mode PgBouncer** — keep transactions short, avoid session-level Postgres features, and don't hold a transaction open across external network calls.
- **Reuse one `PrismaClient`/`pg.Pool` per serverless instance** via a `globalThis`-cached singleton in `src/lib/prisma.ts`; never call `new PrismaClient()` inside a route handler or agent.
