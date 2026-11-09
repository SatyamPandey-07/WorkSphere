# PostgreSQL Declarative Table Partitioning & Archive Lifecycle Manual

This comprehensive guide details the architecture, implementation patterns, maintenance automation, query optimization, and cold-storage archiving workflows for **PostgreSQL Native Declarative Range Partitioning** across WorkSphere's high-throughput relational datasets: **Audit Logs**, **Real-Time Telemetry**, and **Seat/Desk Check-Ins**.

---

## 1. Architectural Overview & Philosophy

### 1.1 The Challenge of High-Throughput Write Workloads

WorkSphere processes continuous streams of events across multiple subsystems:
- **Audit Logs** (`AdminAuditLog`, `SecurityAuditLog`): Immutable audit trails recording authentication, role changes, privilege escalations, and administrative events.
- **Telemetry & IoT Metrics** (`TelemetryRecord`, `WifiTelemetry`, `NoiseMetric`): Continuous high-frequency time-series feeds emitted by workspace sensors, edge nodes, and mobile clients (Wi-Fi latency, noise decibels, ambient light, room occupancy).
- **Check-Ins & Presence** (`DeskCheckIn`, `VenuePresenceLog`): High-volume physical and virtual seat check-in/check-out events, QR scans, and dwell-time pings.

In a monolithic unpartitioned table design, high-velocity append workloads cause operational friction over time:
1. **B-Tree Index Degradation**: Index trees outgrow available RAM (`shared_buffers`), leading to random disk I/O on every insert and query.
2. **Autovacuum Bloat & Lock Contention**: PostgreSQL autovacuum workers spend hours traversing hundreds of millions of dead tuples in massive heap files, causing transaction ID wraparound risks and I/O bottlenecks.
3. **Expensive Deletions**: Deleting expired historical records via `DELETE FROM table WHERE created_at < NOW() - INTERVAL '90 days'` generates heavy Write-Ahead Log (WAL) traffic, locks rows, fragments storage pages, and triggers cascading vacuuming.
4. **Degraded Query Latency**: Scans spanning recent data must traverse massive table pages or filter through deep index levels.

```
Monolithic Table (Anti-Pattern at Scale)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 100M+ Rows Heap File (Multi-Gigabyte B-Tree Indexes in shared_buffers)     │
│ [Jan 2024] [Feb 2024] ... [Sep 2026] [Oct 2026] [Nov 2026]                  │
│ DELETE FROM table WHERE timestamp < cutoff;  --> Massive WAL + Dead Tuples  │
└─────────────────────────────────────────────────────────────────────────────┘

Declarative Range Partitioning (WorkSphere Architecture)
┌─────────────────────────────────────────────────────────────────────────────┐
│ Parent Routing Table (Declarative Metadata Only - Zero Physical Rows)       │
│ PARTITION BY RANGE ("timestamp" / "createdAt" / "checkInTime")             │
└──────────────┬───────────────────────────────┬──────────────────────────────┘
               │                               │
    ┌──────────▼──────────┐         ┌──────────▼──────────┐
    │  Partition Oct 2026 │         │  Partition Nov 2026 │
    │  (Hot - Small Index)│         │  (Warm / Active)    │
    └─────────────────────┘         └─────────────────────┘
               │
    ┌──────────▼──────────┐
    │  Partition Oct 2025 │ ──> DETACH & MOVE TO ARCHIVE ──> S3/Parquet Cold Store
    │  (Cold - Detachable)│     O(1) DDL operation (Zero dead tuples, zero WAL)
    └─────────────────────┘
```

### 1.2 Declarative Partitioning Benefits

PostgreSQL Native Declarative Partitioning (introduced in PG 10 and mature in PG 13+) provides:
- **Declarative DDL**: Clean SQL syntax (`PARTITION BY RANGE`) without brittle trigger functions or manual constraint rules (`CHECK` constraints with `pg_inherits`).
- **Static and Dynamic Partition Pruning**: The PostgreSQL query planner and executor exclude non-matching child partitions before or during execution, scanning only relevant tables.
- **Constant-Time Data Eviction**: Retiring old data is an $O(1)$ DDL operation (`ALTER TABLE DETACH PARTITION` followed by `DROP TABLE` or schema relocation).
- **Targeted Maintenance**: `VACUUM`, `ANALYZE`, and `REINDEX` can be executed on individual active child tables without scanning historical partitions.
- **Storage Tiering**: Historical tables can be placed in separate tablespaces, converted to compressed column formats, or exported to cold object storage.

