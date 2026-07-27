# Push Notification Log Partitioning

## Overview

WorkSphere records push-notification delivery attempts in PostgreSQL through the
`PushNotificationLog` table. Monthly range partitioning keeps this time-series
data manageable, improves date-bounded queries, and allows old data to be
retired one month at a time.

Related implementation:

```text
prisma/migrations/20260723000000_partition_push_notification_log/migration.sql
src/lib/partitionMaintenance.ts
src/app/api/admin/system/partitions/route.ts
src/app/api/cron/reminders/route.ts
```

Application code continues to query the parent table:

```sql
"PushNotificationLog"
```

PostgreSQL decides which monthly child table stores or serves each row.

## Partition design

The partition key is `createdAt`:

```sql
PARTITION BY RANGE ("createdAt")
```

Each child owns a half-open interval: the start of one month is included and
the start of the following month is excluded.

```sql
FOR VALUES FROM ('2026-07-01 00:00:00')
           TO   ('2026-08-01 00:00:00')
```

Therefore, a row timestamped exactly `2026-08-01 00:00:00` belongs to August.

Partition names follow:

```text
PushNotificationLog_yYYYYmMM
```

Examples:

```text
PushNotificationLog_y2026m07
PushNotificationLog_y2026m08
PushNotificationLog_y2027m01
```

The month is always zero-padded. Predictable names simplify monitoring,
retention, and incident response.

Monthly partitioning is a practical compromise: fewer tables than daily
partitioning, smaller units than yearly partitioning, and straightforward
calendar-based retention.

## Applying and verifying the migration

Use a disposable PostgreSQL database first.

Local development:

```powershell
npx prisma migrate dev
```

Deployment:

```powershell
npx prisma migrate deploy
```

Partition behaviour cannot be validated with SQLite.

Confirm that the parent is partitioned:

```sql
SELECT c.relname, c.relkind
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'PushNotificationLog';
```

Expected `relkind`:

```text
p
```

List attached children:

```sql
SELECT parent.relname AS parent_table,
       child.relname AS partition_table
FROM pg_inherits
JOIN pg_class AS parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class AS child ON pg_inherits.inhrelid = child.oid
JOIN pg_namespace AS ns ON parent.relnamespace = ns.oid
WHERE ns.nspname = 'public'
  AND parent.relname = 'PushNotificationLog'
ORDER BY child.relname;
```

Inspect exact bounds:

```sql
SELECT child.relname AS partition_table,
       pg_get_expr(child.relpartbound, child.oid) AS partition_bound
FROM pg_inherits
JOIN pg_class AS parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class AS child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'PushNotificationLog'
ORDER BY child.relname;
```

Use catalogue metadata instead of trusting a table name alone.

## Automated monthly creation

`autoCreateUpcomingPartitions()` in `src/lib/partitionMaintenance.ts` ensures
children exist for:

- the current month;
- the next month;
- the month after next.

Pre-creating two future months reduces the chance that inserts fail at a month
boundary.

Generated SQL is equivalent to:

```sql
CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2026m08"
PARTITION OF "PushNotificationLog"
FOR VALUES FROM ('2026-08-01 00:00:00')
TO ('2026-09-01 00:00:00');
```

Ranges must never overlap.

## Cron operation

The GET handler in `src/app/api/cron/reminders/route.ts` invokes partition
creation before reminder processing.

The route currently validates `CRON_SECRET_TOKEN` through the `key` query
parameter:

```text
/api/cron/reminders?key=<CRON_SECRET_TOKEN>
```

Store the secret in encrypted deployment configuration. Never commit it or log
it.

Run partition maintenance at least once daily. A suitable example is:

```text
15 2 * * *
```

This runs at 02:15 in the scheduler's configured timezone. A dedicated
maintenance endpoint is preferable when partition creation and reminder
delivery need independent schedules.

Manual example for January 2027:

```sql
CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2027m01"
PARTITION OF "PushNotificationLog"
FOR VALUES FROM ('2027-01-01 00:00:00')
TO ('2027-02-01 00:00:00');
```

After manual creation, verify attachment through `pg_inherits`.

## Health monitoring

The administrative endpoint is:

```text
GET /api/admin/system/partitions
```

It calls `checkPartitionHealth()` and checks the current and next month.

Example response:

