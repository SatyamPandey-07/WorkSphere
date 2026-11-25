# WorkSphere API Reference

This document provides a high-level reference for the REST API endpoints available in WorkSphere. The routes are organized by feature to help developers locate the appropriate endpoints when integrating or extending the application.

> **Note:** Endpoint behaviour, request validation, and response payloads are defined in their corresponding `route.ts` implementations under `src/app/api`.

---

# Authentication

| `POST /api/webhooks/clerk` | Verify Clerk/Svix-signed user lifecycle events and synchronize the WorkSphere user profile. See the [Clerk webhook integration runbook](./auth/CLERK_WEBHOOK_INTEGRATION.md). |

| Endpoint                         | Description                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/auth/csrf-token`      | Generate a CSRF token for secure requests.                                    |
| `POST /api/auth/forgot-password` | Initiate the password reset workflow.                                         |
| `POST /api/auth/reset-password`  | Complete the password reset process.                                          |
| `POST /api/auth/resend-otp`      | Retired endpoint (HTTP 410 Gone). Password reset codes are managed via Clerk. |
| `POST /api/auth/verify-otp`      | Retired endpoint (HTTP 410 Gone). Verification codes are managed via Clerk.   |
| `POST /api/auth/sso/pkce`        | Generate a PKCE challenge for SSO authentication.                             |
| `GET /api/auth/sso/metadata`     | Retrieve SSO metadata.                                                        |
| `POST /api/auth/sso/saml`        | Handle SAML authentication requests.                                          |
| `POST /api/auth/webauthn/verify` | Verify a WebAuthn authentication request.                                     |

---

# Venues

| Endpoint                                           | Description                                                                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/venues`                                  | Retrieve available venues.                                                                                                                                                          |
| `GET /api/venues/search`                           | Search venues with filters (noise level, amenities, speed, distance, bbox).                                                                                                         |
| `GET /api/search`                                  | Spatial venue bounding-box search supporting anti-meridian crossover. See the [Spatial venue bounding-box search guide](./api/SPATIAL_VENUE_SEARCH.md) for details.                 |
| `POST /api/search`                                 | Spatial venue bounding-box search via JSON request body with explicit offset support. See the [Spatial venue bounding-box search guide](./api/SPATIAL_VENUE_SEARCH.md) for details. |
| `POST /api/venues`                                 | Create or submit a venue.                                                                                                                                                           |
| `POST /api/venues/amenity-vote`                    | Submit an amenity vote.                                                                                                                                                             |
| `GET /api/venues/updates`                          | Subscribe to venue updates.                                                                                                                                                         |
| `POST /api/venues/updates`                         | Broadcast a venue update.                                                                                                                                                           |
| `POST /api/venues/{venueId}/rate`                  | Submit a venue rating.                                                                                                                                                              |
| `GET /api/venues/{venueId}/reviews`                | Retrieve venue reviews.                                                                                                                                                             |
| `GET /api/venues/{venueId}/menu`                   | Retrieve venue menu information.                                                                                                                                                    |
| `GET /api/venues/{venueId}/photo`                  | Retrieve venue photos.                                                                                                                                                              |
| `GET /api/venues/{venueId}/noise-metrics`          | Retrieve venue noise metrics and time-bucket distributions.                                                                                                                         |
| `POST /api/venues/{venueId}/noise-metrics`         | Submit calibrated crowdsourced ambient decibel reading.                                                                                                                             |
| `GET /api/venues/{venueId}/noise-metrics/forecast` | Retrieve predicted noise levels.                                                                                                                                                    |
| `GET /api/venues/acoustics/rt60`                   | Retrieve venue RT60 reverberation time heatmap and call quality scores.                                                                                                             |
| `POST /api/venues/acoustics/rt60`                  | Ingest crowdsourced RT60 reverberation decay measurements.                                                                                                                          |
| `GET /api/venues/{venueId}/wifi-prediction`        | Retrieve Wi-Fi prediction data.                                                                                                                                                     |
| `GET /api/venues/{venueId}/seating-forecast`       | Retrieve seating forecasts.                                                                                                                                                         |
| `GET /api/venues/{venueId}/telemetry`              | Retrieve venue telemetry.                                                                                                                                                           |
| `GET /api/venues/{venueId}/live-stream`            | Connect to the venue live stream.                                                                                                                                                   |
| `POST /api/venues/{venueId}/check-in/bulk`         | Perform manager bulk check-in for venue bookings. See the [Bulk venue check-in API guide](./api/BULK_CHECK_IN.md) for details.                                                      |
| `POST /api/venues/check-in/iot`                    | Record IoT smart-lock check-in using HMAC-SHA256 webhook authentication. See the [IoT smart-lock check-in guide](./api/IOT_SMART_LOCK_CHECKIN.md) for details.                      |
| `GET /api/venues/{venueId}/waitlist`               | Retrieve the authenticated user's active waitlist entries for a venue. See the [Waitlist API guide](./api/WAITLIST_API.md) for details.                                             |
| `POST /api/venues/{venueId}/waitlist`              | Join a venue's seat waitlist for a specific date, time slot, and seat preferences. See the [Waitlist API guide](./api/WAITLIST_API.md) for details.                                 |
| `DELETE /api/venues/{venueId}/waitlist`            | Cancel an active waitlist entry via `waitlistId` query parameter. See the [Waitlist API guide](./api/WAITLIST_API.md) for details.                                                  |
| `POST /api/waitlist/{waitlistId}/claim`            | Atomically claim a notified seat offer and convert it into a confirmed booking. See the [Waitlist API guide](./api/WAITLIST_API.md) for details.                                    |