---

## 2. Core Partitioning Strategy & Key Design

### 2.1 Partition Key Selection & Composite Constraints

PostgreSQL declarative partitioning enforces a fundamental constraint rule:

> **Unique / Primary Key Requirement**: Every unique constraint or primary key on a partitioned table **must include all partition key columns**.

| Domain Table | Partition Column | Data Type | Interval | Retention Period | Primary Key Structure |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`AdminAuditLog`** | `timestamp` | `TIMESTAMPTZ` | 1 Month | 36 Months (3 Years) | `("id", "timestamp")` |
| **`TelemetryRecord`** | `timestamp` | `TIMESTAMPTZ` | 1 Month | 12 Months (1 Year) | `("id", "timestamp")` |
| **`NoiseMetric` / `WifiTelemetry`**| `recordedAt` | `TIMESTAMPTZ` | 1 Month | 3 Months (90 Days) | `("id", "recordedAt")` |
| **`DeskCheckIn`** | `checkInTime` | `TIMESTAMPTZ` | 1 Month | 24 Months (2 Years) | `("id", "checkInTime")` |

### 2.2 Granularity Decision Matrix: Monthly vs. Daily

- **Monthly Partitions (Standard in WorkSphere)**:
  - *Sweet spot for table catalog management*: 12 to 36 child tables per parent.
  - Keeps PostgreSQL catalog metadata (`pg_class`, `pg_inherits`, `pg_attribute`) lightweight.
  - Overhead per query plan remains minimal (< 0.5 ms planning time).
- **Daily Partitions**:
  - Reserved only for extreme ingestion rates (> 50 million writes/day). Avoided in WorkSphere because having 365+ child tables per year increases query planning latency and memory consumption.

---

## 3. Canonical DDL Schemas & Indexing

### 3.1 Parent Partitioned Tables

The parent table acts as a logical schema definition. It holds no rows directly.

```sql
-- ============================================================================
-- 1. AUDIT LOGS: AdminAuditLog
-- ============================================================================
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipAddress" INET,
    "userAgent" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

-- Partition-level indexes propagated to child tables
CREATE INDEX IF NOT EXISTS "AdminAuditLog_timestamp_idx" ON "AdminAuditLog" ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS "AdminAuditLog_actorId_timestamp_idx" ON "AdminAuditLog" ("actorId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "AdminAuditLog_resource_idx" ON "AdminAuditLog" ("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_payload_gin_idx" ON "AdminAuditLog" USING GIN ("payload");

-- ============================================================================
-- 2. TELEMETRY: TelemetryRecord
-- ============================================================================
CREATE TABLE IF NOT EXISTS "TelemetryRecord" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "venueId" TEXT NOT NULL,
    "sensorId" TEXT,
    "downloadSpeedMbps" DOUBLE PRECISION,
    "uploadSpeedMbps" DOUBLE PRECISION,
    "latencyMs" DOUBLE PRECISION,
    "noiseDecibels" DOUBLE PRECISION,
    "occupancyCount" INTEGER,
    "presenceScore" DOUBLE PRECISION,
    "metadata" JSONB,
    CONSTRAINT "TelemetryRecord_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

CREATE INDEX IF NOT EXISTS "TelemetryRecord_venue_time_idx" ON "TelemetryRecord" ("venueId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "TelemetryRecord_timestamp_idx" ON "TelemetryRecord" ("timestamp" DESC);

-- ============================================================================
-- 3. CHECK-INS: DeskCheckIn
-- ============================================================================
CREATE TABLE IF NOT EXISTS "DeskCheckIn" (
    "id" TEXT NOT NULL,
    "checkInTime" TIMESTAMPTZ NOT NULL,
    "checkOutTime" TIMESTAMPTZ,
    "userId" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED'
    "verificationMethod" TEXT NOT NULL,      -- 'QR_CODE', 'BLE_BEACON', 'MANUAL', 'GEOFENCE'
    "durationMinutes" INTEGER,
    "metadata" JSONB,
    CONSTRAINT "DeskCheckIn_pkey" PRIMARY KEY ("id", "checkInTime")
) PARTITION BY RANGE ("checkInTime");

CREATE INDEX IF NOT EXISTS "DeskCheckIn_user_time_idx" ON "DeskCheckIn" ("userId", "checkInTime" DESC);
CREATE INDEX IF NOT EXISTS "DeskCheckIn_desk_time_idx" ON "DeskCheckIn" ("deskId", "checkInTime" DESC);
CREATE INDEX IF NOT EXISTS "DeskCheckIn_venue_time_idx" ON "DeskCheckIn" ("venueId", "checkInTime" DESC);
CREATE INDEX IF NOT EXISTS "DeskCheckIn_status_idx" ON "DeskCheckIn" ("status") WHERE "status" = 'ACTIVE';
```

