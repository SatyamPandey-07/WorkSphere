# WorkSphere REST API & Real-Time Streams Reference Guide

This document provides a comprehensive reference for WorkSphere's backend REST endpoints, request/response validation schemas, authentication mechanisms, and real-time Server-Sent Events (SSE) streams.

---

## 1. Authentication Protocol

WorkSphere uses **Clerk** for user authentication and session management.

### Session Authentication (Web App Client)
The web application automatically passes a session cookie (`__client`) with API requests. The Next.js middleware (`src/middleware.ts`) automatically intercepts incoming requests, authenticates the session, and attaches the user identity context.

### Custom API Client Authentication
For custom API clients testing authenticated endpoints directly:
- **Header**: Add the standard `Authorization` header containing the JWT token.
- **Format**: `Authorization: Bearer <CLERK_JWT_SESSION_TOKEN>`

### Authentication Responses
If an authenticated endpoint is hit without a valid session or header, the backend returns:
- **HTTP Status**: `401 Unauthorized`
- **JSON Payload**:
  ```json
  {
    "error": "Unauthorized"
  }
  ```

---

## 2. Venues & Ratings API

### Search Venues
Retrieve a list of suitable remote workspaces within a specific geographic bounding box.

* **Endpoint**: `GET /api/venues`
* **Authentication**: Public (Optional session)
* **Query Parameters (Validated via Zod):**

| Parameter | Type | Required | Default | Validation / Constraint | Description |
|---|---|---|---|---|---|
| `lat` | Float | Yes | - | `[-90, 90]` | Coordinate latitude |
| `lng` | Float | Yes | - | `[-180, 180]` | Coordinate longitude |
| `radius` | Integer | No | `5000` | `[100, 50000]` meters | Approximate search radius range |
| `category` | String | No | - | `cafe`, `coworking`, `library`, `all` | Workspace venue category |
| `wifi` | Boolean | No | - | `true`, `false` | Filter for high-speed Wi-Fi |
| `outlets` | Boolean | No | - | `true`, `false` | Filter for power outlets availability |
| `quiet` | Boolean | No | - | `true`, `false` | Filter for quiet noise level |

* **Response Example (`200 OK`):**
  ```json
  {
    "venues": [
      {
        "id": "cldh1x89z000008j0g2z1g2p4",
        "placeId": "ChIJN1t_tDeuEmsRUsoyG83VSY4",
        "name": "Central Library Hub",
        "latitude": 40.7128,
        "longitude": -74.006,
        "category": "library",
        "address": "476 5th Ave, New York, NY 10018",
        "rating": 4.5,
        "wifiQuality": 4,
        "hasOutlets": true,
        "noiseLevel": "quiet",
        "crowdsourced": true,
        "createdAt": "2026-07-09T05:00:55.000Z",
        "updatedAt": "2026-07-10T10:00:00.000Z",
        "_count": {
          "favorites": 12,
          "ratings": 8
        }
      }
    ]
  }
  ```

* **Error Example (`400 Bad Request`):**
  ```json
  {
    "error": "lat: Number must be greater than or equal to -90, radius: Number must be less than or equal to 50000"
  }
  ```

---

### Add Crowdsourced Venue
Submit a new remote workspace venue suggested by the community.

* **Endpoint**: `POST /api/venues`
* **Authentication**: **Required**
* **Request Body (JSON - Validated via Zod):**

| Field | Type | Required | Validation / Rules | Description |
|---|---|---|---|---|
| `placeId` | String | Yes | Minimum 1 character | Globally unique identifier (Google Place ID) |
| `name` | String | Yes | `[1, 200]` characters | Name of the workspace venue |
| `latitude` | Float | Yes | `[-90, 90]` | Coordinate latitude |
| `longitude` | Float | Yes | `[-180, 180]` | Coordinate longitude |
| `category` | String | Yes | `cafe`, `coworking`, `library` | Category type |
| `address` | String | No | Maximum 500 characters | Physical street address |
| `wifiQuality` | Integer | No | `[1, 5]` stars | Average Wi-Fi speed/reliability rating |
| `hasOutlets` | Boolean | No | - | Outlets availability boolean |
| `noiseLevel` | String | No | `quiet`, `moderate`, `loud` | Ambient volume index |
| `rating` | Float | No | - | Community rating score |