### Endpoint Specification: `GET /api/venues/search`

Search and filter workspace venues based on location, acoustic noise metrics, Wi-Fi performance, amenities, and spatial bounding box (`bbox`) boundaries.

#### Query Parameters

| Parameter             | Type     | Required | Default     | Description                                                                             |
| :-------------------- | :------- | :------- | :---------- | :-------------------------------------------------------------------------------------- |
| `query` / `q`         | `string` | No       | `""`        | Text query string to search by venue name, address, or description.                     |
| `lat`                 | `number` | No       | `undefined` | Latitude coordinate for distance-based sorting and proximity searches.                  |
| `lng`                 | `number` | No       | `undefined` | Longitude coordinate for distance-based sorting and proximity searches.                 |
| `distance` / `radius` | `number` | No       | `5000`      | Search radius in meters surrounding the `(lat, lng)` origin point.                      |
| `bbox`                | `string` | No       | `undefined` | Bounding box coordinates formatted as `minLng,minLat,maxLng,maxLat`.                    |
| `noiseLevel`          | `string` | No       | `undefined` | Filter by noise profile (`"quiet"`, `"moderate"`, `"lively"`).                          |
| `wifiMinSpeed`        | `number` | No       | `0`         | Minimum Wi-Fi download speed in Mbps requirement.                                       |
| `amenities`           | `string` | No       | `undefined` | Comma-separated list of required amenities (e.g. `wifi,outlets,ergonomic,phoneBooths`). |
| `category`            | `string` | No       | `undefined` | Category filter (e.g. `COWORKING`, `CAFE`, `LIBRARY`).                                  |
| `page`                | `number` | No       | `1`         | Pagination page index (minimum 1).                                                      |
| `limit`               | `number` | No       | `50`        | Maximum items per page (1 to 100).                                                      |

#### Example Request

```http
GET /api/venues/search?lat=37.7749&lng=-122.4194&distance=5000&noiseLevel=quiet&wifiMinSpeed=50&amenities=wifi,outlets&limit=2 HTTP/1.1
Host: worksphere.app
Accept: application/json
```

#### Example Response Payload (`200 OK`)

```json
{
  "venues": [
    {
      "id": "v_sf_central_01",
      "name": "CoWorkspace Central",
      "category": "COWORKING",
      "address": "456 Market St, San Francisco, CA 94105",
      "lat": 37.7897,
      "lng": -122.4012,
      "distanceMeters": 1420,
      "wifiSpeed": 120,
      "hasOutlets": true,
      "noiseLevel": "quiet",
      "rating": 4.8,
      "amenities": ["wifi", "outlets", "phoneBooths", "ergonomicSeating"],
      "updatedAt": "2026-10-05T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "totalCount": 1,
    "totalPages": 1
  }
}
```

#### Standard HTTP Status Codes

| Status Code                 | Reason              | Description & Payload                                                                                                                                                                       |
| :-------------------------- | :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `200 OK`                    | Success             | Returns the list of matching venue records along with pagination details.                                                                                                                   |
| `400 Bad Request`           | Invalid Parameters  | Returned when query parameters fail validation (e.g., malformed `bbox` or invalid coordinate range).<br/>`{ "error": "Invalid bounding box format. Expected minLng,minLat,maxLng,maxLat" }` |
| `429 Too Many Requests`     | Rate Limit Exceeded | Returned when client exceeds the 60 search requests/minute quota.<br/>`{ "error": "Too many search requests. Please slow down and try again.", "retryAfter": 60 }`                          |
| `500 Internal Server Error` | Server Error        | Internal server or database error processing the query.<br/>`{ "error": "An internal server error occurred while searching venues." }`                                                      |

