# Partition Management API Reference

This document describes WorkSphere's partition maintenance, bulk archive, bulk delete, and audit-log endpoints.

The reference is based on the current route and service implementations:

| Component                       | Source                                                 |
| ------------------------------- | ------------------------------------------------------ |
| Scheduled partition maintenance | `src/app/api/admin/system/partitions/route.ts`         |
| Bulk partition archive          | `src/app/api/admin/system/partitions/archive/route.ts` |
| Bulk partition deletion         | `src/app/api/admin/system/partitions/delete/route.ts`  |
| Partition audit retrieval       | `src/app/api/admin/system/partitions/audit/route.ts`   |
| Partition operation service     | `src/lib/adminPartitionService.ts`                     |
| Date and audit filter utilities | `src/app/api/admin/system/partitions/dateHelper.ts`    |

For partition data export, see the existing [Partition Export API Reference](./partition-export.md). This document does not duplicate its export parameters or serialization formats.

## 1. Endpoint Overview

| Method | Endpoint                               | Authorization               | Purpose                                                                            |
| ------ | -------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `POST` | `/api/admin/system/partitions`         | `CRON_SECRET` bearer token  | Provision weekly telemetry partitions and perform age-based partition maintenance. |
| `POST` | `/api/admin/system/partitions/archive` | Authenticated administrator | Detach eligible partitions and move them into archive schemas.                     |
| `POST` | `/api/admin/system/partitions/delete`  | Authenticated administrator | Permanently drop eligible partitions.                                              |
| `GET`  | `/api/admin/system/partitions/audit`   | Authenticated administrator | Retrieve partition administration audit records.                                   |

**Important authorization distinction**

The scheduled maintenance endpoint uses an exact `Authorization: Bearer <CRON_SECRET>` comparison.

The archive, delete, and audit endpoints use `getAdminUser()` to resolve an authenticated administrator. They do not use the maintenance endpoint's `CRON_SECRET` check.

These authorization mechanisms are separate and should not be treated as interchangeable.

## 2. Scheduled Partition Maintenance

### `POST /api/admin/system/partitions`

**Purpose:** Create upcoming weekly telemetry partitions and remove sufficiently old telemetry partitions according to the route's retention logic.

**Authorization**

The request must contain:

```http
Authorization: Bearer <CRON_SECRET>
```

The route compares the complete authorization header with:

```text
Bearer <value of process.env.CRON_SECRET>
```

A missing or mismatched header returns `401 Unauthorized`.

This endpoint does not use `getAdminUser()`.

### Request

No JSON request body is required by the current implementation.

Example using an environment variable:

```bash
curl -X POST "https://worksphere.app/api/admin/system/partitions" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Accept: application/json"
```

Do not place an actual cron secret in source code, documentation, shell history, or committed scripts.

### Operations performed

The endpoint performs two main operations.

#### 1. Weekly partition provisioning

It executes:

```sql
SELECT create_weekly_telemetry_partition(
  NOW() + (i || ' weeks')::interval
)
FROM generate_series(0, 4) AS i;
```

The function is called for offsets zero through four, covering five weekly partition targets including the current-week offset.

#### 2. Retention-related maintenance

The route searches PostgreSQL catalogs for partitions satisfying these conditions:

- The parent table is `TelemetryReading`.
- The child partition name matches `telemetry_reading_yYYYY_wWW`.
- The partition has no PostgreSQL relation description.
- Its calculated week-end boundary is more than 90 days old.

For each qualifying partition, the route executes:

```sql
ALTER TABLE "TelemetryReading"
DETACH PARTITION "<partition_name>" CONCURRENTLY;
```

It then executes:

```sql
DROP TABLE IF EXISTS "<partition_name>";
```

**Destructive behavior**

Despite the response property name `archivedPartitions` and the route's internal comments referring to cold storage, this implementation does not export the partition to a backup file, object store, or separate archive schema.

It detaches and drops the expired partition table. The data is removed from the database by this operation.

Do not treat this endpoint as a backup or recoverable cold-storage archival mechanism.

### Successful response

HTTP status: `200 OK`

Representative response:

```json
{
  "success": true,
  "archivedPartitions": [
    "telemetry_reading_y2025_w01",
    "telemetry_reading_y2025_w02"
  ],
  "message": "Weekly telemetry partitions created & retention policies executed."
}
```

The `archivedPartitions` array contains the names of partitions detached and dropped by this maintenance execution. It does not indicate that backup copies were created.

### Error responses

| Status                      | Response                      | Meaning                                     |
| --------------------------- | ----------------------------- | ------------------------------------------- |
| `401 Unauthorized`          | `{"error":"Unauthorized"}`    | Missing or incorrect cron bearer token.     |
| `500 Internal Server Error` | `{"error":"<error message>"}` | A database or maintenance operation failed. |

The route logs maintenance errors to the server console.

## 3. Bulk Partition Archive

### `POST /api/admin/system/partitions/archive`

**Purpose:** Detach eligible partitions from their public parent tables and move them into PostgreSQL archive schemas.

**Authorization**

The route calls:

```ts
const admin = await getAdminUser();
```

If no administrator is resolved, it returns:

```http
403 Forbidden
```

Response:

```json
{
  "error": "Admin access required"
}
```

This endpoint uses authenticated administrator access, not the `CRON_SECRET` authorization mechanism.

### Request body

The request requires a non-empty `partitions` array.

| Property     | Type       | Required | Default | Description                                                    |
| ------------ | ---------- | -------- | ------- | -------------------------------------------------------------- |
| `partitions` | `string[]` | Yes      | None    | Names of partitions to archive. Must be a non-empty array.     |
| `atomic`     | `boolean`  | No       | `false` | When enabled, processes the batch in one database transaction. |

Example:

```http
POST /api/admin/system/partitions/archive
Content-Type: application/json
```

```json
{
  "partitions": ["TelemetryRecord_y2025m01", "WifiTelemetry_y2025m01"],
  "atomic": false
}
```

The example names illustrate the expected naming pattern. Actual partition names must identify eligible relations in the database.

If `partitions` is missing, is not an array, or is empty, the route returns:

```http
400 Bad Request
```

```json
{
  "error": "Partitions array is required and must not be empty"
}
```

### Supported partition validation

The service recognizes these supported parent tables:

- `WifiTelemetry`
- `TelemetryRecord`
- `PushNotificationLog`
- `AdminAuditLog`
- `AcousticTelemetry`

Partition names must satisfy the service's safe-name validation:

- Between 3 and 64 characters.
- Only alphanumeric characters and underscores.
- Must have a recognized parent-table prefix followed by a suffix.
- Must resolve to an actual supported attached partition or an already archived relation in an accepted archive schema.

Bare parent table names are not valid partition names.

The service also checks PostgreSQL catalogs before executing destructive or structural operations. A matching name alone is not sufficient.

### Archive behavior

For an attached partition, the service:

1. Validates its name.
2. Confirms that it is attached to a supported parent table in the `public` schema.
3. Creates the destination schema if necessary.
4. Calculates the partition's size.
5. Detaches the partition from its parent.
6. Moves the detached table into the destination schema.

The destination schema is selected as follows:

| Parent table                  | Destination schema          |
| ----------------------------- | --------------------------- |
| `PushNotificationLog`         | `push_notification_archive` |
| Other supported parent tables | `telemetry_archive`         |

The service also recognizes detached relations already located in:

- `telemetry_archive`
- `push_notification_archive`
- `partition_archive`

An already archived partition is treated as successfully processed without being moved again.

**Archive does not mean external backup.** This operation changes the partition's database attachment and schema. It does not create a compressed backup, upload data to object storage, or remove the table from PostgreSQL.

### Atomic and non-atomic behavior

The `atomic` property controls the transaction boundary.

**Non-atomic mode (`atomic: false`, default)**

- Each partition is processed in its own transaction.
- A failure for one partition does not prevent later partitions from being attempted.
- Successful operations remain committed.
- Failed partitions are included in the `failed` array.
- The response can contain both successful and failed partitions.

**Atomic mode (`atomic: true`)**

- All requested partition operations run in one transaction.
- If any operation fails, the transaction is rolled back.
- No partial batch success is reported.
- The response contains an unsuccessful result with the requested partitions represented as failed.