```json
{
  "status": "HEALTHY",
  "checkedAt": "2026-07-25T06:30:00.000Z",
  "partitions": [
    {
      "name": "PushNotificationLog_y2026m07",
      "exists": true,
      "rowCount": 1250
    },
    {
      "name": "PushNotificationLog_y2026m08",
      "exists": true,
      "rowCount": 0
    }
  ]
}
```

A `CRITICAL` report returns HTTP `500`. Protect this endpoint with administrator
or internal-monitoring authentication in production.

`rowCount` is based on PostgreSQL statistics and may be an estimate. Use an
exact count only when needed:

```sql
SELECT COUNT(*) FROM "PushNotificationLog_y2026m07";
```

## Query examples

Recent failed deliveries:

```sql
SELECT "id", "userId", "venueId", "error", "createdAt"
FROM "PushNotificationLog"
WHERE "status" = 'FAILED'
  AND "createdAt" >= NOW() - INTERVAL '7 days'
ORDER BY "createdAt" DESC;
```

One month:

```sql
SELECT "id", "userId", "status", "createdAt"
FROM "PushNotificationLog"
WHERE "createdAt" >= TIMESTAMP '2026-07-01 00:00:00'
  AND "createdAt" <  TIMESTAMP '2026-08-01 00:00:00'
ORDER BY "createdAt" DESC;
```

One user's recent history:

```sql
SELECT "title", "body", "status", "read", "createdAt"
FROM "PushNotificationLog"
WHERE "userId" = 'user_example'
  AND "createdAt" >= NOW() - INTERVAL '90 days'
ORDER BY "createdAt" DESC;
```

Daily volume:

```sql
SELECT DATE_TRUNC('day', "createdAt") AS day,
       COUNT(*) AS delivery_count
FROM "PushNotificationLog"
WHERE "createdAt" >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', "createdAt")
ORDER BY day;
```

Current-month totals by status:

```sql
SELECT "status", COUNT(*) AS total
FROM "PushNotificationLog"
WHERE "createdAt" >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY "status"
ORDER BY total DESC;
```

Date predicates are important. Without them, PostgreSQL may scan every child.

Confirm pruning:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "PushNotificationLog"
WHERE "createdAt" >= TIMESTAMP '2026-07-01 00:00:00'
  AND "createdAt" <  TIMESTAMP '2026-08-01 00:00:00';
```

The plan should scan only the matching month.

## Retention policy

The recommended default is six complete months unless product, audit, legal,
security, or contractual requirements demand longer retention.

Before removing a month, confirm:

- no incident-response investigation needs it;
- no legal or regulatory hold applies;
- analytics no longer depend on it;
- a verified backup exists;
- the exact candidate month is correct.

Use calendar months rather than an approximate day count.

## Safe removal workflow

Do not begin by dropping an attached child. Use this sequence:

1. identify the exact expired partition;
2. inspect its bounds and row count;
3. detach it from the parent;
4. verify parent queries still succeed;
5. archive or export the standalone table;
6. drop it only after approval and backup verification.

Detach example:

```sql
ALTER TABLE "PushNotificationLog"
DETACH PARTITION "PushNotificationLog_y2025m12";
```

On supported PostgreSQL versions, concurrent detachment may reduce blocking:

```sql
ALTER TABLE "PushNotificationLog"
DETACH PARTITION "PushNotificationLog_y2025m12"
CONCURRENTLY;
```

`CONCURRENTLY` has version and transaction restrictions. Test the exact command
against the deployed PostgreSQL version.

Create an archive schema once:

```sql
CREATE SCHEMA IF NOT EXISTS push_notification_archive;
```

Move the detached table:

```sql
ALTER TABLE "PushNotificationLog_y2025m12"
SET SCHEMA push_notification_archive;
```

The archived relation becomes:

```text
push_notification_archive."PushNotificationLog_y2025m12"
```

Export it before deletion:

```powershell
pg_dump `
  --dbname="$env:DATABASE_URL" `
  --table='push_notification_archive."PushNotificationLog_y2025m12"' `
  --format=custom `
  --file="PushNotificationLog_y2025m12.dump"