### Endpoint Specification: `GET /api/search` and `POST /api/search`

Query venues situated within geographic bounding-box coordinates, with support for anti-meridian (180°/-180°) Date Line crossover, exact category matching, sanitized text search, and pagination.

For the complete parameter reference, anti-meridian SQL logic, request examples, and response schemas, see the [Spatial Venue Bounding-Box Search API Guide](./api/SPATIAL_VENUE_SEARCH.md).

---

### Endpoint Specification: Environmental Acoustics & Noise Telemetry

For the formal OpenAPI 3.1.0 contract, see [openapi.yaml](./api/openapi.yaml).

WorkSphere provides end-to-end environmental acoustics monitoring, crowdsourced sound level ratings, hardware IoT sensor ingestion, and spatial reverberation mapping across the following endpoints:

- `GET /api/venues/{venueId}/noise-metrics` — Retrieve venue ambient noise metrics and 4-period time buckets.
- `POST /api/venues/{venueId}/noise-metrics` — Submit authenticated user decibel readings ($30\text{--}90\text{ dB}$).
- `POST /api/telemetry/noise` — Ingest hardware IoT noise telemetry with Gaussian differential privacy.
- `GET /api/venues/acoustics/rt60` — Retrieve spatial reverberation time ($T_{60}$) heatmap and call-quality scores.
- `POST /api/venues/acoustics/rt60` — Ingest crowdsourced impulse response RT60 measurements.

#### Query Parameters (Acoustic Telemetry)

| Parameter            | Type      | Required | Default | Description                                                                                                                                            |
| :------------------- | :-------- | :------: | :-----: | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `windowHours`        | `integer` |    No    |  `24`   | Lookback window in hours for aggregation (min `1`, max `168`).                                                                                         |
| `frequencyBand`      | `string`  |    No    | `"all"` | Acoustic band filter (`"all"`, `"low"`, `"mid"`, `"high"`, `"sub-bass"`, `"speech"`, `"clatter"`, or octave bands `"125Hz"`–`"8kHz"`, `"1/3-octave"`). |
| `includeSpectrogram` | `boolean` |    No    | `false` | When `true`, includes FFT spectrogram frequency distribution and energy decomposition in the response payload.                                         |

#### Request & Response Examples

##### 1. GET `/api/venues/{venueId}/noise-metrics?windowHours=24&frequencyBand=all&includeSpectrogram=true`

Retrieves 4-period noise buckets (`morning`, `lunch`, `afternoon`, `evening`) and total sample count.

```http
GET /api/venues/cly019abc0001xyz890venue1/noise-metrics?windowHours=24&includeSpectrogram=true HTTP/1.1
Host: worksphere.app
Accept: application/json
```

**Response (`200 OK`):**

```json
{
  "venueId": "cly019abc0001xyz890venue1",
  "buckets": [
    {
      "key": "morning",
      "label": "Morning",
      "averageDb": 41.2,
      "peakDb": 52.8,
      "samples": 14
    },
    {
      "key": "lunch",
      "label": "Lunch hour",
      "averageDb": 58.7,
      "peakDb": 71.3,
      "samples": 22
    },
    {
      "key": "afternoon",
      "label": "Afternoon",
      "averageDb": 49.4,
      "peakDb": 63.0,
      "samples": 18
    },
    {
      "key": "evening",
      "label": "Evening",
      "averageDb": 44.1,
      "peakDb": 55.6,
      "samples": 9
    }
  ],
  "totalSamples": 63,
  "spectrogram": {
    "sampleRate": 44100,
    "windowHours": 24,
    "frequencyBand": "all",
    "bands": [
      {
        "band": "low",
        "frequencyRange": "20Hz-250Hz",
        "averageEnergyDb": 36.4,
        "peakFrequencyHz": 120
      },
      {
        "band": "mid",
        "frequencyRange": "250Hz-4kHz",
        "averageEnergyDb": 51.2,
        "peakFrequencyHz": 1050
      },
      {
        "band": "high",
        "frequencyRange": "4kHz-16kHz",
        "averageEnergyDb": 31.8,
        "peakFrequencyHz": 5400
      }
    ]
  }
}
```

##### 2. POST `/api/venues/{venueId}/noise-metrics`

Submits an authenticated user decibel measurement. Requires Clerk authentication (`Authorization: Bearer <session_token>`).

**Request Body:**

```json
{
  "decibels": 52.4,
  "peakDecibels": 64.1
}
```

**Response (`201 Created`):**

