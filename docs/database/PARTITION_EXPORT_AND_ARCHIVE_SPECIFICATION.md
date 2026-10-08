# Database Partition Export & Archive Schema Specification

## 1. Overview & Architecture

WorkSphere leverages PostgreSQL declarative range partitioning for high-volume time-series and log datasets, specifically `TelemetryRecord` (venue sensor, network, and occupancy telemetry), `PushNotificationLog` (push delivery events), `WifiTelemetry`, `AdminAuditLog`, and `AcousticTelemetry`.

As partitions age past active operational windows (typically 30–90 days), they transition through an archival and export lifecycle to maintain optimal query performance, reduce active database storage overhead, and comply with audit retention policies.

```
[ Active Partition ] (public schema)
        │
        ▼ (Streaming Export)
┌─────────────────────────────────────────────────────────────┐
│  GET /api/admin/system/partitions/export                    │
│  ├─ Web Streams API (TransformStream)                       │
│  ├─ Cursor-based batching (LIMIT 1000 by "id" ASC)          │
│  └─ Immediate TTFB (<500ms), Transfer-Encoding: chunked     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼ (Archive Lifecycle Transition)
┌─────────────────────────────────────────────────────────────┐
│  POST /api/admin/system/partitions/archive                  │
│  ├─ Detach from parent partitioned table                    │
│  ├─ Move to archive schema (e.g., telemetry_archive)        │
│  ├─ Set table to read-only (REVOKE INSERT / UPDATE)         │
│  └─ Atomic transactional or bulk multi-table processing     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
[ Cold Storage / S3 Export / Parquet Transition ]
```

---

## 2. Partition Export API Specification