* **Response Example (`201 Created`):**
  ```json
  {
    "venue": {
      "id": "cldh1x89z000008j0g2z1g2p4",
      "placeId": "ChIJN1t_tDeuEmsRUsoyG83VSY4",
      "name": "Chamber Cafe",
      "latitude": 40.7128,
      "longitude": -74.006,
      "category": "cafe",
      "address": "12 Chambers St, New York, NY 10007",
      "rating": 4.2,
      "wifiQuality": 5,
      "hasOutlets": true,
      "noiseLevel": "moderate",
      "crowdsourced": true,
      "createdAt": "2026-07-10T10:15:00.000Z",
      "updatedAt": "2026-07-10T10:15:00.000Z"
    }
  }
  ```

---

### Submit Venue Rating
Add or update the user's personal review and rating parameters for a specific venue. Each user is limited to a single rating per venue.

* **Endpoint**: `POST /api/venues/[venueId]/rate`
* **Authentication**: **Required**
* **Request Path Parameters:**
  - `venueId`: Internal database CUID identifier OR the physical Google `placeId`.
* **Request Body (JSON - Validated via Zod):**

| Field | Type | Required | Validation / Constraint | Description |
|---|---|---|---|---|
| `wifiQuality` | Integer | Yes | `[1, 5]` stars | Personal Wi-Fi speed assessment |
| `hasOutlets` | Boolean | Yes | - | Confirmed outlets availability |
| `noiseLevel` | String | Yes | `quiet`, `moderate`, `loud` | Subjective ambient noise classification |
| `comment` | String | No | Maximum 1000 characters | Optional text review |
| `venue` | Object | No | - | Metadata details used to dynamically create the venue record in the database if it doesn't exist yet (`name`, `lat`, `lng`, `category`, `address`, `placeId`). |

* **Recalculation Logic:**
  Submitting a rating triggers an automatic recalculation of the target venue's global aggregate values:
  - `wifiQuality`: Rounded average stars of all submitted reviews.
  - `hasOutlets`: Marked `true` if more than 50% of reviews confirm outlet availability.
  - `noiseLevel`: Dominant (most frequent) noise level parameter.

* **Response Example (`201 Created`):**
  ```json
  {
    "rating": {
      "id": "cldh2a89z000008j0g9z3h4k1",
      "userId": "user_2NxF9...",
      "venueId": "cldh1x89z000008j0g2z1g2p4",
      "wifiQuality": 5,
      "hasOutlets": true,
      "noiseLevel": "quiet",
      "comment": "Super fast fiber connection!",
      "createdAt": "2026-07-10T10:30:00.000Z"
    }
  }
  ```

---

### Fetch User Venue Rating
Retrieve the current user's rating for the specified venue.

* **Endpoint**: `GET /api/venues/[venueId]/rate`
* **Authentication**: **Required**
* **Response Example - User has rated (`200 OK`):**
  ```json
  {
    "rating": {
      "id": "cldh2a89z000008j0g9z3h4k1",
      "userId": "user_2NxF9...",
      "venueId": "cldh1x89z000008j0g2z1g2p4",
      "wifiQuality": 5,
      "hasOutlets": true,
      "noiseLevel": "quiet",
      "comment": "Super fast fiber connection!",
      "createdAt": "2026-07-10T10:30:00.000Z"
    }
  }
  ```
* **Response Example - User has NOT rated (`200 OK`):**
  ```json
  {
    "rating": null
  }
  ```

---

## 3. Bookings API

### Confirm Workspace Booking
Create a seat/desk reservation at a selected venue, persist it in the database ledger, generate a secure receipt PDF, and dispatch it to the customer's email.

* **Endpoint**: `POST /api/bookings/confirm`
* **Authentication**: **Required**
* **Request Body (JSON):**

```json
{
  "venue": {
    "id": "cldh1x89z000008j0g2z1g2p4",
    "name": "Central Library Hub",
    "address": "476 5th Ave, New York, NY 10018",
    "category": "library",
    "latitude": 40.7128,
    "longitude": -74.006,
    "placeId": "ChIJN1t_tDeuEmsRUsoyG83VSY4"
  },
  "date": "2026-07-15",
  "time": "14:00 - 18:00",
  "customerEmail": "user@example.com",
  "customerPhone": "+15550199"
}
```