```json
{
  "success": true,
  "venueId": "cly019abc0001xyz890venue1",
  "decibels": 52.4,
  "noiseLevel": "moderate",
  "buckets": [
    {
      "key": "morning",
      "label": "Morning",
      "averageDb": 41.2,
      "peakDb": 52.8,
      "samples": 14
    },
    {
      "key": "lunch",
      "label": "Lunch hour",
      "averageDb": 58.7,
      "peakDb": 71.3,
      "samples": 22
    },
    {
      "key": "afternoon",
      "label": "Afternoon",
      "averageDb": 49.8,
      "peakDb": 64.1,
      "samples": 19
    },
    {
      "key": "evening",
      "label": "Evening",
      "averageDb": 44.1,
      "peakDb": 55.6,
      "samples": 9
    }
  ],
  "totalSamples": 64
}
```

##### 3. POST `/api/telemetry/noise` (Hardware IoT Sensor Ingestion)

Hardware IoT devices authenticate with `Authorization: Bearer <WORKER_SECRET>` and stream sound pressure observations protected by Gaussian Differential Privacy.

**Request Body:**

```json
{
  "venueId": "cly019abc0001xyz890venue1",
  "decibelLevel": 56.8,
  "measuredAt": "2026-11-22T16:30:00.000Z",
  "sensorId": "station-acoustic-north-wing-02"
}
```

**Response (`200 OK`):**

```json
{
  "success": true,
  "venueId": "cly019abc0001xyz890venue1",
  "noiseCategory": "moderate",
  "timestamp": "2026-11-22T16:30:00.000Z",
  "sensorId": "station-acoustic-north-wing-02",
  "privacy": {
    "epsilon": 0.32,
    "delta": 0.00001,
    "submissions": 15
  }
}
```

##### 4. GET & POST `/api/venues/acoustics/rt60` (Reverberation & Call Quality)

- `GET /api/venues/acoustics/rt60?venueId=...` returns zone reverberation decay metrics ($T_{60}$) and normalized call-quality scores (0–100).
- `POST /api/venues/acoustics/rt60` ingests crowdsourced Web Audio worklet impulse response measurements.

**Request Body (POST):**

```json
{
  "venueId": "cly019abc0001xyz890venue1",
  "zoneId": "zone_quiet_annex",
  "rt60": 0.45,
  "coordinates": { "x": 12.4, "y": 8.1, "z": 1.2 }
}
```

**Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Acoustic data ingested successfully"
}
```

#### Rate Limiting & Error Responses

Acoustic endpoints fall under the **Telemetry & Sensor Streams** rate-limit tier (**120 requests / 1 minute**).

| HTTP Status             | Error Code          | Description & Sample Payload                                                                                                                                                         |
| :---------------------- | :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 Bad Request`       | `VALIDATION_FAILED` | Out-of-range decibel reading ($< 30$ or $> 90\text{ dB}$):<br/>`{ "success": false, "error": "Decibel reading must be a number between 30 and 90 dB", "code": "VALIDATION_FAILED" }` |
| `401 Unauthorized`      | `UNAUTHORIZED`      | Missing or invalid Clerk session token or `WORKER_SECRET` header:<br/>`{ "success": false, "error": "Unauthorized", "code": "UNAUTHORIZED" }`                                        |
| `404 Not Found`         | `VENUE_NOT_FOUND`   | Venue identifier does not exist:<br/>`{ "success": false, "error": "Venue not found", "code": "VENUE_NOT_FOUND" }`                                                                   |
| `429 Too Many Requests` | `RATE_LIMITED`      | Quota exceeded or daily privacy budget exhausted:<br/>`{ "error": "Rate limited", "code": "RATE_LIMITED" }` (or `{ "error": "Daily telemetry privacy budget exhausted" }`)           |

---

# Bookings

