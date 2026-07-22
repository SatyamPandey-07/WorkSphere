# WorkSphere REST API & Real-Time Streams Reference Guide

This document provides a comprehensive reference for WorkSphere's backend REST endpoints, request/response validation schemas, authentication mechanisms, and real-time Server-Sent Events (SSE) streams.

---

# 1. Authentication Protocol

WorkSphere uses **Clerk** for user authentication and session management.

## Session Authentication (Web App Client)

The web application automatically passes a session cookie (`__client`) with API requests.

The Next.js middleware (`src/middleware.ts`) automatically:

- Intercepts incoming requests
- Authenticates the session
- Attaches the user identity context

## Custom API Client Authentication

For custom API clients testing authenticated endpoints directly:

**Header**

```http
Authorization: Bearer <CLERK_JWT_SESSION_TOKEN>
```

## Authentication Responses

If an authenticated endpoint is called without a valid session or JWT:

**HTTP Status**

```http
401 Unauthorized
```

**Response**

```json
{
  "error": "Unauthorized"
}
```

---

# 2. Venues & Ratings API

## Search Venues

Retrieve a list of suitable remote workspaces within a specific geographic bounding box.

### Endpoint

```http
GET /api/venues
```

### Authentication

Public (Session optional)

### Query Parameters

| Parameter | Type | Required | Default | Validation | Description |
|-----------|------|----------|---------|------------|-------------|
| `lat` | Float | ✅ Yes | — | -90 to 90 | Coordinate latitude |
| `lng` | Float | ✅ Yes | — | -180 to 180 | Coordinate longitude |
| `radius` | Integer | No | 5000 | 100–50000 meters | Approximate search radius |
| `category` | String | No | — | `cafe`, `coworking`, `library`, `all` | Workspace category |
| `wifi` | Boolean | No | — | `true` / `false` | Filter for high-speed Wi-Fi |
| `outlets` | Boolean | No | — | `true` / `false` | Filter for power outlets |
| `quiet` | Boolean | No | — | `true` / `false` | Filter for quiet venues |

### Success Response (200 OK)

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

### Error Response (400 Bad Request)

```json
{
  "error": "lat: Number must be greater than or equal to -90, radius: Number must be less than or equal to 50000"
}
```

---

# Add Crowdsourced Venue

Submit a new workspace venue suggested by the community.

### Endpoint

```http
POST /api/venues
```

### Authentication

Required

### Request Body

| Field | Type | Required | Validation | Description |
|------|------|----------|------------|-------------|
| `placeId` | String | ✅ Yes | Minimum 1 character | Google Place ID |
| `name` | String | ✅ Yes | 1–200 characters | Venue name |
| `latitude` | Float | ✅ Yes | -90 to 90 | Latitude |
| `longitude` | Float | ✅ Yes | -180 to 180 | Longitude |
| `category` | String | ✅ Yes | `cafe`, `coworking`, `library` | Venue category |
| `address` | String | No | Max 500 chars | Street address |
| `wifiQuality` | Integer | No | 1–5 | Wi-Fi rating |
| `hasOutlets` | Boolean | No | — | Outlet availability |
| `noiseLevel` | String | No | `quiet`, `moderate`, `loud` | Noise level |
| `rating` | Float | No | — | Community rating |

### Success Response (201 Created)

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

# Submit Venue Rating

Create or update a user's rating for a venue.

Each user may submit **only one rating per venue**.

### Endpoint

```http
POST /api/venues/{venueId}/rate
```

### Authentication

Required

### Path Parameter

| Parameter | Description |
|-----------|-------------|
| `venueId` | Internal database CUID or Google Place ID |

### Request Body

| Field | Type | Required | Validation | Description |
|------|------|----------|------------|-------------|
| `wifiQuality` | Integer | ✅ Yes | 1–5 | Wi-Fi assessment |
| `hasOutlets` | Boolean | ✅ Yes | — | Outlet availability |
| `noiseLevel` | String | ✅ Yes | `quiet`, `moderate`, `loud` | Ambient noise |
| `comment` | String | No | Max 1000 chars | Review text |
| `venue` | Object | No | — | Used when creating a venue dynamically |

The optional `venue` object may contain:

- `name`
- `lat`
- `lng`
- `category`
- `address`
- `placeId`

## Aggregate Recalculation

After each rating submission, the venue's aggregated values are recalculated automatically:

- **Wi-Fi Quality** → Rounded average of all ratings
- **Has Outlets** → `true` if more than 50% of users confirm outlets
- **Noise Level** → Most frequently submitted value

