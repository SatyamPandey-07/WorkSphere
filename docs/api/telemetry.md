# Venue Telemetry & Ambient Metrics API Reference

## Overview

The WorkSphere Venue Telemetry API (`/api/venues/[venueId]/telemetry`) provides real-time and historical telemetry data for workspace venues. Telemetry data includes ambient noise levels (dB), seat occupancy rates (%), Wi-Fi network performance (download/upload throughput and latency), and crowd density scores.

Telemetry data is processed using **Differential Privacy Filters** when active visitor samples are below safety thresholds ($N < 10$) to prevent user identity re-identification in low-density venues.

---

## 1. Endpoint Summary

| Method | Endpoint Route | Authentication | Rate Limit | Primary Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **`GET`** | `/api/venues/[venueId]/telemetry` | Optional / Public | 120 req / min | Fetch aggregated hourly occupancy, noise, and network telemetry data. |
| **`POST`** | `/api/venues/[venueId]/telemetry` | Required (Bearer Token / Session) | 30 req / min | Submit crowdsourced Wi-Fi speed and crowd density telemetry reports. |

---

## 2. GET `/api/venues/[venueId]/telemetry`

Retrieves time-series occupancy and telemetry statistics for a specific venue by its unique identifier (`venueId`).

### 2.1 Request Path Parameters

| Parameter | Type | Required | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `venueId` | `string` | **Yes** | Unique CUID or slug identifier of the venue (supports `mock-*` testing IDs). | `v-88291a` |

### 2.2 Request Query Parameters

| Parameter | Type | Default | Valid Options | Description |
| :--- | :--- | :---: | :--- | :--- |
| `timeframe` | `string` | `today` | `today`, `24h`, `7d`, `30d` | Time window filter for telemetry aggregation. |
| `window` | `string` | `hourly` | `hourly`, `15m`, `daily` | Data point aggregation granularity. |
| `metrics` | `string` | `occupancy` | `occupancy`, `wifi`, `noise`, `all` | Comma-separated list of telemetry metric types to return. |
| `privacyFilter` | `boolean` | `true` | `true`, `false` | Enable Laplace differential privacy filter for low-sample hours ($N < 10$). |

#### Query Example URL

```http
GET /api/venues/v-88291a/telemetry?timeframe=today&metrics=occupancy,wifi&privacyFilter=true HTTP/1.1
Host: api.worksphere.com
Authorization: Bearer <user_token>
Accept: application/json
```

---

### 2.3 Response Specification (200 OK)

A successful `GET` request returns an HTTP `200 OK` status with a JSON object containing an array of hourly telemetry records:

```json
{
  "venueId": "v-88291a",
  "timeframe": "today",
  "sampleCount": 84,
  "privacyApplied": true,
  "occupancy": [
    {
      "time": "8 AM",
      "occupancy": 30,
      "crowdCategory": "low",
      "noiseLevelDb": 42.5,
      "sampleSize": 4
    },
    {
      "time": "9 AM",
      "occupancy": 45,
      "crowdCategory": "moderate",
      "noiseLevelDb": 48.0,
      "sampleSize": 8
    },
    {
      "time": "10 AM",
      "occupancy": 60,
      "crowdCategory": "moderate",
      "noiseLevelDb": 52.1,
      "sampleSize": 12
    },
    {
      "time": "11 AM",
      "occupancy": 75,
      "crowdCategory": "busy",
      "noiseLevelDb": 58.4,
      "sampleSize": 18
    },
    {
      "time": "12 PM",
      "occupancy": 85,
      "crowdCategory": "very busy",
      "noiseLevelDb": 63.2,
      "sampleSize": 22
    },
    {
      "time": "1 PM",
      "occupancy": 80,
      "crowdCategory": "busy",
      "noiseLevelDb": 61.0,
      "sampleSize": 19
    },
    {
      "time": "2 PM",
      "occupancy": 70,
      "crowdCategory": "moderate",
      "noiseLevelDb": 55.8,
      "sampleSize": 15
    },
    {
      "time": "3 PM",
      "occupancy": 65,
      "crowdCategory": "moderate",
      "noiseLevelDb": 54.0,
      "sampleSize": 14
    },
    {
      "time": "4 PM",
      "occupancy": 70,
      "crowdCategory": "moderate",
      "noiseLevelDb": 56.2,
      "sampleSize": 16
    },
    {
      "time": "5 PM",
      "occupancy": 85,
      "crowdCategory": "very busy",
      "noiseLevelDb": 64.1,
      "sampleSize": 21
    },
    {
      "time": "6 PM",
      "occupancy": 40,
      "crowdCategory": "low",
      "noiseLevelDb": 46.3,
      "sampleSize": 7
    },
    {
      "time": "7 PM",
      "occupancy": 25,
      "crowdCategory": "quiet",
      "noiseLevelDb": 39.8,
      "sampleSize": 3
    },
    {
      "time": "8 PM",
      "occupancy": 15,
      "crowdCategory": "empty",
      "noiseLevelDb": 35.0,
      "sampleSize": 1
    }
  ],
  "wifiSummary": {
    "avgDownloadMbps": 142.5,
    "avgUploadMbps": 48.2,
    "avgLatencyMs": 18.4,
    "rating": "EXCELLENT"
  }
}
```