| Endpoint                                     | Description                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/bookings/confirm`                 | Confirm a booking.                                                                                                                                                                               |
| `GET /api/bookings/history`                  | Retrieve the authenticated user's booking history.                                                                                                                                               |
| `GET /api/bookings/export`                   | Export booking information.                                                                                                                                                                      |
| `GET /api/bookings/{bookingId}`              | Retrieve booking details.                                                                                                                                                                        |
| `GET /api/bookings/{bookingId}/download`     | Download a booking receipt or confirmation.                                                                                                                                                      |
| `GET /api/bookings/{bookingId}/guests`       | Retrieve guest information for a booking.                                                                                                                                                        |
| `GET /api/bookings/{bookingId}/calendar.ics` | Export an RFC 5545 iCalendar (.ics) file or calendar web links for a booking.                                                                                                                    |
| `GET /api/payments/split/{token}`            | Verify guest split-payment token and retrieve checkout details. See the [Guest Split Payment API guide](./api/GUEST_SPLIT_PAYMENT.md) for details.                                               |
| `POST /api/payments/split/{token}`           | Record payment state in WorkSphere's database using the verified token claims and issue a digital guest pass. See the [Guest Split Payment API guide](./api/GUEST_SPLIT_PAYMENT.md) for details. |

---

# Receipts

| Endpoint                        | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `GET /api/receipts/{bookingId}` | Retrieve receipt information for a booking. |

---

# Reservations

| Endpoint                                | Description                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/reservations/availability`    | Retrieve reservation availability.                                                                                                                                                    |
| `POST /api/reservations/book`           | Create a reservation.                                                                                                                                                                 |
| `GET /api/reservations/events`          | Stream real-time reservation availability and desk expiration events via Server-Sent Events. See the [Reservation Availability SSE guide](api/RESERVATION_EVENTS_SSE.md) for details. |
| `POST /api/reservations/recurring-book` | Create recurring reservations.                                                                                                                                                        |

---

# Folders

| Endpoint                                           | Description                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/folders`                                 | Retrieve folders.                                                                                                                     |
| `POST /api/folders`                                | Create a folder.                                                                                                                      |
| `POST /api/folders/join`                           | Join a shared folder.                                                                                                                 |
| `GET /api/folders/{id}`                            | Retrieve folder details.                                                                                                              |
| `GET /api/folders/{id}/export?format=geojson\|kml` | Export folder venues as GeoJSON or KML spatial data. See the [Folder Exports guide](./api/FOLDER_EXPORTS.md) for details.             |
| `GET /api/folders/{id}/export-pdf`                 | Export folder venues and personal notes as a PDF summary report. See the [Folder Exports guide](./api/FOLDER_EXPORTS.md) for details. |
| `GET /api/folders/{id}/export-billing`             | Export confirmed venue booking history as a billing CSV report. See the [Folder Exports guide](./api/FOLDER_EXPORTS.md) for details.  |
| `GET /api/folders/{id}/invites`                    | Retrieve folder invitations.                                                                                                          |
| `POST /api/folders/{id}/refresh`                   | Refresh folder data.                                                                                                                  |
| `GET /api/folders/{id}/venues`                     | Retrieve venues within a folder.                                                                                                      |
| `GET /api/folders/{id}/venues/{venueId}`           | Retrieve a specific venue in a folder.                                                                                                |

---

# User

| Endpoint                        | Description                                                             |
| ------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/user/badges`          | Retrieve user badges.                                                   |
| `GET /api/user/notifications`   | Retrieve the latest user notifications and unread count.                |
| `POST /api/user/notifications`  | Mark notifications as read or restore selected notifications as unread. |
| `GET /api/user/settings`        | Retrieve or update user settings.                                       |
| `GET /api/user/streak`          | Retrieve the user's activity streak.                                    |
| `POST /api/user/verify-student` | Verify student status.                                                  |

---

# Favorites

| Endpoint                                          | Description                      |
| ------------------------------------------------- | -------------------------------- |
| `GET /api/favorites`                              | Retrieve saved favourite venues. |
| `POST /api/favorites`                             | Add a favourite venue.           |
| `POST /api/favorites/tags/sync`                   | Synchronise favourite tags.      |
| `GET /api/favorites/{favoriteId}/notes`           | Retrieve notes for a favourite.  |
| `GET /api/favorites/{favoriteId}/tags`            | Retrieve tags for a favourite.   |
| `DELETE /api/favorites/{favoriteId}/tags/{tagId}` | Remove a tag from a favourite.   |

---

# Collections

| Endpoint                              | Description                  |
| ------------------------------------- | ---------------------------- |
| `GET /api/collections/public`         | Retrieve public collections. |
| `POST /api/collections/public/share`  | Share a public collection.   |
| `POST /api/collections/public/upvote` | Upvote a public collection.  |

---

# Conversations

| Endpoint                      | Description                       |
| ----------------------------- | --------------------------------- |
| `GET /api/conversations`      | Retrieve conversations.           |
| `POST /api/conversations`     | Create a conversation.            |
| `GET /api/conversations/{id}` | Retrieve a specific conversation. |

---

# Social

