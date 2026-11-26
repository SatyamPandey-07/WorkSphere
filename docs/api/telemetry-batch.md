# Telemetry Batch Ingestion API Reference (`POST /api/telemetry/batch`)

## Overview

The WorkSphere Bulk Telemetry Ingestion API (`/api/telemetry/batch`) provides a high-throughput, rate-limited endpoint for IoT gateways, venue hardware monitors, ambient decibel sensors, and automated collectors to ingest batched sensor readings into the persistent telemetry database.

This endpoint processes batches in parallel using Zod schema array parsing, enforces strict gateway authentication and IP rate limits, and persists valid records atomically in a single database transaction via `prisma.venueTelemetry.createMany`.

---

## 1. Endpoint Summary

| Property | Value |
| :--- | :--- |
| **HTTP Method** | `POST` |
| **Endpoint Route** | `/api/telemetry/batch` |
| **Content-Type** | `application/json` |
| **Authentication** | Optional / Gateway Token (Required if configured in server environment) |
| **Rate Limit** | 60 requests per minute per IP address |
| **Batch Size Limits** | Minimum 1 record, maximum 100 records per request payload |
| **Supported Epoch Bounds** | `2000-01-01T00:00:00.000Z` to `2100-01-01T00:00:00.000Z` |
| **Execution Model** | Atomic: all valid records succeed or the entire batch fails (no partial writes) |

---

## 2. Authentication & Rate Limiting

### 2.1 Gateway API Token Authentication
When gateway authentication secrets (`GATEWAY_API_TOKEN`, `TELEMETRY_GATEWAY_TOKEN`, or `WORKER_SECRET`) are configured in the server environment, callers must provide a valid token using one of the following headers:
- `Authorization: Bearer <token>`
- `x-gateway-token: <token>`
- `x-api-key: <token>`

Token comparison is executed using constant-time cryptographic verification (`timingSafeEqual`) to protect against timing attacks.

If authentication fails or a required token is missing:
- **HTTP Status:** `401 Unauthorized`
- **Response:**
  ```json
  {
    "error": "Unauthorized: Invalid or missing gateway API token"
  }
  ```

### 2.2 IP Rate Limiting
- **Quota:** 60 requests per minute per client IP.
- When exceeded, returns HTTP `429 Too Many Requests`:
  ```json
  {
    "error": "Too many requests. Please retry later."
  }
  ```

---

## 3. Request Body Structure

The request body must be a valid JSON payload containing an array of telemetry reading objects. The endpoint accepts the array either directly as the root JSON payload or wrapped under common envelope property names:
- Direct array: `[ { ... }, { ... } ]`
- Wrapped in `readings`: `{ "readings": [ { ... } ] }`
- Wrapped in `sensorReadings`: `{ "sensorReadings": [ { ... } ] }`
- Wrapped in `data`: `{ "data": [ { ... } ] }`

### 3.1 Batch Size Bounds
- **Minimum batch size:** 1 reading (`MIN_TELEMETRY_BATCH_SIZE = 1`). Empty arrays are rejected.
- **Maximum batch size:** 100 readings (`MAX_TELEMETRY_BATCH_SIZE = 100`). Batches exceeding 100 items are rejected immediately before item iteration or schema validation.

---

## 4. Telemetry Record Schema

Each record within the readings array represents an individual sensor sample or noise measurement.

### 4.1 Field Definitions

| Field | Type | Required | Description & Constraints |
| :--- | :--- | :---: | :--- |
| `venueId` | `string` | **Yes** | Non-empty unique identifier of the venue (e.g. `"venue-nyc-101"`). |
| `roomId` | `string` | No | Identifier of the specific room or zone (defaults to `"main"`). |
| `sensorId` | `string` | No | Identifier of the sensor device. If omitted, defaults to `sensor-{venueId}-{type}-{index}`. |
| `type` | `string` | No | Type of reading (e.g., `"noise"`, `"co2"`, `"temperature"`, `"occupancy"`). Defaults to `"noise"` when `decibels` is supplied, or `"sensor"` otherwise. |
| `value` | `number` | Conditional | Finite numeric measurement. Required if `decibels` is not provided. |
| `decibels` | `number` | Conditional | Finite non-negative ambient sound measurement ($\ge 0$). Required if `value` is not provided. |
| `peakDecibels` | `number` | No | Finite non-negative peak sound measurement ($\ge 0$). |
| `timestamp` | `number \| string \| Date` | No | Timestamp of the reading. Validated before any `Date` conversion. |
| `recordedAt` | `number \| string \| Date` | No | Alternate timestamp field. Precedence: `recordedAt` $\to$ `timestamp` $\to$ `new Date()` (server time). |

> [!IMPORTANT]
> **Measurement Requirement:** Each reading MUST specify either `value` or `decibels`. If neither or both are absent, the reading will fail validation with `"Either value or decibels must be specified"`.

---

## 5. Timestamp Formats, Bounds & Validation Precedence

### 5.1 Why Pre-Conversion Validation is Enforced (#10460)
JavaScript's `new Date(value)` is forgiving and unsafe with arbitrary inputs:
1. `new Date(NaN)`, `new Date(Infinity)`, or `new Date("invalid")` produce `Invalid Date` instances where `.getTime()` returns `NaN`, which corrupts database storage, index generation, and queries.
2. Extreme numeric values (e.g., values exceeding year 2100 or negative values) cause database driver overflow exceptions during batch execution.
3. Pre-validating types, finiteness, and epoch bounds **prior to invoking Date conversion** prevents runtime crashes and ensures strict validation error reporting.

