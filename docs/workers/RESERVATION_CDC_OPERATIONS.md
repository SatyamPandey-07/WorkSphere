# Reservation CDC Setup and Operations Guide

## 1. Overview

WorkSphere includes a PostgreSQL logical replication worker that captures committed database changes and publishes them to a Redis Stream.

The implementation consists of:

| Component                                    | Source                                |
| -------------------------------------------- | ------------------------------------- |
| Worker entry point and lifecycle             | `src/workers/reservationCdcWorker.ts` |
| Logical replication, decoding and publishing | `src/lib/database/cdcStreamer.ts`     |
| Environment variable examples                | `.env.example`                        |
| Worker startup command                       | `package.json`                        |

The worker publishes changes from the following monitored tables by default:

- `Booking`
- `DeskLock`
- `VenueTelemetry`

The default schema is `public`, and the default Redis Stream is `stream:db:changes`.

The worker is a separate Node.js process. It should run alongside the PostgreSQL and Redis services.

## 2. Prerequisites

### PostgreSQL configuration

Logical replication must be enabled on the PostgreSQL server.

Check the current setting:

```sql
SHOW wal_level;
```

The expected value is:

```text
logical
```

If it is not enabled, configure `wal_level = logical` in the PostgreSQL server configuration and restart the server as required for the setting to take effect.

### Replication role permissions

The PostgreSQL role used by the worker must satisfy the logical replication requirements:

- Have the `LOGIN` attribute.
- Have the `REPLICATION` attribute or be a superuser.
- Be permitted to connect through the server's `pg_hba.conf` configuration.
- Be able to connect to the target database.

The `REPLICATION` privilege is required for creating logical replication slots.

When automatic publication creation is enabled for `pgoutput`, additional permissions apply:

- The role needs the database-level `CREATE` privilege to create a publication.
- The role must own the monitored tables that it adds to the publication.

Use a dedicated database role with only the required privileges. Avoid using a production superuser account merely to bypass permission problems.

### Redis configuration

The worker requires a Redis client capable of publishing stream entries and maintaining its idempotency and checkpoint state.

For local development, the repository's `.env.example` uses a TCP Redis endpoint:

```env
REDIS_URL="redis://localhost:6379"
```

The worker prefers TCP Redis when available. The Upstash REST client can also be used through the repository's Redis configuration.

## 3. Start the worker

The supported package command is:

```bash
npm run cdc:worker
```

This executes:

```bash
node --experimental-strip-types src/workers/reservationCdcWorker.ts
```

To explicitly load a local environment file:

```bash
node --experimental-strip-types --env-file=.env.local src/workers/reservationCdcWorker.ts
```

Ensure PostgreSQL and Redis are running and the worker's environment is configured before starting it.

The worker logs its startup configuration, including the replication slot, decoding plugin, Redis Stream key, and monitored tables.

## 4. Environment configuration

The following reference is based on `.env.example` and the worker's configuration implementation.

### Core configuration

| Variable               | Default or example                                   | Description                                                                                   |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Local PostgreSQL connection string in `.env.example` | General application database connection. Used by the worker when `CDC_DATABASE_URL` is unset. |
| `CDC_DATABASE_URL`     | Local PostgreSQL connection string in `.env.example` | Dedicated PostgreSQL connection for the CDC worker.                                           |
| `CDC_REPLICATION_SLOT` | `worksphere_cdc_slot`                                | PostgreSQL logical replication slot name.                                                     |
| `CDC_PLUGIN`           | `test_decoding`                                      | Logical decoding plugin. Supported choices are `test_decoding` and `pgoutput`.                |
| `CDC_PUBLICATION`      | `worksphere_cdc_pub`                                 | Publication name used by `pgoutput`.                                                          |
| `CDC_SCHEMA`           | `public`                                             | PostgreSQL schema monitored by the worker.                                                    |
| `CDC_TABLES`           | `Booking,DeskLock,VenueTelemetry`                    | Optional comma-separated table allow-list.                                                    |
| `CDC_STREAM_KEY`       | `stream:db:changes`                                  | Destination Redis Stream key.                                                                 |
| `REDIS_URL`            | `redis://localhost:6379`                             | Preferred TCP Redis connection.                                                               |
| `REDIS_TCP_URL`        | Not set                                              | Alternative TCP Redis connection variable.                                                    |