```

Verify the dump can be inspected or restored.

Drop only after approval:

```sql
DROP TABLE push_notification_archive."PushNotificationLog_y2025m12";
```

Avoid `CASCADE` unless dependencies were reviewed.

A short detach-and-archive transaction:

```sql
BEGIN;
ALTER TABLE "PushNotificationLog"
DETACH PARTITION "PushNotificationLog_y2025m12";
ALTER TABLE "PushNotificationLog_y2025m12"
SET SCHEMA push_notification_archive;
COMMIT;
```

Keep the transaction short. Perform slow exports after it completes.

## Lock checks

Review active sessions before maintenance:

```sql
SELECT pid, usename, state, wait_event_type, wait_event, query_start, query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start;
```

Review locks involving notification relations:

```sql
SELECT relation::regclass AS relation, mode, granted, pid
FROM pg_locks
WHERE relation IS NOT NULL
  AND relation::regclass::text ILIKE '%PushNotificationLog%';
```

Postpone maintenance when unexpected long-running transactions make detachment
unsafe.

## Index and time-zone guidance

Common access paths include:

```text
createdAt
status
userId + createdAt
read + userId
```

Use real query plans before adding indexes. Avoid duplicate child indexes when
a parent partitioned index already provides the required structure.

Generate month boundaries consistently. The maintenance helper uses JavaScript
`Date`, so production cron jobs should run in a predictable timezone,
preferably UTC. Test month transitions around daylight-saving changes.

## Troubleshooting

### No partition found for row

Typical error:

```text
no partition of relation "PushNotificationLog" found for row
```

Inspect the row's `createdAt`, create the missing month, retry the insert, and
verify the cron schedule and health endpoint.

### Overlapping partition bounds

PostgreSQL rejects overlapping ranges. List existing bounds and correct the new
start or end timestamp. Never remove an existing child without reviewing its
data.

### Existing table with the expected name

`CREATE TABLE IF NOT EXISTS` does not prove that a same-named table is attached
to the correct parent with the correct bounds. Verify through PostgreSQL
catalogues.

### Prisma migration drift

Raw SQL partitioning may differ from what Prisma infers from `schema.prisma`.

```powershell
npx prisma migrate status
```

Do not use destructive reset commands on shared databases merely to clear
partitioning drift. Document manual SQL changes.

## Month-boundary test

Use valid foreign-key values in a disposable database.

```sql
INSERT INTO "PushNotificationLog"
("id", "userId", "title", "body", "status", "read", "createdAt")
VALUES
('partition-test-july', 'valid-test-user', 'July test',
 'Boundary verification', 'SENT', false,
 TIMESTAMP '2026-07-31 23:59:59.999'),
('partition-test-august', 'valid-test-user', 'August test',
 'Boundary verification', 'SENT', false,
 TIMESTAMP '2026-08-01 00:00:00');
```

Confirm physical placement:

```sql
SELECT "id", tableoid::regclass AS physical_partition
FROM "PushNotificationLog"
WHERE "id" IN ('partition-test-july', 'partition-test-august')
ORDER BY "id";
```

The rows should appear in different monthly children.

## Validation checklist

Before merging or deploying:

- apply the migration to disposable PostgreSQL;
- confirm the parent has `relkind = p`;
- list attached children and bounds;
- verify current and next-month partitions exist;
- test inserts on both sides of a month boundary;
- query through the parent table;
- run `EXPLAIN` for a date-bounded query;
- call the health endpoint;
- test cron authentication;
- detach a disposable expired child;
- confirm detached rows remain available directly.

## Operational checklist

At each month boundary:

- confirm the current child exists;
- confirm the next child exists;
- verify the cron ran successfully;
- review the health response;
- investigate unexpected row-count changes.

During retention:

- calculate the cutoff month;
- list and verify exact candidates;
- check holds and backup requirements;
- detach one child at a time;
- archive or export it;
- verify the backup;
- drop only after approval;
- record the operation.

## Security and rollback

Partition maintenance executes DDL. Never build maintenance SQL from untrusted
input or pass user-controlled values to `$executeRawUnsafe`. Protect cron and
admin endpoints server-side. Never log database credentials or cron secrets.

If an incorrectly bounded child is empty:

```sql
ALTER TABLE "PushNotificationLog"
DETACH PARTITION "incorrect_partition";
DROP TABLE "incorrect_partition";
```

Then create the corrected child.

If it contains data, stop writes, take a backup, and use a reviewed migration
plan. Do not improvise destructive SQL in production.

## Summary

WorkSphere queries a stable `PushNotificationLog` parent while PostgreSQL routes
rows by `createdAt` into monthly children. The maintenance helper pre-creates
the current and next two months, and the health route checks current and
next-month readiness. Expired months should be detached, archived, verified,
and only then dropped.