### 3.2 Monthly Child Partition Provisioning

Child tables declare explicit, non-overlapping half-open bounds: `[FROM, TO)`.

```sql
-- Provisioning child partitions for October, November, December 2026

-- TelemetryRecord
CREATE TABLE IF NOT EXISTS "TelemetryRecord_y2026m10"
PARTITION OF "TelemetryRecord"
FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS "TelemetryRecord_y2026m11"
PARTITION OF "TelemetryRecord"
FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS "TelemetryRecord_y2026m12"
PARTITION OF "TelemetryRecord"
FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- AdminAuditLog
CREATE TABLE IF NOT EXISTS "AdminAuditLog_y2026m10"
PARTITION OF "AdminAuditLog"
FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

-- DeskCheckIn
CREATE TABLE IF NOT EXISTS "DeskCheckIn_y2026m10"
PARTITION OF "DeskCheckIn"
FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
```

### 3.3 The "Default Partition" Dilemma

PostgreSQL allows creating a default partition:
```sql
-- CAUTION: Avoid in high-volume production tables
CREATE TABLE "TelemetryRecord_default" PARTITION OF "TelemetryRecord" DEFAULT;
```

> [!WARNING]
> **Why WorkSphere strictly avoids default partitions**:
> When a default partition contains data, attaching a new monthly partition requires PostgreSQL to run an exhaustive table scan of the default partition to verify no records conflict with the new range. Under high write loads, this scan acquires an `EXCLUSIVE LOCK` on the default table, blocking all incoming writes.
>
> **Best Practice**: Always auto-provision prospective partitions ahead of time via scheduled automation (lookahead window = $M, M+1, M+2$). If an insert falls out of range, fail fast and alert rather than poisoning a default partition.

---

## 4. Automated Partition Lifecycle Management

WorkSphere runs automated partition maintenance via a hardened Next.js background cron worker triggered by Vercel Cron or Kubernetes CronJob.

### 4.1 Rolling Provisioning Window

The automated job runs on the 1st day of each month at 02:00 UTC and performs a 3-month forward lookahead:
- **Month $M$ (Current)**: Validates existence and verifies index health.
- **Month $M+1$ (Next)**: Pre-creates partition table and local indexes.
- **Month $M+2$ (Prospective)**: Pre-creates failover partition buffer.

```
Timeline: [Past Partitions...] ──> [Current (M)] ──> [M+1 (Provisioned)] ──> [M+2 (Buffer)]
                                      ▲
                                 (Cron Runs)
```

### 4.2 Distributed Advisory Locking

To prevent race conditions when multiple serverless functions or container replicas trigger maintenance simultaneously, all DDL operations are guarded by a dedicated 64-bit PostgreSQL advisory lock.

```typescript
// src/lib/db/partitionManager.ts
import { prisma } from "@/lib/prisma";

const PARTITION_ADVISORY_LOCK_ID = 3445;

export async function withPartitionMaintenanceLock<T>(
  callback: (tx: typeof prisma) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Acquire transactional exclusive advisory lock
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${PARTITION_ADVISORY_LOCK_ID}, 1)`
    );
    return callback(tx as typeof prisma);
  });
}
```

### 4.3 Safe Provisioning Algorithm

```typescript
export interface PartitionBoundary {
  name: string;
  tableName: string;
  startDate: string; // ISO string 'YYYY-MM-DD'
  endDate: string;   // ISO string 'YYYY-MM-DD'
}