### Success Response (201 Created)

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

# Fetch User Venue Rating

Retrieve the current user's rating for a venue.

### Endpoint

```http
GET /api/venues/{venueId}/rate
```

### Authentication

Required

### Success Response (User Has Rated)

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

### Success Response (User Has Not Rated)

```json
{
  "rating": null
}
```

---

# 3. Bookings API

## Confirm Workspace Booking

Create a seat/desk reservation at a selected venue, persist it in the database ledger, generate a secure receipt PDF, and dispatch it to the customer's email.

### Endpoint

```http
POST /api/bookings/confirm
```

### Authentication

Required

### Request Body

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

### Success Response (200 OK)

```json
{
  "success": true,
  "bookingId": "cldh3b89z000008j0g4z7t9p0",
  "confirmationId": "WS-#258394"
}
```

### Side Effects

Booking confirmation automatically performs the following actions:

- Creates or updates the venue record if it does not already exist.
- Creates a booking transaction associated with the authenticated user.
- Generates an A4 PDF receipt using **pdf-lib**.
- Sends the receipt as an email attachment using **nodemailer** with Gmail SMTP.

---

## Fetch Booking History

Retrieve a chronological list of past and upcoming bookings made by the authenticated user.

### Endpoint

```http
GET /api/bookings/history
```

### Authentication

Required

### Success Response (200 OK)

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

## Export Receipt Raw Transaction Metadata (JSON)

Export and download the raw booking transaction payload directly from the receipt preview modal.

### Endpoint

```http
GET /api/receipts/{bookingId}
```

> Alternatively, this may be triggered through the Receipt Modal Client Export.

### Authentication

Required

### Export Format

| Property | Value |
|----------|-------|
| Payload | Pretty-printed JSON (`JSON.stringify(transactionPayload, null, 2)`) |
| MIME Type | `application/json` |
| Filename | `receipt-{bookingId}.json` |

Example:

```
receipt-cldh3b89z000008j0g4z7t9p0.json
```

### Success Response (200 OK)

```json
{
  "receiptId": "cldh3b89z000008j0g4z7t9p0",
  "confirmationId": "WS-#258394",
  "status": "CONFIRMED",
  "date": "2026-07-15",
  "time": "14:00 - 18:00",
  "customer": {
    "email": "user@example.com",
    "phone": "+15550199"
  },
  "venue": {
    "id": "cldh1x89z000008j0g2z1g2p4",
    "name": "Central Library Hub",
    "address": "476 5th Ave, New York, NY 10018",
    "category": "library"
  },
  "exportedAt": "2026-07-22T06:18:10.000Z"
}
```

---

# 4. Real-Time Server-Sent Events (SSE) Streams

WorkSphere supports real-time updates using **Server-Sent Events (SSE)** over HTTP.

This enables lightweight, one-way event streaming that works well on serverless platforms where WebSockets are unavailable.

---

## Listen to Live Updates

Open a persistent HTTP connection to receive live broadcasts of venue reviews, edits, and ratings.

### Endpoint

```http
GET /api/venues/updates
```

### Response Headers

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `venueId` | Filter updates for one or more venues. Multiple `venueId` parameters are allowed. |

Example:

```text
/api/venues/updates?venueId=id1&venueId=id2
```

---

## Event Types

### 1. Connection Established

Sent immediately after a successful SSE connection.

```text
data: {
  "type": "connected",
  "timestamp": 1783634400000
}
```

---

### 2. Heartbeat Event

Sent every **30 seconds** to keep the connection alive and prevent proxies or load balancers from closing idle connections.

```text
data: {
  "type": "heartbeat",
  "count": 1,
  "venueIds": [
    "cldh1x89z000008j0g2z1g2p4"
  ],
  "timestamp": 1783634430000
}
```

---

### 3. Venue Update Event

Triggered whenever a venue is rated, edited, or updated.

```text
data: {
  "type": "rating_updated",
  "venueId": "cldh1x89z000008j0g2z1g2p4",
  "data": {
    "wifiQuality": 5,
    "noiseLevel": "quiet"
  },
  "timestamp": 1783634450000
}
```

---

## Broadcast Venue Update

Broadcast an update to all connected SSE clients.

Typically invoked internally after venue updates or webhook events.

### Endpoint

```http
POST /api/venues/updates
```

### Authentication

Public

### Request Body

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

### Success Response (200 OK)

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

---

# End of API Reference