---

## 3. POST `/api/venues/[venueId]/telemetry`

Submits a new crowdsourced telemetry measurement report (Wi-Fi performance and crowd density observation) for a venue. Requires active user authentication.

### 3.1 Request Headers

```http
POST /api/venues/v-88291a/telemetry HTTP/1.1
Host: api.worksphere.com
Authorization: Bearer <session_token>
Content-Type: application/json
User-Agent: WorkSphere-Mobile/2.4.0 (iOS 17.5)
```

### 3.2 Request JSON Body Schema

| Field Name | Type | Required | Validation Constraints | Description |
| :--- | :--- | :---: | :--- | :--- |
| `download` | `number \| string` | **Yes** | Numeric value $> 0.0$ | Wi-Fi download throughput in Mbps. |
| `upload` | `number \| string` | **Yes** | Numeric value $> 0.0$ | Wi-Fi upload throughput in Mbps. |
| `latency` | `number \| string` | **Yes** | Numeric value $\ge 0.0$ | Wi-Fi round-trip latency in milliseconds (ping). |
| `crowdLevel` | `string` | **Yes** | One of: `empty`, `low`, `quiet`, `moderate`, `busy`, `very busy`, `packed` | Perceived crowd density score label. |

#### Request Body Example

```json
{
  "download": 128.45,
  "upload": 35.10,
  "latency": 14.2,
  "crowdLevel": "moderate"
}
```

### 3.3 Response Specification (202 Accepted)

The telemetry report is enqueued into the async background queue (`src/lib/telemetryQueue.ts`) for validation and aggregation:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json; charset=utf-8
X-Queue-Job-Id: telemetry_job_1728200500_ab912

{
  "queued": true
}
```

---

## 4. Crowd Density Scoring & Mapping Scale

Crowd level labels submitted via `POST` are normalized into numeric percentage occupancy scores ($0 - 100\%$) according to the following mapping:

| Crowd Level Label | Numeric Occupancy Score | Description | Typical Environment |
| :--- | :---: | :--- | :--- |
| **`empty`** | `10%` | Nearly no visitors present | $< 10\%$ seat capacity occupied |
| **`low` / `quiet`** | `25%` | Ample open seating available | $10 - 35\%$ seat capacity occupied |
| **`moderate`** | `50%` | Half capacity filled | $35 - 65\%$ seat capacity occupied |
| **`busy`** | `75%` | High occupancy, few seats left | $65 - 85\%$ seat capacity occupied |
| **`very busy`** | `90%` | Standing room or single seats | $85 - 95\%$ seat capacity occupied |
| **`packed`** | `100%` | Fully booked / at capacity | $100\%$ capacity reached |

---

## 5. Differential Privacy & Noise Filtering

To protect user privacy in venues with few active reporters ($N < 10$ active sample submissions in a given hourly window), the API automatically invokes `applyPrivacyFilter()` from [src/lib/privacy/differentialPrivacy.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/privacy/differentialPrivacy.ts).

### 5.1 Privacy Filter Formula

When active sample count $N < \text{threshold}$ (default: $10$ visitors), zero-mean Laplace noise is added to the occupancy calculation:

$$\text{Occupancy}_{\text{private}} = \text{clamp}\left(0,\, 100,\, \text{round}\left(\text{Occupancy}_{\text{raw}} + \text{Laplace}\left(0, \frac{\Delta S}{\epsilon}\right)\right)\right)$$

Where:
- $\Delta S = 100$ (sensitivity scale ceiling).
- $\epsilon = 1.0$ (privacy budget parameter).
- $\text{clamp}(min, max, val)$ ensures reported values remain within $[0, 100\%]$.

---

## 6. Comprehensive Error States & Status Codes

All API errors return standardized JSON responses using the `apiError()` helper function:

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE_IDENTIFIER"
}
```