### Successful or partially successful response

The service returns a `BulkPartitionOperationResult`:

```json
{
  "success": true,
  "action": "ARCHIVE",
  "processed": ["TelemetryRecord_y2025m01"],
  "failed": [],
  "tableSummaries": [
    {
      "name": "TelemetryRecord_y2025m01",
      "parentTable": "TelemetryRecord",
      "status": "PROCESSED",
      "action": "ARCHIVE",
      "freedBytes": 1048576
    }
  ],
  "freedBytes": 1048576,
  "freedSizePretty": "1 MB",
  "timestamp": "2026-11-21T08:00:00.000Z"
}
```

The values above are illustrative.

Response properties:

| Property          | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `success`         | `true` when there are no failed partition operations.                 |
| `action`          | Always `ARCHIVE` for this endpoint.                                   |
| `processed`       | Partition names successfully processed.                               |
| `failed`          | Partition names and associated error messages for failed operations.  |
| `tableSummaries`  | Per-partition status, action, and optional error or size information. |
| `freedBytes`      | Sum of the reported partition sizes processed by the operation.       |
| `freedSizePretty` | Human-readable size representation.                                   |
| `timestamp`       | Operation result timestamp.                                           |

A per-partition summary can use the `PROCESSED` or `FAILED` status. The shared result type also declares `SKIPPED`.

A per-partition failure does not necessarily produce an HTTP error status. The route returns the service result with HTTP `200 OK`, including when `success` is false.

### Failure handling

| Status                      | Response                            | Meaning                                                                 |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `400 Bad Request`           | Partitions array validation error   | The request body does not contain a valid non-empty array.              |
| `403 Forbidden`             | `{"error":"Admin access required"}` | An authenticated administrator could not be resolved.                   |
| `200 OK`                    | Result with `success: false`        | One or more partition operations failed or an atomic batch rolled back. |
| `500 Internal Server Error` | Error response                      | An unexpected route-level error occurred.                               |

Successful operations are audited using the action:

```text
BULK_PARTITION_ARCHIVE
```

The audit record includes the processed names, counts, size information, failures, and table summaries.

Audit insertion is best-effort. If writing the audit entry fails, the service logs a warning; the completed partition operation is not rolled back.

## 4. Bulk Partition Delete

### `POST /api/admin/system/partitions/delete`

**Purpose:** Permanently remove eligible attached or previously archived partition tables.

**Authorization**

This endpoint uses `getAdminUser()`.

A request without a resolved administrator returns:

```http
403 Forbidden
```

```json
{
  "error": "Admin access required"
}
```

It does not use the maintenance endpoint's `CRON_SECRET` check.

### Request body

The request contract is the same as the bulk archive endpoint.

| Property     | Type       | Required | Default | Description                                        |
| ------------ | ---------- | -------- | ------- | -------------------------------------------------- |
| `partitions` | `string[]` | Yes      | None    | Non-empty array of partition names.                |
| `atomic`     | `boolean`  | No       | `false` | Determines whether the batch uses one transaction. |

Example:

```http
POST /api/admin/system/partitions/delete
Content-Type: application/json
```

```json
{
  "partitions": ["TelemetryRecord_y2025m01"],
  "atomic": true
}
```

The same safe-name checks and supported-parent validation used by the archive service apply here.

The service accepts eligible attached partitions in `public` and detached partition tables in its recognized archive schemas.

### Delete behavior

For an attached partition, the service:

1. Validates the partition name.
2. Confirms its actual relationship to a supported parent table.
3. Calculates the partition size.
4. Detaches it from its parent.
5. Executes `DROP TABLE ... CASCADE`.

For a previously archived partition, it drops the table from its archive schema using `DROP TABLE ... CASCADE`.

This is a destructive database operation.

**Deletion is not archival or backup.** The service removes the partition table and its data. Do not use this endpoint as a substitute for creating or verifying a backup.

### Atomic and non-atomic behavior

The transaction behavior matches the bulk archive endpoint.

**Non-atomic mode (default):**

- Each partition is processed in its own transaction.
- Failed items do not stop subsequent items from being attempted.
- Successful deletions remain committed.
- The response reports individual successes and failures.

