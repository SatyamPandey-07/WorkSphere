# Quiet-Hours Prediction API Guide

Technical reference for WorkSphere's historical venue quiet-hours prediction endpoint (`GET /api/venues/{venueId}/quiet-hours`). This guide explains how historical venue rating samples are grouped by UTC hour-of-day to generate 24-hour noise profiles, contiguous quiet windows, peak noise hours, and summaries.

---

## 1. Endpoint Overview

| Property           | Value                                                                                                                             |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP Method**    | `GET`                                                                                                                             |
| **Path**           | `/api/venues/{venueId}/quiet-hours`                                                                                               |
| **Path Parameter** | `venueId` (`string`, required) — WorkSphere venue identifier (trimmed prior to query)                                             |
| **Handler**        | [`src/app/api/venues/[venueId]/quiet-hours/route.ts`](../../src/app/api/venues/%5BvenueId%5D/quiet-hours/route.ts)                |
| **Core Engine**    | [`src/lib/quietHoursPrediction.ts`](../../src/lib/quietHoursPrediction.ts)                                                        |
| **Purpose**        | Return a 24-hour ambient noise profile, contiguous predicted quiet windows, peak noise hours, and a human-readable summary string |

### Authentication & Validation Notes

- The route handler does not invoke Clerk `auth()` or rate limiting directly.
- When `venueId` is missing, the handler responds with `400 Bad Request` via `apiError("venueId is required", 400, "VALIDATION_FAILED")`.

---

## 2. Distinction from Telemetry, Live Noise Metrics, and Occupational Acoustics

WorkSphere separates real-time telemetry ingestion, short-window live metrics, occupational sound safety guidelines, and historical quiet-hours prediction:

| Capability                        | Primary Endpoint / Document                                                                                                      | Data Scope & Purpose                                                                                                             |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| **Quiet-Hours Prediction**        | `GET /api/venues/{venueId}/quiet-hours` _(this guide)_                                                                           | Historical `VenueRating` records aggregated across all time into 24 UTC hours (`0–23`) to identify quiet windows and peak hours. |
| **Live Noise Metrics & Forecast** | [`GET /api/venues/{venueId}/noise-metrics`](../API_REFERENCE.md#endpoint-specification-environmental-acoustics--noise-telemetry) | Rolling lookback windows (`windowHours`), spectral band decomposition, and recent telemetry monitoring.                          |
| **Audio DSP Telemetry Pipeline**  | [Noise Level Telemetry Guide](../NOISE_TELEMETRY.md)                                                                             | Browser Web Audio + WASM RMS sampling, decibel conversion, and telemetry submission pipeline.                                    |
| **Occupational Noise Dosimetry**  | [Noise Calculation Reference](../NOISE_CALCULATION_REFERENCE.md)                                                                 | Regulatory NIOSH REL (`85 dBA`) and OSHA PEL (`90 dBA`) daily exposure formulas for hearing protection.                          |

---

## 3. Data Source & UTC-Hour Grouping

`predictQuietHours(venueId)` calls `getHourlyNoiseProfile(venueId)` against the Prisma `VenueRating` model defined in [`prisma/schema.prisma`](../../prisma/schema.prisma).

### Fields Used

- **`avgDecibels`** (`Float?`): Numeric average decibel reading associated with the venue rating. Null, non-finite (`NaN`, `Infinity`), and negative values are excluded.
- **`createdAt`** (`DateTime`): Timestamp of the rating record.

### UTC-Hour Bucketing

- Every valid `VenueRating` sample is assigned to one of 24 hourly buckets indexed **`0` through `23` strictly in UTC** (corresponding to `createdAt` hour-of-day UTC, **not** the venue's local timezone).
- Clients displaying hours to end users in local time should convert each UTC hour index (`0–23`) to the user's or venue's local timezone when rendering UI labels.
- Hourly `averageDb` values are computed as the arithmetic mean of valid `avgDecibels` samples in that UTC hour, rounded to one decimal place (`Math.round((sum / count) * 10) / 10`).

---

## 4. Classification Thresholds

`src/lib/quietHoursPrediction.ts` defines two constant classification thresholds:

```ts
export const QUIET_THRESHOLD_DB = 55;
export const PEAK_THRESHOLD_DB = 70;
```

| Label            | Decibel Condition (`averageDb`)                        | Window / Peak Inclusion               |
| :--------------- | :----------------------------------------------------- | :------------------------------------ |
| **`"Quiet"`**    | `< 55 dB` (`db < QUIET_THRESHOLD_DB`)                  | Included in contiguous `quietWindows` |
| **`"Moderate"`** | `>= 55 dB` and `< 70 dB` (or `null` / invalid / `< 0`) | Neither quiet window nor peak hour    |
| **`"Loud"`**     | `>= 70 dB` (`db >= PEAK_THRESHOLD_DB`)                 | Included in `peakHours`               |

> [!NOTE]
> **Application Focus Heuristics — Not Occupational Safety Limits:**
> The `55 dB` ("Quiet") and `70 dB` ("Loud") thresholds are application-level workspace comfort heuristics used to classify suitability for focused work vs. lively environments. They are **not** occupational hearing exposure limits. Refer to the [NIOSH/OSHA Noise Calculation Reference](../NOISE_CALCULATION_REFERENCE.md) for regulatory hearing-safety criteria.

### Contiguous Quiet Window Merging

- Any maximal contiguous sequence of UTC hours where `averageDb !== null && averageDb < 55` becomes an entry in `quietWindows`:
  - `startHour`: First UTC hour in the contiguous run (`0–23`).
  - `endHour`: Last inclusive UTC hour in the contiguous run (`0–23`). For example, quiet hours `14`, `15`, and `16` merge into `{ "startHour": 14, "endHour": 16 }`, which is formatted in `summary` as `14:00–17:00` (`endHour + 1`, formatted up to `24:00` when `endHour === 23`).
  - `avgDb`: Arithmetic mean of the hourly `averageDb` values in `[startHour, endHour]`, rounded to one decimal place.

---

## 5. Response Schema & Example

### Top-Level Fields (`QuietWindowPrediction`)

| Field           | Type                                                           | Description                                                                                                                                                              |
| :-------------- | :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venueId`       | `string`                                                       | Trimmed venue identifier for which the prediction was computed.                                                                                                          |
| `quietWindows`  | `Array<{ startHour: number; endHour: number; avgDb: number }>` | Merged contiguous blocks of UTC hours whose `averageDb` is strictly below `55` dB.                                                                                       |
| `peakHours`     | `number[]`                                                     | Sorted list of UTC hours (`0–23`) whose `averageDb` is `>= 70` dB.                                                                                                       |
| `summary`       | `string`                                                       | Human-readable summary describing up to the first 3 quiet windows and peak hours, or `"Insufficient noise data to predict quiet windows."` when `quietWindows` is empty. |
| `hourlyProfile` | `HourlyNoiseProfile[]`                                         | Fixed 24-element array ordered by UTC hour `0` through `23`.                                                                                                             |

### `hourlyProfile` Entry Fields (`HourlyNoiseProfile`)

| Field       | Type                              | Description                                                                                 |
| :---------- | :-------------------------------- | :------------------------------------------------------------------------------------------ |
| `hour`      | `number`                          | UTC hour of day (`0` to `23`).                                                              |
| `averageDb` | `number \| null`                  | Mean decibels for that UTC hour rounded to 1 decimal place, or `null` when `samples === 0`. |
| `label`     | `"Quiet" \| "Moderate" \| "Loud"` | Acoustic classification from `classifyNoiseLevelDb(averageDb)`.                             |
| `samples`   | `number`                          | Total number of valid rating samples aggregated into this UTC hour.                         |

### `quietWindows` Entry Fields

| Field       | Type     | Description                                                                           |
| :---------- | :------- | :------------------------------------------------------------------------------------ |
| `startHour` | `number` | Inclusive starting UTC hour (`0–23`).                                                 |
| `endHour`   | `number` | Inclusive ending UTC hour (`0–23`).                                                   |
| `avgDb`     | `number` | Rounded average dB across the hours inside the window (`Math.round(mean * 10) / 10`). |

### Example Request

```http
GET /api/venues/cly019abc0001xyz890venue1/quiet-hours HTTP/1.1
Host: worksphere.app
Accept: application/json
```

### Example Response (`200 OK`)

```json
{
  "venueId": "cly019abc0001xyz890venue1",
  "quietWindows": [
    {
      "startHour": 6,
      "endHour": 7,
      "avgDb": 47.4
    },
    {
      "startHour": 14,
      "endHour": 15,
      "avgDb": 49.9
    }
  ],
  "peakHours": [12, 18],
  "summary": "Quietest times: 06:00–08:00 (~47.4 dB), 14:00–16:00 (~49.9 dB). Peak noise around 12:00, 18:00.",
  "hourlyProfile": [
    { "hour": 0, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 1, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 2, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 3, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 4, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 5, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 6, "averageDb": 46.2, "label": "Quiet", "samples": 4 },
    { "hour": 7, "averageDb": 48.5, "label": "Quiet", "samples": 6 },
    { "hour": 8, "averageDb": 57.1, "label": "Moderate", "samples": 9 },
    { "hour": 9, "averageDb": 61.4, "label": "Moderate", "samples": 12 },
    { "hour": 10, "averageDb": 63.0, "label": "Moderate", "samples": 11 },
    { "hour": 11, "averageDb": 66.8, "label": "Moderate", "samples": 14 },
    { "hour": 12, "averageDb": 72.3, "label": "Loud", "samples": 18 },
    { "hour": 13, "averageDb": 67.5, "label": "Moderate", "samples": 10 },
    { "hour": 14, "averageDb": 50.6, "label": "Quiet", "samples": 8 },
    { "hour": 15, "averageDb": 49.2, "label": "Quiet", "samples": 7 },
    { "hour": 16, "averageDb": 58.9, "label": "Moderate", "samples": 9 },
    { "hour": 17, "averageDb": 68.4, "label": "Moderate", "samples": 13 },
    { "hour": 18, "averageDb": 73.1, "label": "Loud", "samples": 16 },
    { "hour": 19, "averageDb": 64.0, "label": "Moderate", "samples": 7 },
    { "hour": 20, "averageDb": 56.3, "label": "Moderate", "samples": 5 },
    { "hour": 21, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 22, "averageDb": null, "label": "Moderate", "samples": 0 },
    { "hour": 23, "averageDb": null, "label": "Moderate", "samples": 0 }
  ]
}
```

---

## 6. Empty-Data Behavior

When a venue has no usable `VenueRating` samples (or when no hour has `averageDb < 55`), the prediction contract behaves deterministically:

- `quietWindows`: `[]` (empty array).
- `peakHours`: `[]` when no hours reach `>= 70 dB` (note: if samples exist only in `Moderate`/`Loud` hours `>= 55 dB`, `peakHours` can still contain hours `>= 70 dB`).
- `hourlyProfile`: Always contains **24 entries** (`hour` `0` through `23`). Unsampled hours have `averageDb: null`, `label: "Moderate"`, and `samples: 0`.
- `summary`: `"Insufficient noise data to predict quiet windows."` whenever `quietWindows.length === 0`.

---

## 7. Error Handling & Status Codes

| Status Code                     | Condition                                                        | Response Payload                                                                                         |
| :------------------------------ | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| **`200 OK`**                    | Prediction computed (including when no historical ratings exist) | `QuietWindowPrediction` JSON object (`venueId`, `quietWindows`, `peakHours`, `summary`, `hourlyProfile`) |
| **`400 Bad Request`**           | Missing `venueId` route parameter                                | `{ "success": false, "error": "venueId is required", "code": "VALIDATION_FAILED" }`                      |
| **`500 Internal Server Error`** | Unexpected failure querying ratings or building prediction       | `{ "success": false, "error": "Failed to predict quiet hours", "code": "INTERNAL_ERROR" }`               |

---

## 8. Related Architecture & Source Files

```text
GET /api/venues/{venueId}/quiet-hours
  └── src/app/api/venues/[venueId]/quiet-hours/route.ts
        ├── Validates non-empty venueId (400 via src/lib/apiResponse.ts)
        └── Calls predictQuietHours(venueId) in src/lib/quietHoursPrediction.ts
              ├── getHourlyNoiseProfile(venueId) -> queries Prisma VenueRating (avgDecibels, createdAt)
              └── Builds 24 UTC buckets, merges quietWindows (<55 dB), extracts peakHours (>=70 dB), formats summary
```

- **Route Handler**: [`src/app/api/venues/[venueId]/quiet-hours/route.ts`](../../src/app/api/venues/%5BvenueId%5D/quiet-hours/route.ts)
- **Prediction Engine**: [`src/lib/quietHoursPrediction.ts`](../../src/lib/quietHoursPrediction.ts)
- **Error Helpers**: [`src/lib/apiResponse.ts`](../../src/lib/apiResponse.ts)
- **Database Model**: `VenueRating` in [`prisma/schema.prisma`](../../prisma/schema.prisma)
- **API Tests**: [`src/__tests__/api/quietHours.test.ts`](../../src/__tests__/api/quietHours.test.ts)
- **Unit & Edge-Case Tests**: [`src/__tests__/lib/quietHoursPrediction.test.ts`](../../src/__tests__/lib/quietHoursPrediction.test.ts)
- **API Index**: [`docs/API_REFERENCE.md`](../API_REFERENCE.md)