### Error Code Summary Matrix

| Status Code | Status Name | Error Code (`code`) | Cause / Trigger | Resolution Action |
| :--- | :--- | :--- | :--- | :--- |
| **`400`** | Bad Request | `VALIDATION_FAILED` | Missing required POST payload fields (`download`, `upload`, `latency`, `crowdLevel`). | Verify request body contains all 4 telemetry fields. |
| **`401`** | Unauthorized | `UNAUTHORIZED` | Missing or invalid Clerk authentication session token on `POST`. | Include valid `Authorization: Bearer <token>` header. |
| **`404`** | Not Found | `VENUE_NOT_FOUND` | `venueId` parameter does not match any database venue or valid mock ID. | Verify `venueId` spelling or query active venue list first. |
| **`429`** | Too Many Requests | `RATE_LIMIT_EXCEEDED` | Request frequency exceeded limit (120/min GET, 30/min POST). | Pause requests until reset window specified in `X-RateLimit-Reset`. |
| **`500`** | Internal Error | `INTERNAL_ERROR` | Database connection failure or unhandled internal exception. | Check backend application logs; retry with exponential backoff. |

---

### Error Response Examples

#### 1. HTTP 400 Bad Request (`VALIDATION_FAILED`)

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Missing required telemetry fields",
  "code": "VALIDATION_FAILED"
}
```

#### 2. HTTP 401 Unauthorized (`UNAUTHORIZED`)

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

#### 3. HTTP 404 Venue Not Found (`VENUE_NOT_FOUND`)

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": "Venue not found",
  "code": "VENUE_NOT_FOUND"
}
```

#### 4. HTTP 429 Rate Limit Exceeded (`RATE_LIMIT_EXCEEDED`)

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 45
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1728200600

{
  "error": "Rate limit exceeded. Please try again in 45 seconds.",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

#### 5. HTTP 500 Internal Server Error (`INTERNAL_ERROR`)

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": "Failed to fetch telemetry data",
  "code": "INTERNAL_ERROR"
}
```

---

## 7. Rate Limiting Headers Specification

The telemetry endpoint enforces IP-based and user-based rate limits backed by Redis token bucket rate limiters:

```http
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 119
X-RateLimit-Reset: 1728200600
```

- **`X-RateLimit-Limit`**: Maximum allowed requests in a 60-second window.
- **`X-RateLimit-Remaining`**: Remaining request quota in the current window.
- **`X-RateLimit-Reset`**: Unix epoch timestamp when the current rate limit window resets.

---

## 8. Client Integration Code Examples

### 8.1 TypeScript / Fetch API Integration

```typescript
export interface OccupancyRecord {
  time: string;
  occupancy: number;
}

export interface TelemetryResponse {
  occupancy: OccupancyRecord[];
}