| Endpoint                                            | Description                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/social/status`                            | Retrieve social status information.                                                                                                                                                                                                                                                                                  |
| `POST /api/social/sessions`                         | Create a new coworking session and automatically confirm the host's RSVP. See the [Social Coworking Sessions architecture guide](./architecture/social-coworking-sessions.md) for details.                                                                                                                           |
| `GET /api/social/sessions`                          | Retrieve all coworking sessions ordered by start time, including venue details, host profile, RSVP records, and total RSVP count. See the [Social Coworking Sessions architecture guide](./architecture/social-coworking-sessions.md) for details.                                                                   |
| `GET /api/social/sessions/{slug}`                   | Retrieve details for a single coworking session by slug, including venue, host, and RSVP attendee list. See the [Social Coworking Sessions architecture guide](./architecture/social-coworking-sessions.md) for details.                                                                                             |
| `POST /api/social/sessions/{slug}/rsvp`             | Submit or update an RSVP (`GOING`, `MAYBE`, `DECLINED`, `CANCELLED`; `CANCELLED` is normalized to `DECLINED`), with capacity checks, serializable concurrency control, and inline calendar payload. See the [Social Coworking Sessions architecture guide](./architecture/social-coworking-sessions.md) for details. |
| `DELETE /api/social/sessions/{slug}/rsvp`           | Cancel and delete an existing RSVP record, triggering FIFO waitlist promotion for eligible `MAYBE` attendees only if the deleted RSVP previously had status `GOING`. See the [Social Coworking Sessions architecture guide](./architecture/social-coworking-sessions.md) for details.                                |
| `GET /api/social/sessions/{slug}/rsvp?download=ics` | Export an RFC 5545 iCalendar (`.ics`) file for a coworking session. Requires `?download=ics`. See the [Social Coworking Sessions architecture guide](./architecture/social-coworking-sessions.md) for details.                                                                                                       |

For detailed request and response contracts, concurrency guarantees, waitlist mechanics, and calendar generation specifications, see the [Social Coworking Sessions architecture guide](./architecture/social-coworking-sessions.md).

---

# Analytics & Administration

| Endpoint                                    | Description                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/analytics`                        | Retrieve analytics data.                                                           |
| `GET /api/admin/analytics`                  | Retrieve administrative analytics.                                                 |
| `GET /api/admin/performance`                | Retrieve system performance metrics.                                               |
| `GET /api/admin/system`                     | Retrieve system status.                                                            |
| `GET /api/admin/system/partitions`          | Retrieve partition information.                                                    |
| `GET /api/admin/system/partitions/export`   | Export partition data.                                                             |
| `POST /api/admin/system/partitions`         | Run CRON_SECRET-protected weekly partition provisioning and retention maintenance. |
| `POST /api/admin/system/partitions/archive` | Archive eligible partitions through authenticated administration.                  |
| `POST /api/admin/system/partitions/delete`  | Permanently delete eligible partitions through authenticated administration.       |
| `GET /api/admin/system/partitions/audit`    | Retrieve partition administration audit records with filters and pagination.       |

---

# Maps & Location

| Endpoint                         | Description                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/location`              | Retrieve the user's location information.                                                                                                                                        |
| `GET /api/map/heatmap`           | Retrieve the workspace heatmap.                                                                                                                                                  |
| `POST /api/map/heatmap/seed`     | Seed heatmap data.                                                                                                                                                               |
| `GET /api/map/noise-heatmap`     | Retrieve the noise heatmap.                                                                                                                                                      |
| `GET /api/map/forecast-heatmap`  | Retrieve forecast heatmap data.                                                                                                                                                  |
| `POST /api/routing/meet-halfway` | Compute optimal team meeting centroid, evaluate candidate venues, and rank recommendations. See the [Meet Halfway Routing API guide](./api/MEET_HALFWAY_ROUTING.md) for details. |

---

# Other APIs

| Endpoint                         | Description                                                              |
| -------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/chat`                 | AI chat endpoint.                                                        |
| `POST /api/upload`               | Upload files.                                                            |
| `POST /api/translate`            | Translate content.                                                       |
| `POST /api/menu-translate`       | Translate venue menus.                                                   |
| `GET /api/newsletter`            | Newsletter subscription endpoint.                                        |
| `GET /api/memory`                | Memory service endpoint.                                                 |
| `POST /api/memory/extract`       | Extract structured memory.                                               |
| `GET /api/sync`                  | Synchronise application data.                                            |
| `GET /api/jobs/{jobId}`          | Retrieve job status.                                                     |
| `POST /api/push/subscribe`       | Subscribe to push notifications.                                         |
| `POST /api/push/unsubscribe`     | Unsubscribe from push notifications.                                     |
| `GET /api/push/vapid-public-key` | Retrieve the VAPID public key.                                           |
| `POST /api/webhook`              | Webhook endpoint.                                                        |
| `POST /api/webhooks/test`        | Test webhook endpoint.                                                   |
| `POST /api/webhooks/worker`      | Worker webhook endpoint.                                                 |
| `POST /api/telemetry/noise`      | Ingest IoT hardware acoustic sensor telemetry with differential privacy. |
| `POST /api/partykit/auth`        | Authenticate PartyKit connections.                                       |
| `GET /api/availability/delta`    | Retrieve availability updates.                                           |
| `POST /api/cron/reminders`       | Scheduled reminder task.                                                 |
| `GET /api/ar/anchors`            | Retrieve AR anchors.                                                     |
| `GET /api/ar/anchors/{id}`       | Retrieve a specific AR anchor.                                           |