`CDC_TABLES` is commented out in `.env.example`; when unset or empty, the worker uses its built-in default table list.

### Optional worker configuration

The implementation also supports the following environment variables. They have defaults in code but are not all listed in `.env.example`.

| Variable                        |                      Default | Description                                                          |
| ------------------------------- | ---------------------------: | -------------------------------------------------------------------- |
| `CDC_LSN_STATE_FILE`            | `.cdc-state/<slot>.lsn.json` | Overrides the local LSN checkpoint file.                             |
| `CDC_DEDUPE_TTL_SECONDS`        |                     `604800` | Idempotency key lifetime in seconds (7 days).                        |
| `CDC_STREAM_MAX_LENGTH`         |                          `0` | Approximate Redis Stream trim limit. Zero disables trimming.         |
| `CDC_REDIS_TRANSPORT`           |          Automatic selection | Set to `rest` to force the Upstash REST transport.                   |
| `CDC_AUTO_CREATE_SLOT`          |                       `true` | Allows the worker to create a missing replication slot.              |
| `CDC_AUTO_CREATE_PUBLICATION`   |                       `true` | Allows automatic publication creation and population for `pgoutput`. |
| `CDC_RECONNECT_BASE_DELAY_MS`   |                        `500` | Initial reconnection delay.                                          |
| `CDC_RECONNECT_MAX_DELAY_MS`    |                      `30000` | Maximum reconnection delay.                                          |
| `CDC_MAX_RECONNECT_ATTEMPTS`    |                          `0` | Maximum retries. Zero means retry indefinitely.                      |
| `CDC_STATUS_UPDATE_INTERVAL_MS` |                        `250` | Minimum interval between PostgreSQL standby status updates.          |
| `CDC_STATUS_LOG_INTERVAL_MS`    |                      `60000` | Worker heartbeat logging interval. Zero disables heartbeat logs.     |
| `CDC_LATENCY_WARN_MS`           |                         `15` | WAL-to-Redis latency threshold for warnings.                         |
| `CDC_LOG_LEVEL`                 |                       `info` | Logging threshold: `debug`, `info`, `warn`, or `error`.              |

Boolean configuration accepts `1`, `true`, `yes`, or `on` for enabled and `0`, `false`, `no`, or `off` for disabled.

Invalid or negative numeric configuration values use their respective fallback defaults.

### Example local configuration

A minimal local configuration using the repository's default values:

```env
DATABASE_URL="postgresql://worksphere:worksphere@localhost:5432/worksphere"
CDC_DATABASE_URL="postgresql://worksphere:worksphere@localhost:5432/worksphere"

REDIS_URL="redis://localhost:6379"

CDC_REPLICATION_SLOT="worksphere_cdc_slot"
CDC_PLUGIN="test_decoding"
CDC_PUBLICATION="worksphere_cdc_pub"
CDC_SCHEMA="public"
CDC_STREAM_KEY="stream:db:changes"
```

Optional overrides can be added when necessary:

```env
# CDC_TABLES="Booking,DeskLock,VenueTelemetry"
# CDC_LSN_STATE_FILE=".cdc-state/worksphere_cdc_slot.lsn.json"
# CDC_STREAM_MAX_LENGTH="100000"
# CDC_LOG_LEVEL="info"
# CDC_REDIS_TRANSPORT="rest"
```

Keep credentials in local environment files. Do not commit actual database passwords, Redis tokens, or other secrets.

## 5. Logical decoding plugins

The worker supports two logical decoding plugins. Their output formats and publication requirements differ.

### `test_decoding`

This is the default plugin.

```env
CDC_PLUGIN="test_decoding"
```

Characteristics:

- Uses PostgreSQL's text-based logical decoding output.
- Does not require the worker to create a publication.
- Reports transaction boundaries using `BEGIN` and `COMMIT`.
- Represents row changes using decoded table and column information.
- Is convenient for local development and straightforward replication setups.

The worker parses supported `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` change records.

### `pgoutput`