export async function fetchVenueTelemetry(venueId: string): Promise<OccupancyRecord[]> {
  const response = await fetch(`/api/venues/${encodeURIComponent(venueId)}/telemetry`, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: Failed to fetch telemetry`);
  }

  const data: TelemetryResponse = await response.json();
  return data.occupancy;
}

export async function submitWifiTelemetry(
  venueId: string,
  telemetry: { download: number; upload: number; latency: number; crowdLevel: string },
  authToken: string
): Promise<boolean> {
  const response = await fetch(`/api/venues/${encodeURIComponent(venueId)}/telemetry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify(telemetry),
  });

  if (response.status === 202) {
    return true;
  }

  const errorData = await response.json().catch(() => ({}));
  throw new Error(errorData.error || `HTTP ${response.status}: Submission failed`);
}
```

---

### 8.2 React Query (`@tanstack/react-query`) Hooks

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchVenueTelemetry, submitWifiTelemetry, OccupancyRecord } from "@/lib/api/telemetry";

export function useVenueTelemetryQuery(venueId: string) {
  return useQuery<OccupancyRecord[], Error>({
    queryKey: ["venue-telemetry", venueId],
    queryFn: () => fetchVenueTelemetry(venueId),
    staleTime: 1000 * 60 * 5, // 5 minutes fresh window
    refetchInterval: 1000 * 60 * 2, // Auto-refetch every 2 minutes
    enabled: Boolean(venueId),
  });
}

export function useSubmitTelemetryMutation(venueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { download: number; upload: number; latency: number; crowdLevel: string; authToken: string }) =>
      submitWifiTelemetry(venueId, data, data.authToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["venue-telemetry", venueId] });
    },
  });
}
```

---

### 8.3 cURL Usage Snippets

#### Fetch Telemetry Data (GET)

```bash
curl -X GET "https://worksphere.app/api/venues/v-88291a/telemetry?timeframe=today" \
  -H "Accept: application/json"
```

#### Submit Telemetry Measurement (POST)

```bash
curl -X POST "https://worksphere.app/api/venues/v-88291a/telemetry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer clk_sess_123456789" \
  -d '{
    "download": 95.4,
    "upload": 22.8,
    "latency": 19.5,
    "crowdLevel": "moderate"
  }'
```

---

## 9. OpenAPI 3.0 Specification Snippet

```yaml
openapi: 3.0.3
info:
  title: WorkSphere Venue Telemetry API
  version: 1.0.0
paths:
  /api/venues/{venueId}/telemetry:
    get:
      summary: Retrieve venue telemetry occupancy curve
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: string
          example: v-88291a
        - name: timeframe
          in: query
          required: false
          schema:
            type: string
            enum: [today, 24h, 7d, 30d]
            default: today
      responses:
        '200':
          description: Telemetry data retrieved successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  occupancy:
                    type: array
                    items:
                      type: object
                      properties:
                        time:
                          type: string
                          example: "12 PM"
                        occupancy:
                          type: integer
                          example: 85
        '404':
          description: Venue not found
        '429':
          description: Rate limit exceeded
    post:
      summary: Submit crowdsourced Wi-Fi & density report
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [download, upload, latency, crowdLevel]
              properties:
                download:
                  type: number
                  example: 120.5
                upload:
                  type: number
                  example: 35.0
                latency:
                  type: number
                  example: 15.2
                crowdLevel:
                  type: string
                  enum: [empty, low, quiet, moderate, busy, very busy, packed]
                  example: moderate
      responses:
        '202':
          description: Telemetry report accepted for processing
        '400':
          description: Missing required fields
        '401':
          description: Unauthorized
```

---

## 10. Testing & Mock Data Support

For development and automated testing environments, any request where `venueId` starts with `mock-` (e.g., `mock-venue-101`) will bypass database lookup constraints and synthesize realistic fallback telemetry curves:

```bash
# Test mock venue endpoint
curl -X GET "http://localhost:3000/api/venues/mock-venue-101/telemetry"
```

---

## 11. API Verification & Diagnostics Checklist

- [x] Endpoint `GET /api/venues/[venueId]/telemetry` returns `occupancy` time array.
- [x] Endpoint `POST /api/venues/[venueId]/telemetry` accepts `download`, `upload`, `latency`, `crowdLevel`.
- [x] Differential privacy filter verified for sample count $N < 10$.
- [x] Error status codes 400, 401, 404, 429, and 500 documented with JSON payload schemas.
- [x] Client TypeScript fetch and React Query helpers provided.