### 2.1 Endpoint Summary
- **HTTP Method:** `GET`
- **Route:** `/api/admin/system/partitions/export`
- **Access Control:** Requires authenticated Admin session via [getAdminUser()](file:///c:/Users/Rushabh%20Mahajan/Documents/GitHub/WorkSphere/src/lib/admin.ts). Unauthorized requests return `403 Forbidden`.

### 2.2 Query Parameters

| Parameter | Type | Required | Default | Allowed Values | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `type` | `string` | No | `telemetry` | `telemetry`, `push` | Target partition family to export. |
| `year` | `integer` | No | Current UTC Year | `2020` – `2100` | 4-digit calendar year of the partition. |
| `month` | `integer` | No | Current UTC Month | `0` – `11` (0-indexed) | 0-indexed month (`0` = Jan, `11` = Dec). |

### 2.3 Response Headers

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="telemetry-records-2026-10.csv"
Transfer-Encoding: chunked
Cache-Control: private, no-store, max-age=0, must-revalidate
X-Content-Type-Options: nosniff
```

---

## 3. Streaming Engine & Data Formats

### 3.1 Streaming Mechanism (Web `TransformStream`)
To support exporting millions of partition records without Node.js buffer overflows or unbounded heap memory usage, the export route utilizes standard Web `TransformStream` with cursor-based chunking:

1. **Immediate Header Flushed:** The CSV column headers are encoded and written to the stream writer immediately upon route invocation, resulting in time-to-first-byte (TTFB) under 500ms.
2. **Cursor Pagination:** Records are queried in deterministic batches of `1,000` rows using primary key comparison (`"id" > $cursorId ORDER BY "id" ASC LIMIT 1000`). This avoids expensive `OFFSET` scans.
3. **Memory Footprint:** Resident memory is bound to $O(\text{batch\_size})$ (< 50MB RSS), independent of total partition size.
4. **Abort & Disconnect Handling:** The stream listens to `request.signal.addEventListener("abort")`. If a client aborts the download mid-stream, database querying halts immediately and the writer closes cleanly, preventing connection pool starvation.

### 3.2 CSV Export Format & Field Mapping

#### Telemetry Record Export (`type=telemetry`)
Filename: `telemetry-records-YYYY-MM.csv`

| Column Header | Database Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `id` | `String` (CUID/UUID) | Unique record identifier. |
| `venueId` | `venueId` | `String` | Associated venue identifier. |
| `timestamp` | `timestamp` | `ISO 8601 String` | Observation timestamp (UTC). |
| `download` | `download` | `Float` | Measured download speed in Mbps. |
| `upload` | `upload` | `Float` | Measured upload speed in Mbps. |
| `latency` | `latency` | `Float` | Measured round-trip ping in ms. |
| `noiseLevel` | `noiseLevel` | `Float` | Ambient acoustic level in dBA. |
| `occupancy` | `occupancy` | `Float` / `Int` | Observed seat or desk occupancy. |
| `presence` | `presence` | `Boolean` | User presence sensor state. |
| `crowdLevel` | `crowdLevel` | `String` | Evaluated crowd density level (`LOW`, `MODERATE`, `HIGH`, `MAX`). |

#### Push Notification Log Export (`type=push`)
Filename: `push-logs-YYYY-MM.csv`

| Column Header | Database Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `id` | `String` (CUID/UUID) | Unique log entry identifier. |
| `userId` | `userId` | `String` | Target recipient user ID. |
| `venueId` | `venueId` | `String` (Nullable) | Associated venue ID if location-targeted. |
| `title` | `title` | `String` | Notification message title. |
| `body` | `body` | `String` | Notification message body text. |
| `status` | `status` | `String` | Delivery status (`SENT`, `DELIVERED`, `FAILED`, `PENDING`). |
| `error` | `error` | `String` (Nullable) | Error diagnostics if delivery failed. |
| `read` | `read` | `Boolean` | Acknowledgment / read status. |
| `createdAt` | `createdAt` | `ISO 8601 String` | Notification creation timestamp (UTC). |

### 3.3 CSV Escaping Standard
All exported string fields pass through [escapeCsv](file:///c:/Users/Rushabh%20Mahajan/Documents/GitHub/WorkSphere/src/app/api/admin/system/partitions/dateHelper.ts):
- Fields containing commas (`,`), quotes (`"`), newlines (`\n`), or carriage returns (`\r`) are wrapped in double quotes.
- Internal double quotes are escaped as `""`.
- Dates are normalized to standard ISO 8601 strings.

### 3.4 Streaming JSON / NDJSON Format
For programmatic integration and machine-to-machine ETL workflows, partitions support Newline-Delimited JSON (NDJSON) streaming where each row is serialized as a distinct JSON object:

```json
{"id":"clx001","venueId":"ven_123","timestamp":"2026-10-01T00:00:00.000Z","download":124.5,"upload":48.2,"latency":14.2,"noiseLevel":42.1,"occupancy":12,"presence":true,"crowdLevel":"LOW"}
{"id":"clx002","venueId":"ven_123","timestamp":"2026-10-01T00:01:00.000Z","download":118.0,"upload":45.0,"latency":15.0,"noiseLevel":43.5,"occupancy":14,"presence":true,"crowdLevel":"LOW"}
```

---

## 4. Partition Archive Schema & Lifecycle Design

### 4.1 Schema Organization

| Schema Name | Purpose |
| :--- | :--- |
| `public` | Active operational schema. Holds root partitioned tables (`TelemetryRecord`, `PushNotificationLog`, `WifiTelemetry`) and active monthly child partitions. |
| `telemetry_archive` | Archived telemetry child tables detached from the public root table. |
| `push_notification_archive` | Archived push notification logs detached from public routing. |
| `partition_archive` | General-purpose fallback archive schema for audit and acoustic logs. |

### 4.2 Partition Naming Convention
Child partitions adhere to strict naming syntax:
- Format: `<ParentTable>_YYYY_MM` (e.g. `TelemetryRecord_2026_10`, `PushNotificationLog_2026_10`)
- Range Bounds: `FROM ('YYYY-MM-01 00:00:00') TO ('YYYY-NEXT_MONTH-01 00:00:00')`
- Root Table Protection: [isSafePartitionName](file:///c:/Users/Rushabh%20Mahajan/Documents/GitHub/WorkSphere/src/lib/adminPartitionService.ts) enforces that bare parent table names (e.g. `TelemetryRecord`) can never be targeted for detachment, deletion, or renaming.

### 4.3 Bulk Archive API (`POST /api/admin/system/partitions/archive`)

#### Request Payload
```json
{
  "partitions": [
    "TelemetryRecord_2026_06",
    "TelemetryRecord_2026_07"
  ],
  "atomic": true
}
```

#### Archive Execution Sequence
1. **Catalog Verification:** Validates that each partition exists, is attached to a valid parent table in `public`, and has no active DDL locks.
2. **Table Detachment:** Executes `ALTER TABLE "public"."<ParentTable>" DETACH PARTITION "public"."<PartitionName>"`.
3. **Schema Relocation:** Executes `ALTER TABLE "public"."<PartitionName>" SET SCHEMA "<archive_schema>"`.
4. **Access Lockdown:** Revokes write privileges (`INSERT`, `UPDATE`, `DELETE`) on the archived table, setting it to strictly read-only.
5. **Metadata Update:** Updates partition health records and calculates freed active storage bytes.
6. **Atomicity Guarantee:**
   - If `atomic: true`, all operations run inside a single interactive Prisma transaction (`prisma.$transaction`). Failure of any single table rolls back the entire batch.
   - If `atomic: false`, operations run in best-effort mode, returning per-table status summaries (`PROCESSED`, `FAILED`, or `SKIPPED`).

#### Response Payload
```json
{
  "success": true,
  "action": "ARCHIVE",
  "processed": [
    "TelemetryRecord_2026_06",
    "TelemetryRecord_2026_07"
  ],
  "failed": [],
  "freedBytes": 284372992,
  "freedSizePretty": "271.20 MB",
  "timestamp": "2026-10-08T17:20:00.000Z"
}
```

---

## 5. Cold Storage & Retention Automation

### 5.1 Automated Maintenance Cron
- **Route:** `/api/cron/partition-maintenance`
- **Schedule:** Nightly (e.g. `0 2 * * *`)
- **Operations:**
  1. Pre-creates child partitions for $T+1$ and $T+2$ months in advance to prevent write ingestion failures.
  2. Identifies partitions older than retention cutoff (e.g. > 90 days) exceeding `COLD_STORAGE_THRESHOLD_BYTES` (500 MB).
  3. Triggers automated archive migration and logs results to `AdminAuditLog`.

### 5.2 Cold Storage Export (S3 / Parquet)
For long-term compliance (1–7 years):
1. Archived tables in `telemetry_archive` are exported to compressed Apache Parquet format partitioned by `year=YYYY/month=MM/venue_id=XXX`.
2. Uploaded to encrypted cold object storage (AWS S3 Glacier Flexible Retrieval / Azure Blob Cold Tier).
3. Detached PostgreSQL archive tables are dropped once checksum verification completes.