Select the native PostgreSQL output plugin with:

```env
CDC_PLUGIN="pgoutput"
```

Characteristics:

- Uses PostgreSQL's native binary logical decoding format.
- Requires a publication.
- Uses relation messages to associate table and column metadata with subsequent row changes.
- Includes transaction and commit information in its protocol messages.
- Supports decoded `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` changes.

The default publication name is:

```text
worksphere_cdc_pub
```

When `CDC_AUTO_CREATE_PUBLICATION` is enabled, the worker checks the configured publication and adds present monitored tables that are not already included.

The default for automatic publication creation is enabled.

For `UPDATE` and `DELETE` replication, published tables must have an appropriate replica identity configured. PostgreSQL normally uses a primary key when available.

### Switching plugins

A replication slot is associated with the output plugin used when the slot is created.

The worker checks an existing slot's plugin and reports an error if it differs from `CDC_PLUGIN`.

Changing the environment variable alone does not convert an existing slot. Resolve the mismatch through an appropriate database maintenance procedure before restarting the worker. Do not drop a replication slot without first assessing its retained WAL and operational impact.

## 6. Replication slot and publication behavior

### Replication slot

The default slot is:

```text
worksphere_cdc_slot
```

The worker checks whether the configured slot already exists.

- If it exists with the expected plugin, the worker reuses it.
- If it does not exist and automatic slot creation is enabled, the worker creates it.
- If automatic creation is disabled and the slot is missing, startup fails.
- If the existing slot uses a different plugin, the worker reports a configuration error.

PostgreSQL retains the replication position in the logical replication slot across worker restarts.

### Publication

A publication is used only by the `pgoutput` plugin.

The default publication is:

```text
worksphere_cdc_pub
```

When automatic publication creation is enabled, the worker:

1. Checks whether the configured publication exists.
2. Reads the tables already associated with it.
3. Finds the configured monitored tables present in the selected schema.
4. Adds missing tables to an existing publication or creates a publication when necessary.

If no monitored tables are present, the worker can create an empty publication and populate it when the expected tables become available.

The worker does not automatically change the PostgreSQL ownership of tables or grant missing privileges.

## 7. Redis Stream event structure

Changes are published to the configured stream:

```text
stream:db:changes
```

The Redis Stream entry contains the following fields:

| Field       | Meaning                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| `id`        | Deterministic event identifier derived from the replication slot, LSN, and change index. |
| `type`      | Combined table and operation, such as `Booking.INSERT`.                                  |
| `table`     | Monitored table name.                                                                    |
| `operation` | `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`.                                             |
| `lsn`       | WAL position associated with the change.                                                 |
| `commitLsn` | Commit LSN when available; otherwise an empty value.                                     |
| `txId`      | Transaction ID when available; otherwise an empty value.                                 |
| `timestamp` | Event timestamp in ISO-8601 format.                                                      |
| `latencyMs` | Measured WAL receipt-to-publish latency.                                                 |
| `data`      | JSON-serialized CDC event payload.                                                       |

The serialized `data` payload contains additional information, including:

| Property         | Meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| `id` / `eventId` | Deterministic event identifier.                           |
| `source`         | Event source, `postgres-cdc`.                             |
| `slot`           | Replication slot name.                                    |
| `schema`         | PostgreSQL schema.                                        |
| `table`          | Monitored table name.                                     |
| `operation`      | Database change operation.                                |
| `lsn`            | WAL record position.                                      |
| `commitLsn`      | Commit LSN when available.                                |
| `txId`           | Transaction ID when available.                            |
| `timestamp`      | Event timestamp.                                          |
| `receivedAt`     | Epoch milliseconds when the worker received the WAL data. |
| `latencyMs`      | WAL receipt-to-publish latency.                           |
| `data`           | New row data, or old row data for a `DELETE`.             |
| `new`            | New row image, when available.                            |
| `old`            | Previous row image, when available.                       |

**Important:** `source` is part of the serialized event payload. It is not a separate top-level Redis Stream field.

For a `DELETE`, the `data` property contains the old row image. For other supported operations, it contains the new row image when available.

