# Venue Flagging API Specification

## 1. Overview & Endpoint Information

This document provides a formal API reference for the Venue Flagging and Content Moderation endpoint in WorkSphere. This endpoint enables authenticated community members to report venues that violate community standards, present safety or health hazards, display fraudulent or inaccurate information, or have permanently closed.

- **Route Implementation Path:** `src/app/api/venues/[venueId]/flag/route.ts`
- **HTTP Method:** `POST`
- **Endpoint URL:** `/api/venues/[venueId]/flag`
- **Authentication:** Required (User session via Bearer JWT or authenticated NextAuth session cookie).
- **Primary Purpose:** Submits a moderation report against a specific venue, records flagging metadata, enforces submission rate limits, and triggers moderation escalation workflows when predefined thresholds are met.

> [!NOTE]
> **Implementation Scope Distinction:**
> - **Existing Implemented Behavior:** Path parameter validation (`venueId`), authentication checks, request body validation via schema, database record creation for the flag report, per-user/per-IP rate limiting, and standard HTTP error codes (`400`, `401`, `404`, `429`).
> - **Proposed / Configurable Moderation Workflow:** Automated multi-report auto-quarantine, AI toxicity analysis, and real-time webhook dispatching to community moderator channels.

---

## 2. Request Specification

### 2.1 Route Parameters

| Parameter | Type | Required | Description | Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `venueId` | `string` | Yes | Unique identifier (UUID or CUID) of the venue being flagged. | Must correspond to an existing venue record. |

### 2.2 Request Headers

| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | Conditional | `Bearer <token>` if authenticating via JWT API token. (Optional if session cookie is present). |
| `Content-Type` | `string` | Yes | Must be `application/json`. |

### 2.3 Request Body Schema

The endpoint expects a JSON payload matching the following schema:

| Field Name | Type | Required | Description & Constraints |
| :--- | :--- | :--- | :--- |
| `reason` | `string` | Yes | Category of the violation. Must match one of the allowed enum values: `'inaccurate_information'`, `'permanently_closed'`, `'safety_concern'`, `'spam_or_fraud'`, `'inappropriate_content'`, `'other'`. |
| `details` | `string` | Optional | User-provided contextual explanation. Minimum 10 characters if provided, maximum 1000 characters. |
| `evidenceUrls` | `string[]` | Optional | Array of publicly accessible image or document URLs supporting the report (e.g., photo of closure sign). Maximum 5 URLs. Each must be a valid URL. |

### 2.4 Sample Request Payload

```json
{
  "reason": "permanently_closed",
  "details": "Visited this coworking space yesterday, but the storefront is empty with a commercial lease sign in the window.",
  "evidenceUrls": [
    "https://storage.worksphere.io/evidence/report-photo-102.jpg"
  ]
}
```

---

## 3. Rate Limiting & Response Headers

To prevent abuse, coordinated brigading, or denial-of-service flagging attacks, rate limits are applied per authenticated user account and per client IP address.

### 3.1 Rate Limit Configuration
- **Limit:** 5 flag submissions per user/IP within a sliding 1-hour window (or 1 flag per venue per user per 24-hour period).
- **Rate Limit Response:** When exceeded, the endpoint responds with `HTTP 429 Too Many Requests`.

### 3.2 Response Headers
Standard rate-limiting headers are included on all responses:

| Header | Description |
| :--- | :--- |
| `X-RateLimit-Limit` | Maximum number of requests allowed within the current window (e.g., `5`). |
| `X-RateLimit-Remaining` | Remaining report requests available in the active window. |
| `X-RateLimit-Reset` | Unix timestamp (in seconds) when the current rate-limit window resets. |
| `Retry-After` | Number of seconds to wait before attempting another request (sent on `429`). |

---

## 4. Automated Moderation Escalation Rules & Thresholds

When a flag report is persisted, the moderation engine evaluates aggregate venue report counts to determine whether escalation is required:

1. **Threshold Assessment:**
   - **Low Volume (1–2 Reports):** Report is logged in the moderation queue for routine asynchronous review. Venue listing remains fully visible (`status: "active"`).
   - **Escalation Threshold ($\ge 3$ Distinct Reports within 48 Hours):** Triggers an urgent moderation ticket. Notification is dispatched to the admin audit queue.
   - **Immediate Safety Escalation:** Any single report submitted under `reason: "safety_concern"` with severity flags immediately triggers high-priority review.
   - **Proposed Auto-Quarantine ($\ge 5$ Distinct Reports):** In proposed automated moderation policies, the venue status shifts to `under_review`, temporarily suppressing it from public search and discovery until human moderation completes.

2. **Deduplication:** Multiple reports from the same user account against the same venue within a 30-day window are collapsed and do not increment the escalation counter.

---

## 5. Response Codes & Error Handling

### 5.1 Success Response (`201 Created` / `200 OK`)

Returned when the flag report is successfully validated and recorded.

#### Response Payload
```json
{
  "success": true,
  "data": {
    "flagId": "flag_ck912xkd0001az37q8w9lmnb",
    "venueId": "venue_98234-abcd-ef01",
    "status": "pending_review",
    "createdAt": "2026-11-25T16:49:00.000Z"
  },
  "message": "Venue report submitted successfully and queued for review."
}
```

---

### 5.2 Error Responses

#### 400 Bad Request
Occurs when the request body violates validation constraints (e.g., invalid reason enum, missing required fields, or malformed JSON).

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload.",
    "details": [
      {
        "field": "reason",
        "issue": "Invalid enum value. Expected 'inaccurate_information' | 'permanently_closed' | 'safety_concern' | 'spam_or_fraud' | 'inappropriate_content' | 'other'."
      }
    ]
  }
}
```

#### 401 Unauthorized
Occurs when no valid user session or Authorization Bearer token is provided.

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required to flag a venue."
  }
}
```

#### 404 Not Found
Occurs when the specified `venueId` does not correspond to an existing venue in the database.

```json
{
  "success": false,
  "error": {
    "code": "VENUE_NOT_FOUND",
    "message": "The requested venue does not exist."
  }
}
```

#### 429 Too Many Requests
Occurs when the client exceeds the flag rate limit within the designated sliding window.

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "You have submitted too many reports recently. Please wait before submitting another report.",
    "retryAfterSeconds": 1800
  }
}
```

---

## 6. Implementation Status Matrix

| Capability | Implemented Status | Description |
| :--- | :--- | :--- |
| `POST /api/venues/[venueId]/flag` route handler | **Implemented** | Core route receiving, parsing, and authenticating requests. |
| Payload schema validation | **Implemented** | Strict typing on enum reasons, detail string length, and evidence URL arrays. |
| Duplicate report detection per user | **Implemented** | Restricts redundant simultaneous reports on identical venues. |
| HTTP 400 / 401 / 404 / 429 error responses | **Implemented** | Standardized error contracts and HTTP status codes. |
| Automated quarantine on threshold | **Proposed** | Auto-suppression of venues upon reaching report limits pending moderation review. |
| Computer Vision proof verification | **Proposed** | Automated OCR and validation on uploaded storefront photos in `evidenceUrls`. |
