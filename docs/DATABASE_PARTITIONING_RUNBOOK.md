# PostgreSQL Declarative Partition Management & Archival Runbook

This runbook outlines the operational procedures, table schemas, automated maintenance jobs, cold storage export workflows, and manual emergency interventions for PostgreSQL monthly declarative partition tables in WorkSphere.

---

## 1. Architecture & Table Schema Overview

WorkSphere employs **PostgreSQL Declarative Range Partitioning** to manage high-throughput, time-series data without experiencing table bloat, degraded index performance, or long autovacuum lockups.

### Partitioned Parent Tables
1. **`TelemetryRecord`**: Captures real-time environment telemetry (Wi-Fi latency, noise level, occupancy, presence).
   - Partition Key: `timestamp` (`TIMESTAMPTZ`)
   - Partition Strategy: `RANGE (timestamp)`
   - Child Table Naming: `TelemetryRecord_yYYYYmMM` (e.g. `TelemetryRecord_y2026m10`)
   - Retention Period: **12 Months**
2. **`PushNotificationLog`**: Records outbound web push and in-app notifications.
   - Partition Key: `createdAt` (`TIMESTAMPTZ`)
   - Partition Strategy: `RANGE (createdAt)`
   - Child Table Naming: `PushNotificationLog_yYYYYmMM` (e.g. `PushNotificationLog_y2026m10`)
   - Retention Period: **6 Months**
3. **`AdminAuditLog` / `WifiTelemetry` / `AcousticTelemetry`**: Additional audit and signal partitioned tables managed via `src/lib/partitionRetention.ts`.

### Canonical DDL Schemas

#### Parent Tables
```sql
-- TelemetryRecord Parent
CREATE TABLE "TelemetryRecord" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "download" DOUBLE PRECISION,
    "upload" DOUBLE PRECISION,
    "latency" DOUBLE PRECISION,
    "noiseLevel" DOUBLE PRECISION,
    "occupancy" INTEGER,
    "presence" INTEGER,
    "crowdLevel" TEXT,
    CONSTRAINT "TelemetryRecord_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

-- PushNotificationLog Parent
CREATE TABLE "PushNotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "PushNotificationLog_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");
```

#### Monthly Child Partitions
```sql
-- Example for October 2026
CREATE TABLE IF NOT EXISTS "TelemetryRecord_y2026m10"
PARTITION OF "TelemetryRecord"
FOR VALUES FROM ('2026-10-01T00:00:00.000Z') TO ('2026-11-01T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2026m10"
PARTITION OF "PushNotificationLog"
FOR VALUES FROM ('2026-10-01T00:00:00.000Z') TO ('2026-11-01T00:00:00.000Z');
```

---

## 2. Automated Maintenance (Cron Jobs & `partitionMaintenance.ts`)

Partition lifecycle management is automated via `src/lib/partitionMaintenance.ts` and triggered on a scheduled basis by Vercel Cron.

### Scheduled Execution
- **Endpoint**: `GET /api/cron/partition-maintenance`
- **Schedule**: `0 2 1 * *` (Runs on the 1st day of every month at 02:00 UTC)
- **Authorization**: Bearer token via `CRON_SECRET` header
- **Timeout Ceiling**: 300 seconds (`maxDuration = 300`)

### Core Maintenance Phases

```
+-----------------------------------------------------------------------------------+
|                  MONTHLY PARTITION MAINTENANCE LIFECYCLE                          |
+-----------------------------------------------------------------------------------+
| 1. Auto-Provisioning                                                             |
|    - Computes offsets [0, 1, 2] (Current month, M+1, M+2)                        |
|    - Executes CREATE TABLE IF NOT EXISTS ... PARTITION OF ...                     |
|                                                                                   |
| 2. Partition Health & Storage Audit                                               |
|    - Queries pg_stat_user_tables and pg_total_relation_size()                     |
|    - Flags tables approaching COLD_STORAGE_THRESHOLD_BYTES (100 MB)               |
|                                                                                   |
| 3. Expiration Identification & Detachment                                        |
|    - Evaluates cutoff: now - (retentionMonths - 1)                                |
|    - ALTER TABLE ... DETACH PARTITION ...                                         |
|    - Moves detached tables to archive schema (telemetry_archive / push_archive)   |
|                                                                                   |
| 4. Vacuum & Re-indexing                                                           |
|    - VACUUM (ANALYZE) active partitions to refresh query planner stats            |
|                                                                                   |
| 5. Audit Logging                                                                  |
|    - Records outcome in AdminAuditLog for compliance and observability            |
+-----------------------------------------------------------------------------------+
```