The `UPDATE` operation may contain both `old` and `new` row images. PostgreSQL's logical decoding output may not include every unchanged column, depending on the plugin and replica identity configuration.

The serialized `data` value is created before the Redis append completes. Consumers should not assume that optional post-publication metadata is present inside that serialized snapshot.

## 8. LSN checkpoints and restart behavior

The worker maintains a durable last-processed WAL position using two checkpoint backends:

**Redis checkpoint key**

```text
cdc:replication:lsn:<slot>
```

**Local checkpoint file**

```text
.cdc-state/<slot>.lsn.json
```

The local file path can be overridden with `CDC_LSN_STATE_FILE`.

Checkpoint behavior:

1. On startup, the worker loads available checkpoint values.
2. It selects the newest available LSN to determine its resume position.
3. It processes incoming WAL data.
4. After the events in a WAL message have been handled, it persists that message's end LSN.
5. PostgreSQL standby status updates acknowledge only a successfully persisted position.

The composite checkpoint store attempts to save to both Redis and the local file. It reports a complete persistence failure only when all configured checkpoint backends fail.

This ordering prevents the worker from acknowledging WAL that it has not successfully published and checkpointed.

The worker also handles duplicate WAL messages using the saved LSN position.

## 9. Idempotency and deduplication

Each event receives a deterministic identifier:

```text
<slot>:<lsn>:<index>
```

The publisher uses Redis keys with the prefix:

```text
cdc:processed:<slot>:<eventId>
```

By default, idempotency keys are retained for seven days.

The publisher uses three states:

| State     | Behavior                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| Missing   | Attempts to claim the event using `SET NX` before publishing.                                                         |
| `pending` | Indicates a previous attempt may have stopped before completing publication; the worker reclaims the key and retries. |
| `done`    | Indicates the event was already published; the duplicate is skipped.                                                  |

If a Redis idempotency operation fails, the publisher logs a warning and relies on the LSN checkpoint for restart protection.

**Delivery guarantee limitation**

This implementation should not be described as strict exactly-once delivery.

A failure after the Redis `XADD` succeeds but before the idempotency key is updated to `done` can result in a duplicate publication during retry. The design favors avoiding lost events over guaranteeing that duplicates can never occur.

Downstream consumers should therefore use the deterministic event identifier when implementing their own idempotent processing.

Setting `CDC_DEDUPE_TTL_SECONDS` to `0` disables the optional event-level idempotency key mechanism.

## 10. Reconnection and retry behavior

When a replication connection or WAL processing operation fails, the worker:

1. Records the connection or processing error.
2. Logs the failed attempt.
3. Calculates a retry delay using capped exponential backoff with jitter.
4. Reconnects and resumes from the latest persisted LSN.

Default timing:

| Setting                |         Default |
| ---------------------- | --------------: |
| Initial delay          |          500 ms |
| Maximum delay          |      30 seconds |
| Jitter                 |            ±20% |
| Maximum retry attempts | Unlimited (`0`) |

The retry delay grows exponentially until it reaches the configured maximum.

The retry counter is reset after successful WAL processing and checkpoint persistence, rather than merely after a successful TCP connection.

Configure `CDC_MAX_RECONNECT_ATTEMPTS` to a positive number when a bounded retry policy is required.

## 11. Graceful shutdown

The worker handles:

- `SIGINT`, commonly received when a developer presses Ctrl + C.
- `SIGTERM`, commonly used by process supervisors and deployment environments.

During shutdown, it:

1. Stops the heartbeat timer.
2. Stops the replication streamer.
3. Closes the active PostgreSQL replication connection.
4. Waits for the replication loop to settle, with a bounded wait.
5. Attempts to persist the last processed LSN.
6. Closes the worker-owned TCP Redis client when applicable.
7. Logs its final worker status and checkpoint.

The worker's `stop()` operation is idempotent, so repeated shutdown requests do not initiate multiple independent stop sequences.

For normal operations, allow the worker to handle shutdown signals instead of forcibly terminating the process.

## 12. Monitoring and operational checks

The worker periodically logs a heartbeat unless `CDC_STATUS_LOG_INTERVAL_MS` is set to `0`.

The status summary includes:

| Metric       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `running`    | Whether the replication loop is running.                       |
| `connected`  | Whether the PostgreSQL replication connection is active.       |
| `slot`       | Active replication slot.                                       |
| `plugin`     | Selected decoding plugin.                                      |
| `lsn`        | Last processed LSN.                                            |
| `published`  | Successfully published event count.                            |
| `duplicates` | Duplicate events skipped by the publisher.                     |
| `skipped`    | WAL messages or records skipped due to checkpoint comparisons. |
| `errors`     | Replication connection errors.                                 |

The worker also logs a latency warning when measured WAL-to-Redis latency exceeds `CDC_LATENCY_WARN_MS`.

Operational monitoring should include PostgreSQL slot health, Redis Stream growth, worker connectivity, checkpoint progress, and repeated retry errors.

## 13. Troubleshooting

### Worker reports that the database URL is missing

Check:

- `CDC_DATABASE_URL`
- `DATABASE_URL`

The worker uses `CDC_DATABASE_URL` first and falls back to `DATABASE_URL`.

Ensure the selected connection string points to the intended PostgreSQL database.

### Logical replication cannot start

Check:

```sql
SHOW wal_level;
```

The value must be `logical`.

Also verify that:

- The database role has `LOGIN` and replication privileges.
- The connection is allowed by `pg_hba.conf`.
- PostgreSQL is reachable from the worker.
- The selected output plugin is available on the server.

### Replication slot creation fails

Verify that the role has the required `REPLICATION` attribute or superuser privileges.

Check whether the configured slot already exists:

```sql
SELECT slot_name, plugin, active, confirmed_flush_lsn
FROM pg_replication_slots
WHERE slot_name = 'worksphere_cdc_slot';
```

If the slot exists with a different plugin, align the worker configuration or resolve the mismatch through a controlled database maintenance procedure.

Do not remove an existing replication slot simply to clear the error without assessing its retained WAL and consumers.

### Publication creation fails

This issue applies to `pgoutput`.

Check that:

- `CDC_PUBLICATION` is configured correctly.
- The database role has `CREATE` privilege on the database.
- The role owns the monitored tables it needs to add.
- The monitored tables exist in the configured schema.
- The publication's existing table configuration is correct.

PostgreSQL ownership and privilege requirements still apply when the worker attempts automatic publication setup.

### Redis connection or publication fails

Check:

- Whether Redis is reachable.
- Whether `REDIS_URL` or `REDIS_TCP_URL` points to the correct TCP service.
- Whether the configured Upstash REST endpoint and token are valid when using REST.
- Whether the worker can execute the required Redis commands, including stream publishing.
- Whether `CDC_STREAM_KEY` points to the intended stream.

Redis publication failures are treated as WAL-processing failures. The worker terminates the affected replication connection and applies its retry behavior.

### No events appear in the stream

Verify:

1. The worker is running and connected.
2. Database transactions are committing successfully.
3. The changes affect `Booking`, `DeskLock`, or `VenueTelemetry`, unless `CDC_TABLES` overrides the allow-list.
4. The table schema matches `CDC_SCHEMA`.
5. The selected decoding plugin is configured correctly.
6. You are inspecting the configured `CDC_STREAM_KEY`.

The worker filters changes to its configured schema and table allow-list. Changes outside those filters are not published.

### Events appear more than once

Check:

- The deterministic event ID.
- The LSN checkpoint values in Redis and the local checkpoint file.
- The idempotency key lifetime.
- Whether the worker stopped between Redis `XADD` and completion of the idempotency-key update.

Consumers should be idempotent because duplicate publication is a documented failure mode.

## 14. Related documentation

- [Local Development Setup](../guides/LOCAL_DEVELOPMENT_SETUP.md) — Local service and development environment setup.
- [Environment Variables Reference](../ENV_VARS.md) — Repository environment configuration reference.
- [PostgreSQL Logical Replication Security](https://www.postgresql.org/docs/current/logical-replication-security.html) — Replication connection and permission requirements.
- [PostgreSQL CREATE PUBLICATION](https://www.postgresql.org/docs/current/sql-createpublication.html) — Publication creation and table ownership requirements.
