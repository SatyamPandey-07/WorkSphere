# Neon DB Serverless Connection Limits Reference Guide

When deploying WorkSphere to a serverless environment (like Vercel) using a Neon PostgreSQL database and Prisma ORM, handling connection limits is critical. Serverless functions spin up and down rapidly, which can quickly exhaust the database's connection limit if not managed properly.

This guide outlines the standards for adjusting Neon connection pool constraints and configuring Prisma.

---

## 1. Pooled vs. Direct Connections

Neon provides two types of connection strings. For serverless environments, **you must always use the Pooled Connection String**.

- **Direct Connection (Do not use in Serverless):** Connects directly to the Postgres instance. High risk of `too many clients already` errors.
- **Pooled Connection (Required):** Uses PgBouncer internally to manage a pool of connections and share them across your serverless functions.

### Identifying a Pooled Connection String

A pooled connection string is identified by the `-pooler` suffix in the endpoint URL. (Note: The `?pgbouncer=true` parameter is generally only required for older PgBouncer setups and can be omitted for modern Neon pools).

```env
# ✅ DO THIS (Pooled)
DATABASE_URL="postgresql://user:password@ep-cool-snowflake-123456-pooler.us-east-2.aws.neon.tech/worksphere"

# ❌ DO NOT DO THIS (Direct)
DATABASE_URL="postgresql://user:password@ep-cool-snowflake-123456.us-east-2.aws.neon.tech/worksphere"
```

---

## 2. Prisma Pool Sizes and Timeout Parameters

Even with Neon's PgBouncer handling connections on the database side, Prisma needs specific parameters appended to the connection string to limit how many connections each serverless function attempts to hold open.

### `connection_limit`

By default, Prisma calculates the connection pool size based on `(num_physical_cpus * 2) + 1`. In a serverless environment, this is often too high because each function instance will create its own pool.

- **Standard Serverless Configuration:** Add `&connection_limit=1` to the end of your connection string. This ensures that warm instances do not multiply and exhaust the global connection pool.

### `pool_timeout`

This parameter determines how long Prisma will wait for a new connection from the pool before throwing an error. The default is 10 seconds, which is generally acceptable, but can be explicitly set if cold starts are causing timeouts.

- **Standard Serverless Configuration:** Add `&pool_timeout=15` (or higher if needed during heavy loads).

### The Complete Connection String

Your final `DATABASE_URL` in your `.env` file should look like this:

```env
DATABASE_URL="postgresql://user:password@ep-cool-snowflake-123456-pooler.us-east-2.aws.neon.tech/worksphere?connection_limit=1&pool_timeout=15"
```

---

## 3. Best Practices for Neon Serverless Scaling

1. **Use a Singleton Prisma Client in Development:** Next.js hot module reloading (HMR) can drain database connections. Always reuse a single `globalThis`-cached Prisma client in your `prisma.ts` or `db.ts` file to survive HMR and prevent instantiating multiple clients.
2. **Handle Cold Starts:** Serverless platforms can have cold starts. Setting a reasonable `pool_timeout` allows the application to wait for the database connection rather than immediately crashing.
3. **Monitor Neon Dashboard:** Keep an eye on the "Active Connections" metric in your Neon dashboard to ensure your `connection_limit` across all active serverless functions is not exceeding the tier limit.