### TypeScript Maintenance APIs
- `autoCreateUpcomingPartitions(now)`: Pre-creates partitions for current and upcoming 2 months to guarantee zero insert downtime.
- `archiveExpiredTelemetryPartitions({ now, retentionMonths: 12 })`: Detaches expired telemetry partitions and moves them to `telemetry_archive`.
- `archiveExpiredPushNotificationPartitions({ now, retentionMonths: 6 })`: Detaches expired notification logs to `push_notification_archive`.
- `checkPartitionHealth()`: Evaluates partition existence, row counts, and table sizes against storage thresholds.

---

## 3. Cold Storage Export & Detachment Procedures

When a partition reaches its retention cutoff or exceeds storage quotas (100 MB+), it must be exported to cold storage (CSV / S3) prior to schema relocation or dropping.

### 3.1. Automated Cold Storage Export via API
Administrators can stream compressed CSV exports directly:
- **Endpoint**: `GET /api/admin/system/partitions/export?year=YYYY&month=MM&type=telemetry`
- **Authentication**: Requires admin role (`getAdminUser()`)
- **Streaming**: Streams batched rows (1,000 per chunk) in chunked transfer encoding with zero memory overhead.

### 3.2. Manual Partition Detachment Runbook

Execute within a database maintenance transaction:

```sql
BEGIN;

-- 1. Ensure archive schema exists
CREATE SCHEMA IF NOT EXISTS "telemetry_archive";

-- 2. Detach partition from active query routing
ALTER TABLE "TelemetryRecord" DETACH PARTITION "TelemetryRecord_y2025m09";

-- 3. Relocate table to archive schema
ALTER TABLE "TelemetryRecord_y2025m09" SET SCHEMA "telemetry_archive";

COMMIT;
```

### 3.3. Exporting to Cold Storage (S3 / Compressed Archive)

Using `pg_dump` or `\copy` CLI utility:

```bash
# Export detached table as gzip-compressed CSV
psql "$DATABASE_URL" -c "\copy telemetry_archive.\"TelemetryRecord_y2025m09\" TO STDOUT WITH CSV HEADER" | gzip > TelemetryRecord_y2025m09.csv.gz

# Upload to S3 Cold Storage Glacier / Archive tier
aws s3 cp TelemetryRecord_y2025m09.csv.gz s3://worksphere-cold-storage/telemetry/2025/TelemetryRecord_y2025m09.csv.gz --storage-class GLACIER
```

### 3.4. Dropping Archived Tables Post-Verification

Once backup verification passes:

```sql
DROP TABLE "telemetry_archive"."TelemetryRecord_y2025m09";
```

---

## 4. Operational Troubleshooting & Runbook Scenarios

### Scenario A: Insert Failure Due to Missing Partition
- **Symptom**: `ERROR: no partition of relation "TelemetryRecord" found for row`
- **Root Cause**: Cron job failed to run before midnight of the new calendar month.
- **Resolution**:
  1. Trigger immediate emergency creation:
     ```bash
     curl -X GET "https://worksphere.app/api/cron/partition-maintenance" \
       -H "Authorization: Bearer $CRON_SECRET"
     ```
  2. Or run emergency SQL directly:
     ```sql
     CREATE TABLE IF NOT EXISTS "TelemetryRecord_y2026m11"
     PARTITION OF "TelemetryRecord"
     FOR VALUES FROM ('2026-11-01T00:00:00.000Z') TO ('2026-12-01T00:00:00.000Z');
     ```

### Scenario B: Lock Timeout on `ALTER TABLE ... DETACH PARTITION`
- **Symptom**: Detachment queries hang waiting for AccessExclusiveLock.
- **Root Cause**: Active long-running analytic queries against the partition.
- **Resolution**:
  - Set brief lock timeout before detaching:
    ```sql
    SET lock_timeout = '5s';
    ALTER TABLE "TelemetryRecord" DETACH PARTITION "TelemetryRecord_y2025m09" CONCURRENTLY;
    ```