---

---

# Rate Limiting & Quotas (#5879)

WorkSphere enforces multi-tier rate limiting across all incoming REST API routes to prevent denial-of-service, brute force attacks, scraping, and downstream database exhaustion.

Rate limits are evaluated at the Next.js edge/middleware layer (`src/lib/middleware/handlers/rateLimitHandler.ts`) using high-throughput in-memory sliding window counters and distributed Redis sorted sets (`ZADD`/`ZREMRANGEBYSCORE`).

---

### Rate Limiting Tiers & Endpoint Quotas

Limits vary depending on endpoint sensitivity, resource consumption, and client authentication status:

| Tier / Category                | Scope / Path Patterns                                                                        | Target Identifier                            | Quota (Limit / Window)                                                     | Description                                                                            |
| :----------------------------- | :------------------------------------------------------------------------------------------- | :------------------------------------------- | :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| **Authentication**             | `/api/auth/*`<br>`/api/partykit/auth`<br>`/api/user/verify-student`                          | Client IP (`X-Real-IP` / `CF-Connecting-IP`) | **5 requests / 1 minute**                                                  | High-security brute-force protection on password reset, OTP, WebAuthn, and SSO.        |
| **Search & Discovery**         | `/api/venues/*`<br>`/api/map/*`<br>`/api/search/*`<br>`/api/location`                        | User ID (if authenticated) or Client IP      | **60 requests / 1 minute**                                                 | Spatial geo-queries, full-text venue searches, and heatmap tile queries.               |
| **Bookings & Payments**        | `/api/bookings/*`<br>`/api/reservations/*`<br>`/api/receipts/*`                              | Clerk User ID (`userId`)                     | **60 requests / 15 minutes** (Auth)<br>**10 requests / 15 minutes** (Anon) | Transactional reservation creation and seat allocation workflows.                      |
| **Telemetry & Sensor Streams** | `/api/telemetry/*`<br>`/api/venues/{id}/noise-metrics`<br>`/api/venues/{id}/wifi-prediction` | Venue/Client Device Key or Client IP         | **120 requests / 1 minute**                                                | Acoustic sensor telemetry, live Wi-Fi latency updates, and crowd density samples.      |
| **Admin & Performance**        | `/api/admin/*`                                                                               | Clerk Admin User ID                          | **120 requests / 1 minute**                                                | Partition management, administrative analytics, and audit logging.                     |
| **Webhooks & Cron (Exempt)**   | `/api/webhook/*`<br>`/api/cron/*`<br>`/api/webhooks/worker`                                  | Cryptographic signature                      | **1,000 req/min** or **Exempt**                                            | Verified incoming webhooks and automated Vercel Cron jobs bypass public rate limiters. |

#### Anonymous vs Authenticated User Quotas

- **Anonymous Users (`anonymous`)**:
  - Identified by client IP (`X-Real-IP`, `CF-Connecting-IP`, or direct connection IP).
  - Subject to strict burst limits: **10 requests per 15 minutes** on general API routes, and **5 requests per minute** on authentication endpoints.
- **Authenticated Users (`authenticated`)**:
  - Identified by verified Clerk `userId` from session claims.
  - Granted higher limits: **60 requests per 15 minutes** on general/booking operations, and **60 requests per minute** on search.

---

### Standard Rate Limit Response Headers

Every rate-limited API response includes standard `X-RateLimit-*` diagnostic headers:

| Header Name                 | Type      | Example      | Description                                                                                      |
| :-------------------------- | :-------- | :----------- | :----------------------------------------------------------------------------------------------- |
| **`X-RateLimit-Limit`**     | `integer` | `60`         | The maximum number of requests allowed within the current window.                                |
| **`X-RateLimit-Remaining`** | `integer` | `14`         | The number of remaining requests allowed before reaching the limit.                              |
| **`X-RateLimit-Reset`**     | `integer` | `1728000060` | Unix timestamp (in seconds or milliseconds) when the rate limit window resets.                   |
| **`Retry-After`**           | `integer` | `45`         | **Present on HTTP 429**: The number of seconds the client MUST wait before making a new request. |

