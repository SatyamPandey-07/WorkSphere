# Neon Database & Connection Pooling Configuration

This guide explains how WorkSphere is configured to use **Prisma ORM** with **Neon Serverless PostgreSQL**, including PgBouncer connection pooling, connection string parameters, migration workflow, and troubleshooting common issues.

It is intended for both new contributors setting up the project and experienced developers optimising database performance in production.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Prisma + Neon Architecture](#2-prisma--neon-architecture)
3. [Connection String Configuration](#3-connection-string-configuration)
4. [Prisma Configuration](#4-prisma-configuration)
5. [Connection Pooling Best Practices](#5-connection-pooling-best-practices)
6. [Migration Workflow](#6-migration-workflow)
7. [Troubleshooting](#7-troubleshooting)
8. [Best Practices Summary](#8-best-practices-summary)
9. [References](#9-references)

---

## 1. Introduction

### Why Neon?

WorkSphere uses [Neon](https://neon.tech/) as its PostgreSQL provider. Neon is a serverless-native database that separates compute from storage, allowing it to scale to zero when idle and scale up instantly on demand. This makes it an ideal fit for a Next.js application deployed on Vercel, where API routes run as short-lived serverless functions.

### Why Connection Pooling Matters

Traditional PostgreSQL has a hard limit on the number of simultaneous client connections. In a serverless architecture, every function invocation can potentially open a new database connection. Without pooling:

- A burst of 50 concurrent requests opens 50 connections simultaneously.
- Connections are not reused between invocations.
- The database quickly hits its connection ceiling and starts rejecting new connections.

**PgBouncer** sits between your application and PostgreSQL and acts as a connection pool. It maintains a smaller set of long-lived connections to the database and queues incoming application connections, dramatically reducing the pressure on PostgreSQL.

### Common Problem: Connection Exhaustion

Without proper pooling configuration you will see errors like:

```
Error: too many connections for role
Error: remaining connection slots are reserved
Error: Timed out waiting to acquire connection from pool
```

The sections below explain exactly how WorkSphere is configured to prevent these errors.

---

## 2. Prisma + Neon Architecture

### Component Overview

| Component                       | Role                                                              |
| :------------------------------ | :---------------------------------------------------------------- |
| **Prisma Client**               | Type-safe query builder that translates TypeScript calls into SQL |
| **Neon Serverless PostgreSQL**  | Fully managed, autoscaling PostgreSQL database                    |
| **PgBouncer**                   | Connection pooler built into every Neon project                   |
| **Vercel Serverless Functions** | Short-lived Node.js processes that handle each API request        |

### Request Lifecycle

```
Vercel Serverless Function
         │
         │  (1) Prisma Client sends query
         ▼
  PgBouncer Pooler           ← DATABASE_URL (pooled endpoint)
  ep-xxxx-pooler.neon.tech
         │
         │  (2) Borrows connection from pool (Transaction Mode)
         ▼
  Neon PostgreSQL            ← DIRECT_URL (direct endpoint)
  ep-xxxx.neon.tech
         │
         │  (3) Executes query, returns result
         ▼
  PgBouncer releases connection back to pool
         │
         ▼
  Vercel Function returns HTTP response
```

### Key Point: Two Endpoints

Every Neon project exposes two distinct connection endpoints:

```
Pooled endpoint:   ep-xxxx-pooler.region.neon.tech   ← application runtime
Direct endpoint:   ep-xxxx.region.neon.tech           ← migrations only
```

Using the wrong endpoint for the wrong purpose is the most common source of migration failures and connection errors.

---

## 3. Connection String Configuration

### DATABASE_URL — Pooled Connection (Runtime)

Used by the application at runtime for all API route queries. Routes through PgBouncer.

```env
DATABASE_URL="postgresql://user:password@ep-xxxx-pooler.region.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1"
```

### DIRECT_URL — Direct Connection (Migrations)

Used exclusively by Prisma migration commands. Bypasses PgBouncer and connects directly to PostgreSQL.

```env
DIRECT_URL="postgresql://user:password@ep-xxxx.region.neon.tech/neondb?sslmode=require"
```

### Parameter Reference

| Parameter            | Applies To     | Description                                                                                                                                                                                                                               |
| :------------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pgbouncer=true`     | `DATABASE_URL` | Tells Prisma it is connecting through PgBouncer. Disables prepared statement caching, which is incompatible with PgBouncer's transaction mode. **Required** when using the pooled endpoint.                                               |
| `connection_limit=1` | `DATABASE_URL` | Limits each serverless function instance to one connection. Since Vercel scales horizontally by creating more instances, `N instances × 1 connection = N total connections`. Without this, a single instance could open many connections. |
| `sslmode=require`    | Both           | Enforces an encrypted TLS connection. Required by Neon for all connections.                                                                                                                                                               |
| `pool_timeout=15`    | `DATABASE_URL` | Seconds to wait for a free connection from the pool before throwing a timeout error. Increase this if you see pool timeout errors under heavy load. Default is `10`.                                                                      |
| `connect_timeout=10` | Both           | Seconds to wait when establishing the initial TCP connection to the server. Useful for catching network issues early. Default is `5`.                                                                                                     |

### Full Example

```env
# .env.local

# Pooled URL — used by the application at runtime (Vercel functions, API routes)
DATABASE_URL="postgresql://alex:secret@ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1&pool_timeout=15"

# Direct URL — used by Prisma migrations only (bypasses PgBouncer)
DIRECT_URL="postgresql://alex:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

> **Note:** Both URLs point to the same Neon project and database. The only difference is the hostname — the pooled endpoint has `-pooler` appended to it.

> **Warning:** Never use `DATABASE_URL` (the pooled endpoint) for migrations. PgBouncer's transaction mode does not support the session-level commands Prisma migrations rely on, and your migration will fail with unexpected errors.

---

## 4. Prisma Configuration

### schema.prisma

The datasource block in `prisma/schema.prisma` reads both connection strings and uses each for its intended purpose:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // Pooled — used for all runtime queries
  directUrl = env("DIRECT_URL")     // Direct — used for migrations
}
```

| Field       | Purpose                                                                                     |
| :---------- | :------------------------------------------------------------------------------------------ |
| `provider`  | Specifies PostgreSQL as the database engine                                                 |
| `url`       | The connection Prisma Client uses at runtime. Should always be the pooled `DATABASE_URL`.   |
| `directUrl` | The connection Prisma uses for schema migrations. Should always be the direct `DIRECT_URL`. |

### prisma.config.ts

WorkSphere uses `prisma.config.ts` at the project root for advanced configuration with the `@prisma/adapter-pg` driver adapter:

```typescript
import path from "node:path";
import { defineConfig } from "prisma/config";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL, // Pooled URL for runtime
  },
  migrate: {
    adapter: async () => {
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      return new PrismaPg(pool);
    },
  },
});
```

> **Tip:** The driver adapter (`PrismaPg` + `pg.Pool`) gives WorkSphere fine-grained control over connection pooling behaviour at the Node.js level, on top of PgBouncer's server-side pooling.

---

## 5. Connection Pooling Best Practices

### Singleton Prisma Client

Never instantiate `new PrismaClient()` inside an API route handler. In a serverless environment, every cold start would create a new client — and therefore a new connection — that is never properly cleaned up.

Instead, use a module-level singleton that is reused across requests within the same function instance:

```typescript
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
    new Pool({ connectionString: process.env.DATABASE_URL });

  if (!globalForPrisma.pgPool) globalForPrisma.pgPool = pool;

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Reuse the existing instance in development to survive hot reloads.
// In production each function instance is isolated, so this just
// ensures the client is only created once per invocation context.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

### Environment-Specific Recommendations

| Environment             | Recommendation                                                                                                                                                                 |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel (Production)** | Use `connection_limit=1`. Vercel scales by adding function instances, not by increasing connections per instance.                                                              |
| **Vercel (Preview)**    | Same as production. Preview deployments also run as serverless functions.                                                                                                      |
| **Local Development**   | `connection_limit` can be set to `5`–`10`. Your machine runs a single long-lived Node.js process, so multiple connections are fine and improve parallelism during development. |
| **Edge Functions**      | The `@prisma/adapter-pg` driver adapter is not compatible with the Edge Runtime. Use Neon's HTTP-based driver (`@neondatabase/serverless`) for Edge Functions instead.         |
| **CI / Testing**        | Use a separate Neon branch or a local PostgreSQL instance. Never run tests against the production database.                                                                    |

### Avoiding Connection Leaks

- Do not call `prisma.$disconnect()` inside individual request handlers. Let the connection persist for the lifetime of the function instance.
- Do not open raw `pg.Pool` connections alongside Prisma unless they are also managed as singletons.
- Avoid running slow operations (external API calls, file I/O) inside Prisma transactions — this holds a database connection open for longer than necessary.

---

## 6. Migration Workflow

Prisma migrations use `DIRECT_URL` to connect directly to PostgreSQL, bypassing PgBouncer. This is necessary because migrations use PostgreSQL session-level features (e.g., advisory locks, `SET` commands) that are not supported in PgBouncer's transaction mode.

### Development

Create and apply a new migration locally:

```bash
npx prisma migrate dev --name describe-your-change
```

This command:

1. Connects using `DIRECT_URL`
2. Compares your `schema.prisma` against the current database state
3. Generates a new SQL migration file in `prisma/migrations/`
4. Applies the migration to your local database
5. Regenerates Prisma Client automatically

### Production Deployment

Apply pending migrations to the production database:

```bash
npx prisma migrate deploy
```

This command:

1. Connects using `DIRECT_URL`
2. Applies all unapplied migrations from `prisma/migrations/` in order
3. Does **not** generate new migrations or modify `schema.prisma`

> **Warning:** Always run `prisma migrate deploy` against the `DIRECT_URL`, never the pooled `DATABASE_URL`. Running migrations through PgBouncer will cause intermittent failures.

### Regenerate Client Only

If you only need to regenerate the Prisma Client after a schema change (without running a migration):

```bash
npx prisma generate
```

### Migration Command Reference

| Command                     | Uses              | Purpose                                                  |
| :-------------------------- | :---------------- | :------------------------------------------------------- |
| `npx prisma migrate dev`    | `DIRECT_URL`      | Create and apply migrations in development               |
| `npx prisma migrate deploy` | `DIRECT_URL`      | Apply pending migrations in production/CI                |
| `npx prisma migrate status` | `DIRECT_URL`      | Check which migrations have been applied                 |
| `npx prisma db push`        | `DIRECT_URL`      | Sync schema without migration history (prototyping only) |
| `npx prisma generate`       | None (local only) | Regenerate Prisma Client from schema                     |
| `npx prisma studio`         | `DATABASE_URL`    | Open browser-based database explorer                     |

---

## 7. Troubleshooting

### Too Many Database Connections

**Symptoms:** `remaining connection slots are reserved`, `sorry, too many clients already`

**Causes:**

- `new PrismaClient()` is being called inside a route handler
- `connection_limit` is not set or is set too high
- A previous deployment left orphaned connections open

**Solutions:**

1. Confirm the singleton pattern is used in `src/lib/prisma.ts`
2. Add `&connection_limit=1` to `DATABASE_URL`
3. Restart the Neon compute endpoint from the Neon dashboard to forcibly close all idle connections

---

### Pool Timeout

**Symptoms:** `Timed out waiting to acquire connection from pool`

**Causes:**

- All connections in the pool are in use and none are being released
- A long-running transaction is holding a connection open
- `pool_timeout` is set too low for your workload

**Solutions:**

1. Increase `pool_timeout` in `DATABASE_URL` (e.g. `&pool_timeout=30`)
2. Ensure no slow external API calls are made inside database transactions
3. Review query performance in the Neon dashboard — slow queries hold connections longer

---

### Prisma Initialization Errors

**Symptoms:** `@prisma/client did not initialize yet`, `Cannot find module '.prisma/client'`

**Causes:**

- Prisma Client has not been generated after a schema change
- The `postinstall` script did not run after `npm install`

**Solutions:**

```bash
npx prisma generate
```

If the issue persists after deployment, ensure `prisma generate` runs as part of your build step. WorkSphere's `package.json` already includes this via the `build` script:

```json
"build": "prisma generate && next build"
```

---

### PgBouncer Transaction Mode Limitations

**Symptoms:** `prepared statement already exists`, `SET LOCAL is not allowed in transaction mode`, unexpected behaviour in long-running sessions

**Causes:**

- `pgbouncer=true` is missing from `DATABASE_URL`, so Prisma sends prepared statements that PgBouncer cannot handle
- Session-level PostgreSQL features are being used (advisory locks, `SET search_path`, cursors)

**Solutions:**

1. Confirm `&pgbouncer=true` is present in `DATABASE_URL`
2. Avoid session-scoped PostgreSQL features in application code
3. For operations that genuinely require session mode, use `DIRECT_URL` with a short-lived connection

---

### Migration Failures

**Symptoms:** `Error: P3009 migrate found failed migrations`, `ERROR: prepared statement "s0" already exists`

**Causes:**

- Migration was run against the pooled endpoint instead of the direct endpoint
- A previous migration was interrupted and left in a failed state

**Solutions:**

1. Confirm `DIRECT_URL` points to the direct (non-pooler) Neon endpoint
2. Check migration status:
   ```bash
   npx prisma migrate status
   ```
3. To resolve a failed migration, mark it as rolled back and re-apply:
   ```bash
   npx prisma migrate resolve --rolled-back <migration-name>
   npx prisma migrate deploy
   ```

---

### Connection Timeout

**Symptoms:** `connect ETIMEDOUT`, `Connection timed out`

**Causes:**

- Neon compute has scaled to zero and the cold-start is taking longer than `connect_timeout`
- Network issues between the deployment region and Neon's region

**Solutions:**

1. Add `&connect_timeout=15` to both `DATABASE_URL` and `DIRECT_URL`
2. Ensure your Vercel deployment region matches your Neon project region to minimise latency
3. Consider enabling Neon's "Always-on" compute for production to avoid cold starts

---

## 8. Best Practices Summary

| Practice                                          | Reason                                                                                |
| :------------------------------------------------ | :------------------------------------------------------------------------------------ |
| Use a singleton `PrismaClient`                    | Prevents a new connection being opened on every request                               |
| Set `connection_limit=1` in `DATABASE_URL`        | Keeps total connections equal to the number of active function instances              |
| Always include `pgbouncer=true` in `DATABASE_URL` | Prevents Prisma from using prepared statements, which are incompatible with PgBouncer |
| Use `DIRECT_URL` for all migration commands       | PgBouncer transaction mode blocks the session-level SQL that migrations require       |
| Never run migrations against `DATABASE_URL`       | Doing so will cause intermittent and hard-to-debug failures                           |
| Keep `DATABASE_URL` as the pooled endpoint        | All runtime queries benefit from PgBouncer's connection reuse                         |
| Keep `DIRECT_URL` as the direct endpoint          | Ensures reliable migration execution and schema introspection                         |
| Avoid slow operations inside transactions         | Holding a connection open longer increases pool pressure                              |
| Match Vercel region to Neon region                | Reduces latency and the likelihood of connection timeouts                             |
| Monitor connections in the Neon dashboard         | Catch connection ceiling issues before they affect users                              |

---

## 9. References

- [Prisma Documentation — Connection Management](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)
- [Prisma Documentation — Deploying to Vercel](https://www.prisma.io/docs/orm/more/deployment/deployment-guides/deploying-to-vercel)
- [Prisma Documentation — PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
- [Prisma Documentation — Migrate CLI Reference](https://www.prisma.io/docs/orm/reference/prisma-cli-reference#prisma-migrate)
- [Neon Documentation — Connection Pooling](https://neon.tech/docs/connect/connection-pooling)
- [Neon Documentation — Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)
- [Neon Documentation — Connect from Vercel](https://neon.tech/docs/guides/vercel)
- [PgBouncer Documentation](https://www.pgbouncer.org/usage.html)