### 5.2 Supported Timestamp Bounds
Every supplied `timestamp` or `recordedAt` must fall strictly within the supported 100-year epoch window:
- **Minimum Allowed Epoch:** `946684800000` (`2000-01-01T00:00:00.000Z`)
- **Maximum Allowed Epoch:** `4102444800000` (`2100-01-01T00:00:00.000Z`)

### 5.3 Accepted Formats
1. **ISO 8601 Date Strings:**
   - Full UTC timestamps: `"2026-11-26T09:30:00.000Z"`
   - With timezone offsets: `"2026-11-26T15:00:00+05:30"`
   - Date-only strings: `"2026-11-26"`
2. **Numeric Unix Epochs:**
   - **Milliseconds Epoch:** 13-digit numbers between `946684800000` and `4102444800000` (e.g. `1795687200000`).
   - **Seconds Epoch:** Numbers $< 10^{11}$ are automatically converted to milliseconds (e.g. `1795687200` $\to$ `1795687200000`).
3. **Date Instances:**
   - Pre-parsed `Date` objects with valid, finite `.getTime()` within the bounds.

### 5.4 Rejected Timestamp Values
- Non-finite numbers: `NaN`, `Infinity`, `-Infinity`
- Malformed strings: `"invalid-date"`, `""`, whitespace-only strings, `"NaN"`
- Out-of-bounds timestamps: dates prior to year 2000 (e.g. `1000` = Jan 1970) or beyond year 2100 (e.g. `5000000000000` = year 2128)
- Unsupported types: booleans (`true`/`false`), objects, arrays, symbols, or functions

---

## 6. Atomic Processing & Database Writes

The telemetry batch ingestion pipeline is **fully atomic**:
1. All records in the batch are evaluated in parallel using Zod schemas and timestamp boundary checkers.
2. If **any** record fails validation, the request is aborted immediately with HTTP `400 Bad Request`.
3. **Zero partial writes occur:** `prisma.venueTelemetry.createMany` is only executed when 100% of the readings in the batch pass validation.
4. Duplicate records are skipped safely using `skipDuplicates: true`.

---

## 7. Concrete Request Examples

### 7.1 Example 1: Direct Array with ISO 8601 `timestamp`
```http
POST /api/telemetry/batch HTTP/1.1
Host: api.worksphere.com
Content-Type: application/json
Authorization: Bearer <GATEWAY_TOKEN>

[
  {
    "venueId": "venue-sf-downtown",
    "roomId": "pod-alpha",
    "sensorId": "sensor-noise-01",
    "type": "noise",
    "decibels": 48.5,
    "peakDecibels": 62.1,
    "timestamp": "2026-11-26T09:15:00.000Z"
  },
  {
    "venueId": "venue-sf-downtown",
    "roomId": "pod-beta",
    "sensorId": "sensor-air-02",
    "type": "co2",
    "value": 412,
    "timestamp": "2026-11-26T09:15:00.000Z"
  }
]
```

### 7.2 Example 2: Wrapped Payload with Numeric Epoch `recordedAt`
```http
POST /api/telemetry/batch HTTP/1.1
Host: api.worksphere.com
Content-Type: application/json
x-gateway-token: <GATEWAY_TOKEN>

{
  "readings": [
    {
      "venueId": "venue-london-hub",
      "roomId": "quiet-library",
      "type": "noise",
      "value": 38.2,
      "recordedAt": 1795687200000
    },
    {
      "venueId": "venue-london-hub",
      "roomId": "cafe-lounge",
      "type": "temperature",
      "value": 21.8,
      "recordedAt": 1795687200
    }
  ]
}
```

---

## 8. Response Specifications & Schemas

### 8.1 Success Response (`201 Created`)

Returned when all records pass schema validation and are persisted into the database.

#### Response JSON Schema
```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean", "const": true },
    "count": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "required": ["success", "count"],
  "additionalProperties": false
}
```

#### Success Example
```json
{
  "success": true,
  "count": 2
}
```

---

### 8.2 Validation Error Responses (`400 Bad Request`)

#### 8.2.1 Non-Array or Missing Payload
When the payload is not an array or does not contain a recognized readings envelope:
```json
{
  "error": "Validation failed",
  "details": "readings must be an array"
}
```

#### 8.2.2 Empty Batch
When an empty array `[]` is provided:
```json
{
  "error": "Validation failed",
  "details": "readings array cannot be empty"
}
```

#### 8.2.3 Oversized Batch (> 100 items)
When the array contains 101 or more readings:
```json
{
  "error": "Validation failed",
  "details": "readings array cannot exceed 100 items"
}
```

#### 8.2.4 Invalid JSON Payload
When the request body cannot be parsed as valid JSON:
```json
{
  "error": "Invalid JSON payload"
}
```

#### 8.2.5 Item-Level Validation Errors (Atomic Failure)
When one or more records fail validation (e.g., out-of-range timestamp, missing fields, or invalid types), an indexed list of errors is returned:

```json
{
  "error": "Validation failed",
  "details": [
    {
      "index": 1,
      "errors": {
        "formErrors": [],
        "fieldErrors": {
          "timestamp": [
            "timestamp must be a valid, finite date within supported range (2000-2100)"
          ]
        }
      }
    }
  ]
}
```