export function calculatePartitionBounds(
  tableName: string,
  targetDate: Date
): PartitionBoundary {
  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth(); // 0-indexed

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  const monthString = String(month + 1).padStart(2, "0");
  const name = `${tableName}_y${year}m${monthString}`;

  return {
    name,
    tableName,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export async function autoProvisionFuturePartitions(
  parentTables: string[],
  monthsAhead = 2
): Promise<string[]> {
  const createdPartitions: string[] = [];
  const now = new Date();

  await withPartitionMaintenanceLock(async (tx) => {
    for (const table of parentTables) {
      for (let offset = 0; offset <= monthsAhead; offset++) {
        const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
        const bounds = calculatePartitionBounds(table, target);

        const sql = `
          CREATE TABLE IF NOT EXISTS "${bounds.name}"
          PARTITION OF "${bounds.tableName}"
          FOR VALUES FROM ('${bounds.startDate}') TO ('${bounds.endDate}');
        `;
        
        await tx.$executeRawUnsafe(sql);
        createdPartitions.push(bounds.name);
      }
    }
  });

  return createdPartitions;
}
```

---

## 5. Data Retention, Detachment & Archive Lifecycle

WorkSphere enforces a 4-tier storage lifecycle to balance query performance, storage costs, and compliance rules.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       WORKSPEERE DATA LIFECYCLE TIERS                       │
├──────────────┬──────────────────┬─────────────────┬─────────────────────────┤
│ Tier         │ State            │ Storage         │ Query Performance       │
├──────────────┼──────────────────┼─────────────────┼─────────────────────────┤
│ Hot          │ Attached (0-3 mo)│ SSD (RAM Cache) │ Sub-millisecond (OLTP)  │
│ Warm         │ Attached (3-12mo)│ SSD             │ Single-digit ms (OLTP)  │
│ Cold (Det.)  │ Detached Schema  │ Standard HDD/SSD│ Direct table scan only  │
│ Frozen (S3)  │ Parquet / Gzip   │ S3 / Object St. │ Athena / DuckDB / S3-Gl │
│ Purged       │ Dropped          │ -               │ Irreversible Deletion   │
└──────────────┴──────────────────┴─────────────────┴─────────────────────────┘
```

### 5.1 Non-Blocking Partition Detachment

In high-concurrency environments, `ALTER TABLE DETACH PARTITION` can block incoming writes if running transactions hold locks on the parent table.

PostgreSQL 14+ supports concurrent detachment:

```sql
-- Step 1: Detach concurrently (non-blocking)
ALTER TABLE "TelemetryRecord" 
DETACH PARTITION "TelemetryRecord_y2025m09" CONCURRENTLY;
```

> [!NOTE]
> `DETACH PARTITION CONCURRENTLY` cannot run inside a multi-command transaction block (`BEGIN ... COMMIT`). It must run as a single standalone DDL statement.

### 5.2 Archive Schema Relocation

After detachment, the child table becomes an independent standalone table. WorkSphere moves expired tables to an archive schema to maintain clean application catalogs:

```sql
-- Create archive schemas if not present
CREATE SCHEMA IF NOT EXISTS "telemetry_archive";
CREATE SCHEMA IF NOT EXISTS "audit_archive";
CREATE SCHEMA IF NOT EXISTS "checkin_archive";

-- Relocate standalone table into archive schema
ALTER TABLE "TelemetryRecord_y2025m09" 
SET SCHEMA "telemetry_archive";
```

### 5.3 Export Pipeline to Cold Storage (Parquet / Gzip CSV)

Detached tables are exported to S3 or Google Cloud Storage using `COPY TO` or pg_dump before final dropping:

```sql
-- Stream compressed CSV directly to archive volume
COPY "telemetry_archive"."TelemetryRecord_y2025m09"
TO PROGRAM 'gzip > /mnt/storage/archives/telemetry/TelemetryRecord_y2025m09.csv.gz'
WITH (FORMAT CSV, HEADER, DELIMITER ',');
```

For Parquet conversion, WorkSphere uses an asynchronous worker with DuckDB:

```bash
# Convert CSV.GZ archive directly to Parquet with SNAPPY compression
duckdb -c "
  COPY (
    SELECT * FROM read_csv_auto('/mnt/storage/archives/telemetry/TelemetryRecord_y2025m09.csv.gz')
  ) TO 's3://worksphere-cold-storage/telemetry/year=2025/month=09/data.parquet' 
  (FORMAT PARQUET, COMPRESSION SNAPPY);
"
```

### 5.4 Instant Eviction ($O(1)$ Drop)

Once verification checksums match the object storage upload, the archived table is dropped instantly with zero table bloat and zero WAL overhead:

```sql
DROP TABLE IF EXISTS "telemetry_archive"."TelemetryRecord_y2025m09";
```

---

## 6. Query Optimization & Partition Pruning

### 6.1 Static vs. Dynamic Partition Pruning

PostgreSQL evaluates partition pruning at two stages:
1. **Plan-Time (Static Pruning)**: Occurs during query planning when SQL queries include constant literal timestamps. Non-matching partitions are stripped from the plan tree entirely.
2. **Execution-Time (Dynamic Pruning)**: Occurs during execution when the query filter relies on parameters, subqueries, or dynamic functions (e.g., `NOW() - INTERVAL '7 days'`).

Ensure partition pruning is enabled in postgresql.conf:
```ini
enable_partition_pruning = on
```

### 6.2 Writing Pruning-Friendly Queries

To guarantee that the query planner touches only the necessary partitions, queries must explicitly include the partition key in the `WHERE` clause.

#### Efficient Query (Pruned to 1 Partition):
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "venueId", "noiseDecibels", "timestamp"
FROM "TelemetryRecord"
WHERE "venueId" = 'venue_clrk98124'
  AND "timestamp" >= '2026-10-15 00:00:00+00'
  AND "timestamp" <  '2026-10-16 00:00:00+00';
```

**Execution Plan Analysis**:
```
Append  (cost=0.28..8.30 rows=1 width=36) (actual time=0.042..0.045 rows=12 loops=1)
  Buffers: shared hit=4
  ->  Index Scan using TelemetryRecord_y2026m10_venue_time_idx on "TelemetryRecord_y2026m10"  (cost=0.28..8.30 rows=1 width=36)
        Index Cond: (("venueId" = 'venue_clrk98124'::text) AND ("timestamp" >= '2026-10-15 00:00:00+00'::timestamptz) AND ("timestamp" < '2026-10-16 00:00:00+00'::timestamptz))
```
*(Notice: Only `TelemetryRecord_y2026m10` is scanned. Partitions for all other months are completely omitted).*

#### Inefficient Query (Anti-Pattern - Full Scan Across All Partitions):
```sql
-- ANTI-PATTERN: Transforming partition column with functions breaks plan-time pruning
SELECT * 
FROM "TelemetryRecord"
WHERE DATE_TRUNC('month', "timestamp") = '2026-10-01'::timestamptz;
```

---

## 7. Operational Maintenance & Index Strategy

### 7.1 Per-Partition Vacuum & Autovacuum Tuning

High-throughput partitions experience high insert volumes. Tuning autovacuum on hot partitions prevents bloat and updates planner statistics without overloading the system.

```sql
-- Optimize active monthly partition for high write throughput
ALTER TABLE "TelemetryRecord_y2026m10" SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_vacuum_threshold = 1000,
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_analyze_threshold = 500
);
```

### 7.2 Choosing the Right Index Strategy: B-Tree vs. BRIN

For massive append-only telemetry tables where timestamps are strictly monotonic:
- **B-Tree**: High lookup speed for `venueId + timestamp`, but larger index size (~20-30% of table size).
- **BRIN (Block Range Index)**: Extremely small index footprint (~1% of table size). Ideal for scanning large sequential time ranges.

```sql
-- Add BRIN index on physical block order for pure time scans
CREATE INDEX IF NOT EXISTS "TelemetryRecord_y2026m10_timestamp_brin_idx" 
ON "TelemetryRecord_y2026m10" USING BRIN ("timestamp") 
WITH (pages_per_range = 32);
```

---

## 8. Disaster Recovery & Emergency Playbooks

### 8.1 Remediation: Data Ingestion Failure Due to Missing Partition

**Symptom**: Application throws error `no partition of relation "TelemetryRecord" found for row`.  
**Root Cause**: Ingestion timestamp falls outside all active child partition ranges.

**Immediate Resolution**:
```sql
-- Step 1: Identify the offending timestamp from application error logs (e.g. 2027-01-05)
-- Step 2: Provision the missing partition immediately
CREATE TABLE IF NOT EXISTS "TelemetryRecord_y2027m01"
PARTITION OF "TelemetryRecord"
FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

-- Step 3: Trigger the auto-provisioning cron endpoint to verify forward buffers
-- curl -X POST https://app.worksphere.io/api/cron/partition-maintenance -H "Authorization: Bearer $CRON_SECRET"
```

### 8.2 Attaching Historical Restored Partitions

If historical cold data must be temporarily reloaded for a compliance audit:

```sql
-- 1. Restore table from archive backup
CREATE TABLE "telemetry_archive"."TelemetryRecord_y2024m05" (...);
COPY "telemetry_archive"."TelemetryRecord_y2024m05" FROM '/backup/2024-05.csv' WITH CSV HEADER;

-- 2. Add validation constraint prior to attachment to speed up lock acquisition
ALTER TABLE "telemetry_archive"."TelemetryRecord_y2024m05"
ADD CONSTRAINT "check_bounds"
CHECK ("timestamp" >= '2024-05-01 00:00:00+00' AND "timestamp" < '2024-06-01 00:00:00+00');

-- 3. Move to public schema and attach
ALTER TABLE "telemetry_archive"."TelemetryRecord_y2024m05" SET SCHEMA "public";

ALTER TABLE "TelemetryRecord" 
ATTACH PARTITION "TelemetryRecord_y2024m05" 
FOR VALUES FROM ('2024-05-01 00:00:00+00') TO ('2024-06-01 00:00:00+00');

-- 4. Drop redundant check constraint (partition bounds supersede it)
ALTER TABLE "TelemetryRecord_y2024m05" DROP CONSTRAINT "check_bounds";
```

---

## 9. Diagnostic Health & Monitoring Scripts

Run these diagnostic queries to verify partition integrity, bounds, and physical sizes:

```sql
-- Query 1: List all active declarative partitioned parents and their child partitions
SELECT 
    parent.relname AS parent_table,
    child.relname AS child_partition,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bounds,
    pg_size_pretty(pg_total_relation_size(child.oid)) AS total_size,
    pg_stat_get_live_tuples(child.oid) AS estimated_rows
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
JOIN pg_namespace n ON parent.relnamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY parent.relname, child.relname;

-- Query 2: Check for partitions approaching cold-storage threshold (100MB+)
SELECT 
    schemaname,
    relname AS table_name,
    pg_total_relation_size(relid) AS size_bytes,
    pg_size_pretty(pg_total_relation_size(relid)) AS human_size,
    n_live_tup AS live_rows
FROM pg_stat_user_tables
WHERE relname ~ '_(y[0-9]{4}m[0-9]{2})$'
ORDER BY size_bytes DESC;

-- Query 3: Active Advisory Locks
SELECT 
    locktype,
    objid,
    mode,
    granted,
    pid
FROM pg_locks
WHERE locktype = 'advisory';
```

---

## 10. Summary Maintenance Matrix

| Operation | Execution Trigger | Automation Mechanism | Locks Acquired | WAL Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Forward Provisioning** | Monthly (1st @ 02:00 UTC) | `GET /api/cron/partition-maintenance` | `AccessShareLock` on parent | Minimal metadata |
| **Active Read/Write** | Continuous | Application Traffic | `RowExclusiveLock` on child | Normal CRUD |
| **Detachment** | Exceeded Retention Cutoff | `partitionRetention.ts` | `AccessExclusiveLock` (or Concurrent) | Negligible |
| **Archiving** | Post-Detachment | S3 / Cloud Storage Export | Shared lock on detached table | Zero (Out of PG) |
| **Eviction** | Post-Archive Checksum | `DROP TABLE <child>` | Exclusive on detached table only | Zero WAL overhead |
