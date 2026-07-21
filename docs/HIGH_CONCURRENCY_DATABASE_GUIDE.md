# High Concurrency Database Guide (Neon Postgres)

This document outlines the standard practices for managing high-concurrency database operations, specifically tailored for our Neon Postgres environment. Adhering to these patterns ensures optimal performance, prevents connection exhaustion, and eliminates race conditions.

## 1. Connection Pooling Configuration

In a serverless environment with high concurrency, direct database connections can quickly hit limits. We utilize connection pooling to manage this.

### PgBouncer Transaction Modes

Neon provides built-in connection pooling via PgBouncer. You must use the correct connection string depending on the operation:

- **Transaction Mode (Recommended):** Use this for standard web traffic and API requests. PgBouncer assigns a server connection to the client only for the duration of a single transaction. Once the transaction completes, the connection is returned to the pool.
  - _Implementation:_ Ensure your connection string ends with `?options=project%3D[project-id]&pooler=true`.
- **Session Mode:** Only use this for long-running scripts, migrations, or operations that require session-level features (like prepared statements or temporary tables). It reserves the connection for the entire client session.

## 2. Transaction Isolation Levels

PostgreSQL provides different levels of transaction isolation. Choosing the right one balances data integrity with performance.

- **Read Committed (Default):** A statement can only see rows committed before it began. Good for most standard `SELECT` and `UPDATE` operations.
- **Repeatable Read:** All statements in the current transaction can only see rows committed before the _first_ query or data-modification statement was executed in this transaction. Use this for complex financial calculations or reporting where data must remain absolutely stable during the read process.
- **Serializable:** The strictest level. It emulates serial transaction execution for all committed transactions. Use this only when absolute data consistency is required across concurrent write operations, as it carries a high risk of serialization failures (which require application-level retries).

## 3. Deadlock Avoidance

Deadlocks occur when two or more transactions hold locks that the others need, resulting in a standstill. To avoid deadlocks:

1.  **Consistent Ordering:** Always lock rows or tables in the exact same order across your entire application. For example, if updating a `User` and then a `Profile`, never update the `Profile` then the `User` in another transaction.
2.  **Keep Transactions Short:** Minimize the amount of code executed inside a transaction block. Do external API calls or heavy processing _before_ or _after_ the transaction, never during.
3.  **Use `SELECT ... FOR UPDATE` Carefully:** Only lock the rows you absolutely intend to update, and release them as quickly as possible.

## 4. Batch Operation Patterns

To handle high volumes of data efficiently, avoid iterating and executing queries in loops (the "N+1" problem).

- **Bulk Inserts:** Use `INSERT ... ON CONFLICT` for upserting multiple records in a single query.
- **UNNEST for Batch Updates:** Pass arrays of data from your application to PostgreSQL and use the `UNNEST()` function to perform bulk updates in a single round trip.

## 5. Query Timeout Tunings

Long-running queries can exhaust the connection pool, bringing down the entire application.

- **Statement Timeouts:** Set `statement_timeout` to aggressively terminate queries that exceed our accepted latency threshold (e.g., 5000ms for standard API requests).
- **Implementation:** This can be configured at the connection URI level or set dynamically per session for specific, known heavy queries (e.g., `SET LOCAL statement_timeout = '10s';`).