---

## Authentication & Security APIs

### GET `/api/auth/csrf-token`

Retrieves a Cryptographically Secure Pseudo-Random (CSPRNG) anti-CSRF token required for state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`).

#### Request Header Requirements

| Header   | Type     | Required | Description                     |
| -------- | -------- | -------- | ------------------------------- |
| `Accept` | `string` | No       | Recommended: `application/json` |

#### Response Schema (200 OK)

````json
{
  "csrfToken": "e8f7a1b9c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7",
  "expiresAt": "2026-11-08T10:23:00.000Z"
}

### Sliding Window Counter Mechanics

WorkSphere implements an atomic **Sliding Window Log / Counter** algorithm (`src/lib/rateLimit/limiters/slidingWindowLimiter.ts`):

1. **Window Calculation**:
   - For an interval $W$ (e.g., $60\text{ seconds}$) and limit $L$ (e.g., $60\text{ requests}$), the current time is $T_{\text{now}}$.
   - The sliding window boundary begins at $T_{\text{start}} = T_{\text{now}} - W$.
2. **Sub-bucket Timestamp Pruning**:
   - In Redis, requests are stored in a Sorted Set (`ZSET`) where the score is the microsecond timestamp.
   - On every request, expired entries older than $T_{\text{start}}$ are evicted:
     ```redis
     ZREMRANGEBYSCORE worksphere:ratelimit:search:192.168.1.1 0 (now - 60000)
     ```
3. **Capacity Check & Atomic Increment**:
   - The current count is calculated via `ZCARD`.
   - If $\text{count} < L$, the new request timestamp is added via `ZADD` and the request is permitted.
   - If $\text{count} \ge L$, the request is rejected with `HTTP 429 Too Many Requests`. The `Retry-After` duration is calculated from the oldest active timestamp:
     $$\text{Retry-After} = \left\lceil \frac{(T_{\text{oldest}} + W) - T_{\text{now}}}{1000} \right\rceil$$

---

### HTTP 429 Response Payload

When a client exceeds its designated quota, the server immediately short-circuits the pipeline and returns `HTTP 429`:

#### Example 429 Response

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json; charset=utf-8
Retry-After: 45
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1728000045

{
  "error": "Too many requests. Please slow down and try again.",
  "retryAfter": 45
}
````

---

### Client Implementation Example (Respecting `Retry-After` with Exponential Backoff)

Clients consuming WorkSphere APIs should intercept HTTP 429 responses, inspect the `Retry-After` header, and implement exponential backoff with jitter:

```typescript
/**
 * Resilient API client wrapper with automatic Retry-After and exponential backoff handling.
 */
export async function fetchWithRateLimitRetry<T>(
  url: string,
  options: RequestInit = {},
  maxRetries: number = 3,
): Promise<T> {
  let attempt = 0;

  while (attempt <= maxRetries) {
    const response = await fetch(url, options);

    // If request succeeded, return parsed JSON
    if (response.ok) {
      return (await response.json()) as T;
    }

    // Handle Rate Limiting (HTTP 429)
    if (response.status === 429) {
      attempt++;
      if (attempt > maxRetries) {
        throw new Error(
          `Rate limit exceeded: maximum retries (${maxRetries}) reached.`,
        );
      }

      // 1. Read Retry-After header (seconds)
      const retryAfterHeader = response.headers.get("Retry-After");
      let waitSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;

      // 2. If header is missing or unparseable, calculate exponential backoff with jitter
      if (isNaN(waitSeconds) || waitSeconds <= 0) {
        const baseDelayMs = Math.min(30000, 1000 * Math.pow(2, attempt));
        const jitterMs = Math.random() * 500;
        const totalDelayMs = baseDelayMs + jitterMs;
        console.warn(
          `[HTTP 429] Rate limited. Backing off for ${Math.round(totalDelayMs)}ms (Attempt ${attempt}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, totalDelayMs));
        continue;
      }

      // Add 250ms buffer to respect server reset boundary
      const waitMs = waitSeconds * 1000 + 250;
      console.warn(
        `[HTTP 429] Rate limited. Waiting ${waitSeconds}s as specified by Retry-After header...`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    // For other error status codes (400, 401, 500), throw immediately
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error || `HTTP ${response.status}: Request failed`,
    );
  }

  throw new Error("Unexpected request failure");
}
```

---

# Notes

- API routes are implemented under `src/app/api`.
- Dynamic route segments are represented using `{parameter}` placeholders.
- Authentication requirements and request validation are defined within each endpoint's implementation.
- This document serves as a route reference and should be kept in sync with the project structure as new endpoints are added.
