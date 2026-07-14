# Database Connection Pooling & Serverless Optimizations

This guide details the database connection pooling strategy for WorkSphere, specifically focusing on **Neon PostgreSQL** integration, serverless environment optimizations, and connection limit management.

---

## 1. Neon Connection Architecture

WorkSphere uses **Neon** as its database provider. Neon provides a serverless PostgreSQL architecture that separates storage from compute. To handle high concurrency in serverless environments (like Vercel), Neon provides a built-in connection pooler powered by **PgBouncer**.

### Pooled vs. Direct Connections
Every Neon project provides two distinct connection strings. It is critical to use them for their intended purposes:

| Connection Type | Endpoint Pattern | Primary Use Case |
| :--- | :--- | :--- |
| **Pooled** | `ep-xxxx-pooler.region.neon.tech` | Application runtime (API routes, serverless functions) |
| **Direct** | `ep-xxxx.region.neon.tech` | Database migrations, schema pushes, admin scripts |

### Recommended Environment Variables
In your `.env.local` or deployment settings, configure both URLs:

```bash
# Pooled URL for the application (Transaction Mode)
DATABASE_URL="postgresql://user:pass@ep-pooler.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1"

# Direct URL for migrations (Session Mode)
DIRECT_URL="postgresql://user:pass@ep-direct.neon.tech/neondb?sslmode=require"
```

---

## 2. Connection Pool Sizing & Limits

In a serverless environment, each function invocation can potentially open a new connection. Without pooling, a burst of traffic can instantly exceed Neon's connection limits.

### Tuning Parameters
The following flags in the `DATABASE_URL` are essential for stable performance:

- **`pgbouncer=true`**: Informs Prisma that it is connecting through a pooler. This disables features that are incompatible with PgBouncer's transaction mode (like prepared statement caching).
- **`connection_limit=1`**: Each serverless function instance should only ever hold **one** connection. Since Vercel scales by creating more instances, setting this to 1 ensures that `N instances = N connections`.
- **`pool_timeout=15`**: Sets a 15-second limit for the client to wait for a free connection from the pool before failing.

### Neon Plan Ceilings
Be aware of the concurrent connection limits on your Neon plan:
- **Free/Launch Tiers**: Typically have lower concurrent connection ceilings.
- **Autoscaling**: Neon can scale compute resources, but the pooler itself has a maximum client-side connection limit. Always monitor your usage in the Neon Dashboard under **Settings → Limits**.

---

## 3. Serverless Best Practices

To prevent "Connection Exhaustion" errors, WorkSphere implements the following patterns:

### The Singleton Pattern
Never instantiate `new PrismaClient()` inside a route handler. Instead, use a shared singleton instance that persists across hot-invocations.

```typescript
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

### Transaction Mode Constraints
Neon's pooler operates in **Transaction Mode**. This means a connection is only borrowed for the duration of a single transaction.
- **Avoid Long Transactions**: Do not perform slow network calls (e.g., fetching images from Pexels) *inside* a database transaction.
- **No Session State**: Features like `SET search_path` or advisory locks do not work reliably in transaction mode.

---

## 4. Troubleshooting Connection Issues

If you encounter "Too many connections" or "Timed out waiting for connection" errors:

1. **Check for Leaks**: Ensure no part of the code is calling `new PrismaClient()` outside of the singleton.
2. **Verify `pgbouncer=true`**: Ensure this flag is present in your production `DATABASE_URL`.
3. **Audit Migrations**: Confirm that `npx prisma migrate` is using the `DIRECT_URL` and not the pooled `DATABASE_URL`.
4. **Scale Compute**: If your application legitimately requires more backend connections, consider increasing the "Fixed" compute size in the Neon dashboard to raise the connection ceiling.

---

## Summary

By using Neon's **pooled endpoint** for runtime queries and maintaining a **singleton Prisma instance**, WorkSphere ensures high performance and stability even under heavy serverless traffic. Always prioritize transaction-scoped operations and keep connection limits tuned to `1` per instance.