* **Response Example (`200 OK`):**
  ```json
  {
    "success": true,
    "bookingId": "cldh3b89z000008j0g4z7t9p0",
    "confirmationId": "WS-#258394"
  }
  ```

* **Side-Effects:**
  1. Creates or updates the venue records in the database if it was not cataloged locally.
  2. Creates a unique transaction record associated with the authenticated `userId`.
  3. Generates an A4 PDF Receipt using `pdf-lib`.
  4. Transmits an email containing the PDF confirmation attachment via `nodemailer` using Gmail SMTP configurations.

---

### Fetch Booking History
Retrieve a chronological list of past and upcoming bookings made by the authenticated user.

* **Endpoint**: `GET /api/bookings/history`
* **Authentication**: **Required**
* **Response Example (`200 OK`):**
  ```json
  {
    "bookings": [
      {
        "id": "cldh3b89z000008j0g4z7t9p0",
        "userId": "user_2NxF9...",
        "venueId": "cldh1x89z000008j0g2z1g2p4",
        "date": "2026-07-15",
        "time": "14:00 - 18:00",
        "customerEmail": "user@example.com",
        "customerPhone": "+15550199",
        "status": "CONFIRMED",
        "confirmationId": "WS-#258394",
        "createdAt": "2026-07-10T11:00:00.000Z",
        "venue": {
          "name": "Central Library Hub",
          "category": "library",
          "address": "476 5th Ave, New York, NY 10018"
        }
      }
    ]
  }
  ```

---

## 4. Real-Time Server-Sent Events (SSE) Streams

WorkSphere handles real-time updates through a Server-Sent Events (SSE) stream over HTTP. This provides lightweight, one-way event streaming suitable for serverless platforms where WebSockets are unavailable.

### Listen to Live Updates
Open a persistent HTTP connection to receive live broadcasts of venue reviews, edits, and ratings.

* **Endpoint**: `GET /api/venues/updates`
* **Protocol Headers:**
  - `Content-Type`: `text/event-stream`
  - `Cache-Control`: `no-cache`
  - `Connection`: `keep-alive`
* **Request Query Parameters:**
  - `venueId`: (Multiple parameters allowed) Filter updates only for specific venues. Example: `/api/venues/updates?venueId=id1&venueId=id2`

* **Stream Event Formats:**

#### 1. Connection Established
Sent immediately upon successful connection handshake.
```text
data: {"type":"connected","timestamp":1783634400000}

```

#### 2. Keep-Alive Heartbeat
Dispatched every **30 seconds** by the server to prevent intermediate proxies, firewalls, or load balancers from closing the idle TCP connection.
```text
data: {"type":"heartbeat","count":1,"venueIds":["cldh1x89z000008j0g2z1g2p4"],"timestamp":1783634430000}

```

#### 3. Venue Update Event
Fired when a user rates, views, or updates a venue.
```text
data: {"type":"rating_updated","venueId":"cldh1x89z000008j0g2z1g2p4","data":{"wifiQuality":5,"noiseLevel":"quiet"},"timestamp":1783634450000}

```

---

### Broadcast Venue Update
Triggers a broadcast update through the SSE stream. This is typically invoked from internal webhook event queues or upon user review submissions.

* **Endpoint**: `POST /api/venues/updates`
* **Authentication**: Public
* **Request Body (JSON):**
  ```json
  {
    "type": "rating_updated",
    "venueId": "cldh1x89z000008j0g2z1g2p4",
    "data": {
      "wifiQuality": 5,
      "hasOutlets": true,
      "noiseLevel": "quiet"
    }
  }
  ```
* **Response Example (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Update broadcasted",
    "update": {
      "type": "rating_updated",
      "venueId": "cldh1x89z000008j0g2z1g2p4",
      "data": {
        "wifiQuality": 5,
        "hasOutlets": true,
        "noiseLevel": "quiet"
      },
      "timestamp": 1783634480000
    }
  }
  ```