**Atomic mode:**

- All requested deletions run in one transaction.
- Any failure rolls back the complete batch.
- The result reports an unsuccessful operation with no committed processed items.

### Successful or partially successful response

The response follows the shared `BulkPartitionOperationResult` structure.

Representative response:

```json
{
  "success": true,
  "action": "DELETE",
  "processed": ["TelemetryRecord_y2025m01"],
  "failed": [],
  "tableSummaries": [
    {
      "name": "TelemetryRecord_y2025m01",
      "parentTable": "TelemetryRecord",
      "status": "PROCESSED",
      "action": "DELETE",
      "freedBytes": 1048576
    }
  ],
  "freedBytes": 1048576,
  "freedSizePretty": "1 MB",
  "timestamp": "2026-11-21T08:00:00.000Z"
}
```

The example values are illustrative.

Successful deletions are audited using:

```text
BULK_PARTITION_DELETE
```

The audit entry records processed partition names, size information, failures, and operation summaries.

As with archive operations, audit insertion is best-effort and does not undo an already completed deletion.

### Failure responses

| Status                      | Response                            | Meaning                                               |
| --------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `400 Bad Request`           | Partitions array validation error   | The request body is missing a valid non-empty array.  |
| `403 Forbidden`             | `{"error":"Admin access required"}` | An authenticated administrator could not be resolved. |
| `200 OK`                    | Result with `success: false`        | Partition-level failures or an atomic batch rollback. |
| `500 Internal Server Error` | Error response                      | An unexpected route-level error occurred.             |

## 5. Partition Audit Retrieval

### `GET /api/admin/system/partitions/audit`

**Purpose:** Retrieve records from the partitioned `AdminAuditLog` table.

**Authorization**

The route uses `getAdminUser()` to require an authenticated administrator.

An unauthenticated or non-admin request returns:

```http
403 Forbidden
```

```json
{
  "error": "Admin access required"
}
```

This endpoint does not use `CRON_SECRET`.

### Query parameters

| Parameter    | Type      | Required | Default | Description                                             |
| ------------ | --------- | -------- | ------- | ------------------------------------------------------- |
| `actorId`    | `string`  | No       | None    | Filter by administrator ID.                             |
| `adminId`    | `string`  | No       | None    | Alias for `actorId`.                                    |
| `startDate`  | `string`  | No       | None    | Inclusive lower bound for `createdAt`.                  |
| `endDate`    | `string`  | No       | None    | Inclusive upper bound for `createdAt`.                  |
| `actionType` | `string`  | No       | None    | Filter by audit action.                                 |
| `action`     | `string`  | No       | None    | Alias for `actionType`.                                 |
| `limit`      | `integer` | No       | `50`    | Maximum number of records returned; clamped to 1–1000.  |
| `offset`     | `integer` | No       | `0`     | Pagination offset; negative values are clamped to zero. |

When both aliases are supplied, the route uses:

- `actorId` before `adminId`.
- `actionType` before `action`.

Empty filter values are treated as absent.

### Date validation

The endpoint validates `startDate` and `endDate` using the shared ISO 8601 timestamp validation helper.

Supported input forms include:

```text
2026-11-01
2026-11-01T10:30:00Z
2026-11-01T10:30:00.123Z
2026-11-01T10:30:00+05:30
```

The helper checks the date format, calendar validity, and supplied time components.

The filters are inclusive:

```sql
"createdAt" >= <startDate>
"createdAt" <= <endDate>
```

An invalid `startDate` or `endDate` returns:

```http
400 Bad Request
```

Example:

```json
{
  "error": "Invalid startDate format: \"2026-13-40\". Expected ISO 8601 timestamp."
}
```

Date filters are independently validated. The route does not add a separate check that `startDate` must be earlier than `endDate`.

### Example request

```http
GET /api/admin/system/partitions/audit?actorId=admin_123&startDate=2026-11-01T00%3A00%3A00Z&endDate=2026-11-21T23%3A59%3A59Z&actionType=BULK_PARTITION_ARCHIVE&limit=25&offset=0
Accept: application/json
```

The request must be made with an authenticated administrator session.

### Pagination behavior

The endpoint calculates its pagination values as follows:

- Default `limit`: `50`.
- Minimum `limit`: `1`.
- Maximum `limit`: `1000`.
- Default `offset`: `0`.
- Negative `offset`: clamped to `0`.

For example:

```text
?limit=25&offset=25
```

requests the next page using an offset of 25.

Use integer values for both parameters.

### Successful response

HTTP status: `200 OK`

Representative response:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "audit_01",
      "adminId": "admin_123",
      "action": "BULK_PARTITION_ARCHIVE",
      "entityType": "DatabasePartition",
      "entityId": "TelemetryRecord_y2025m01",
      "details": "{\"count\":1,\"freedBytes\":1048576}",
      "createdAt": "2026-11-21T08:00:00.000Z"
    }
  ],
  "filters": {
    "actorId": "admin_123",
    "startDate": "2026-11-01T00:00:00.000Z",
    "endDate": "2026-11-21T23:59:59.000Z",
    "actionType": "BULK_PARTITION_ARCHIVE",
    "limit": 25,
    "offset": 0
  }
}
```

The values are illustrative.

Response properties:

| Property  | Description                                         |
| --------- | --------------------------------------------------- |
| `success` | Indicates that the audit query completed.           |
| `count`   | Number of records returned in the current response. |
| `data`    | Array of audit log records.                         |
| `filters` | Normalized filters and effective pagination values. |

Each returned audit record contains:

- `id`
- `adminId`
- `action`
- `entityType`
- `entityId`
- `details`
- `createdAt`

Records are ordered by:

```sql
ORDER BY "createdAt" DESC, "id" ASC
```

The `count` property represents the number of returned rows, not the total number of records matching the filters across all pages.

### Error responses

| Status                      | Response                                             | Meaning                                               |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `400 Bad Request`           | Invalid date format error                            | `startDate` or `endDate` failed validation.           |
| `403 Forbidden`             | `{"error":"Admin access required"}`                  | An authenticated administrator could not be resolved. |
| `500 Internal Server Error` | `{"error":"Failed to query partitioned audit logs"}` | The audit query failed.                               |

## 6. Partition Operation Safety

Partition administration operations can alter or permanently remove database objects. Use the endpoints according to their actual effects.

| Operation             | Effect on partition                                       | Recoverability implication                                                        |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Scheduled maintenance | Detaches and drops expired `TelemetryReading` partitions. | The endpoint itself does not preserve a backup.                                   |
| Bulk archive          | Detaches and moves a partition into an archive schema.    | The table remains in PostgreSQL but is no longer attached to its original parent. |
| Bulk delete           | Drops an attached or archived partition using `CASCADE`.  | The table and its data are removed by the operation.                              |
| Audit retrieval       | Reads administrative audit records.                       | Does not modify partitions.                                                       |

Before invoking archive or delete operations:

1. Verify the exact partition names.
2. Confirm their parent table and current schema.
3. Determine whether the operation should be atomic.
4. Ensure required backups exist through the established backup process.
5. Review operation results and audit records afterward.

An atomic batch provides transaction-level rollback for that request. It is not a substitute for a backup and does not protect against unrelated database failures or later destructive operations.

## 7. Relationship to Partition Export

Partition management and partition export are separate API capabilities.

For exporting partition data, output formats, export query parameters, authentication, and streaming behavior, refer to:

[Partition Export API Reference](./partition-export.md)

The bulk archive endpoint moves detached PostgreSQL tables into archive schemas. The export endpoint handles data serialization and download. Neither operation should be described as automatically creating a complete external backup unless a separate backup process explicitly performs that task.

## 8. Implementation References

- [Scheduled partition maintenance route](../../src/app/api/admin/system/partitions/route.ts)
- [Bulk archive route](../../src/app/api/admin/system/partitions/archive/route.ts)
- [Bulk delete route](../../src/app/api/admin/system/partitions/delete/route.ts)
- [Partition audit route](../../src/app/api/admin/system/partitions/audit/route.ts)
- [Partition administration service](../../src/lib/adminPartitionService.ts)
- [Partition date and audit filter helpers](../../src/app/api/admin/system/partitions/dateHelper.ts)
- [Partition export API reference](./partition-export.md)
