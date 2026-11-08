# Partition Export API Reference: Query Parameters & Output Formats

This document specifies the technical architecture, request parameters, output serialization formats (`csv`, `json`), authentication model, rate limiting, and database streaming mechanics for the database partition export endpoint:

$$\text{GET } \texttt{/api/admin/system/partitions/export}$$

Implemented in:
- **API Route:** [`src/app/api/admin/system/partitions/export/route.ts`](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/export/route.ts)
- **Partition Lifecycle Engine:** [`src/app/api/admin/system/partitions/route.ts`](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/route.ts)
- **Date & CSV Serialization Utilities:** [`src/app/api/admin/system/partitions/dateHelper.ts`](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/dateHelper.ts)
- **Partition Archive Specification:** [`docs/database/PARTITION_EXPORT_AND_ARCHIVE_SPECIFICATION.md`](file:///c:/Users/admin/Desktop/workfere/docs/database/PARTITION_EXPORT_AND_ARCHIVE_SPECIFICATION.md)

---

## 1. Executive Summary & Architecture

WorkSphere stores massive time-series datasets (such as IoT venue sensors, Wi-Fi performance metrics, occupancy tracking, and push notification delivery receipts) inside declarative PostgreSQL range-partitioned tables:
- `TelemetryRecord` (split by monthly intervals)
- `PushNotificationLog` (split by monthly intervals)
- `AdminAuditLog` / `AuditLog`
- `WifiTelemetry` / `AcousticTelemetry`

As partitions age past active operational windows ($30\text{--}90$ days), database administrators and compliance auditors must extract these records for offline analytics, cold-storage archival (AWS S3 / GCP Cloud Storage), or regulatory retention.

The partition export endpoint utilizes standard **Web Streams (`TransformStream`)** with **cursor-based cursor pagination (`LIMIT 1000`)** to begin streaming chunks within $<500\text{ms}$ (Time-to-First-Byte) without buffering millions of rows in Node.js server RAM.

```mermaid
flowchart LR
    Admin["Admin Client / Automated Script<br/>Authorization: Bearer <ADMIN_TOKEN>"] --> Gateway["GET /api/admin/system/partitions/export<br/>?table=TelemetryRecord&format=csv&limit=50000"]
    Gateway --> AuthCheck{"Admin Verification<br/>getAdminUser()"}
    
    AuthCheck -->|Unauthorized (401/403)| Error["403 Forbidden Response"]
    AuthCheck -->|Authorized| DateBoundaries["Compute Partition Date Bounds<br/>calculatePartitionDates(year, month)"]
    
    DateBoundaries --> Stream["Web Streams TransformStream<br/>Transfer-Encoding: chunked"]
    Stream --> CursorLoop["Cursor Query Batching<br/>SELECT ... WHERE id > cursor LIMIT 1000"]
    CursorLoop --> Serializer{"Format Selection<br/>format = csv | json"}
    
    Serializer -->|CSV| CSVFormatter["Escape CSV & Stream Rows<br/>Content-Type: text/csv"]
    Serializer -->|JSON| JSONFormatter["Stream JSON Array Chunks<br/>Content-Type: application/json"]
    
    CSVFormatter --> Download["Client Streams Download Chunk-by-Chunk"]
    JSONFormatter --> Download
```

---

## 2. Authentication, Authorization & Rate Limiting

### 2.1 Authentication & Request Headers
The export endpoint requires an active administrative session or an admin bearer token. Requests without valid administrative credentials receive `403 Forbidden`.

#### Required Headers:
```http
GET /api/admin/system/partitions/export HTTP/1.1
Host: worksphere.app
Authorization: Bearer <ADMIN_TOKEN>
Accept: text/csv, application/json
```

| Header Name | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `Authorization` | `string` | **Yes** | Bearer authentication token (`Bearer <ADMIN_TOKEN>`) belonging to an authenticated Admin account. |
| `Accept` | `string` | No | Desired MIME type (`text/csv` or `application/json`). Overridden by `format` query param. |

### 2.2 Rate Limiting
Because partition exports query high-volume analytical tables:
- **Admin Rate Limit:** Capped at **$10\text{ requests per minute}$** per admin user ID / IP.
- **Concurrent Export Lock:** Only **$2$ concurrent partition stream exports** are permitted simultaneously per organization to prevent database connection pool exhaustion.
- Exceeding limits triggers `429 Too Many Requests` with a `Retry-After: <seconds>` response header.

---

## 3. Query Parameters Reference

```
GET /api/admin/system/partitions/export?table=<table_name>&type=<type>&year=<yyyy>&month=<m>&format=<csv|json>&limit=<num>
```

| Parameter Name | Data Type | Default | Accepted Values | Description |
| :--- | :--- | :---: | :--- | :--- |
| `table` / `type` | `string` | `"telemetry"` | `telemetry`, `push`, `TelemetryRecord`, `PushNotificationLog`, `audit` | Target partitioned database table to export. |
| `format` | `string` | `"csv"` | `csv`, `json` | Output serialization format. Controls MIME type and content serialization. |
| `year` | `integer` | Current UTC Year | `2020` – `2100` | 4-digit calendar year identifying the target partition range. |
| `month` | `integer` | Current UTC Month | `0` – `11` (0-indexed) or `1` – `12` | Calendar month identifying the target partition range. |
| `limit` | `integer` | All partition records | `1` – `100000` | Optional maximum row cap. If omitted, streams the entire partition to completion. |

---

## 4. Supported Output Serialization Formats

### 4.1 CSV Format (`format=csv`)
- **MIME Type:** `text/csv; charset=utf-8`
- **Header Line:** First line outputs comma-separated column names.
- **Escaping Protocol:** Values containing commas, double quotes (`"`), or newlines (`\n`, `\r`) are wrapped in quotes with internal quotes escaped as `""`. Formula characters (`=`, `+`, `-`, `@`) at start of strings are escaped to mitigate CSV injection.
- **Content-Disposition:** `attachment; filename="<table-name>-<year>-<month>.csv"`

#### Sample Output (`TelemetryRecord`):
```csv
id,venueId,timestamp,download,upload,latency,noiseLevel,occupancy,presence,crowdLevel
rec_01HXYZ123,venue_austin_01,2026-10-01T08:00:00.000Z,142.5,48.2,18,52.4,24,true,moderate
rec_01HXYZ124,venue_austin_01,2026-10-01T08:05:00.000Z,138.1,45.9,21,54.1,26,true,moderate
```

### 4.2 JSON Format (`format=json`)
- **MIME Type:** `application/json; charset=utf-8`
- **Structure:** Array of objects streamed in chunked frames:
  ```json
  [
    {
      "id": "rec_01HXYZ123",
      "venueId": "venue_austin_01",
      "timestamp": "2026-10-01T08:00:00.000Z",
      "download": 142.5,
      "upload": 48.2,
      "latency": 18,
      "noiseLevel": 52.4,
      "occupancy": 24,
      "presence": true,
      "crowdLevel": "moderate"
    },
    {
      "id": "rec_01HXYZ124",
      "venueId": "venue_austin_01",
      "timestamp": "2026-10-01T08:05:00.000Z",
      "download": 138.1,
      "upload": 45.9,
      "latency": 21,
      "noiseLevel": 54.1,
      "occupancy": 26,
      "presence": true,
      "crowdLevel": "moderate"
    }
  ]
  ```
- **Content-Disposition:** `attachment; filename="<table-name>-<year>-<month>.json"`

---

## 5. Streaming Architecture & Cursor Batching

To avoid memory blowouts when exporting partitions containing millions of records, the endpoint:
1. Emits initial HTTP response headers and Content-Disposition attachment metadata immediately ($< 500\text{ms}$).
2. Uses standard Web Stream API (`TransformStream`) with `Transfer-Encoding: chunked`.
3. Paginates across the partition using keyset cursor pagination (`WHERE "id" > cursor ORDER BY "id" ASC LIMIT 1000`).
4. Monitors client cancellation (`request.signal.addEventListener('abort', ...)`): if the client disconnects or aborts the curl command, database queries terminate immediately.

---

## 6. Sample `curl` Commands

### 6.1 CSV Export: Telemetry Partition (October 2026)
Exports all venue telemetry records for October 2026 as a compressed, streamed CSV:

```bash
curl -X GET "https://worksphere.app/api/admin/system/partitions/export?table=telemetry&year=2026&month=9&format=csv" \
  -H "Authorization: Bearer srv_admin_sec_991823a7b" \
  -H "Accept: text/csv" \
  --output telemetry-2026-10.csv
```

### 6.2 JSON Export with Record Limit: Push Notification Logs
Exports up to $5,000$ push notification delivery events in JSON format:

```bash
curl -X GET "https://worksphere.app/api/admin/system/partitions/export?table=push&year=2026&month=9&format=json&limit=5000" \
  -H "Authorization: Bearer srv_admin_sec_991823a7b" \
  -H "Accept: application/json" \
  --output push-logs-2026-10.json
```

### 6.3 Compressed Stream Download via Gzip Pipeline
Piping the chunked export directly through gzip or into S3 cold storage:

```bash
curl -s -N -X GET "https://worksphere.app/api/admin/system/partitions/export?table=TelemetryRecord&year=2026&month=9&format=csv" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | gzip -c > "s3://worksphere-archives/telemetry/2026-10.csv.gz"
```

---

## 7. Status Codes & Error Responses

| HTTP Status | Error Code | Description | Remediating Action |
| :---: | :--- | :--- | :--- |
| `200 OK` | N/A | Successful streaming download started. | Stream chunks via Transfer-Encoding chunked. |
| `400 Bad Request` | `INVALID_PARAMETER` | Year or month out of valid boundaries ($2020 - 2100$, $0 - 11$). | Check `year` and `month` query parameter values. |
| `403 Forbidden` | `ADMIN_ACCESS_REQUIRED` | Missing or invalid `Authorization: Bearer` admin token. | Provide a verified admin JWT or API key. |
| `404 Not Found` | `PARTITION_NOT_FOUND` | No partition table exists matching target time window. | Verify table partitioning schedule in `/api/admin/system/partitions`. |
| `429 Too Many Requests`| `RATE_LIMIT_EXCEEDED` | Exceeded $10\text{ req/min}$ export limit or $2$ concurrent streams. | Wait for active exports to complete or respect `Retry-After`. |
| `500 Internal Error`| `EXPORT_STREAM_FAILED` | Database timeout or query failure during streaming. | Check database metrics and retry with a smaller `limit`. |
