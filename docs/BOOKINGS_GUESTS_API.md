# Booking Guests API — OpenAPI 3.0 Reference

> **Base path:** `/api/bookings/{bookingId}/guests`  
> **Authentication:** Clerk session token (Cookie `__session` or `Authorization: Bearer <token>`)  
> **Source:** `src/app/api/bookings/[bookingId]/guests/route.ts`

---

## Endpoints

### `GET /api/bookings/{bookingId}/guests`

Retrieve the guest list for a confirmed booking.

**Path parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bookingId` | string (UUID) | Booking identifier |

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | `"PENDING" \| "ACCEPTED" \| "DECLINED"` | (all) | Filter by RSVP status |

**Responses**

`200 OK`
```json
{
  "guests": [
    {
      "id": "cuid",
      "bookingId": "string",
      "email": "user@example.com",
      "name": "Jane Doe",
      "status": "ACCEPTED",
      "invitedAt": "2026-09-26T12:00:00Z",
      "respondedAt": "2026-09-26T13:00:00Z"
    }
  ]
}
```

`400 Bad Request` — invalid `status` query value

`401 Unauthorized` — missing or invalid session

`403 Forbidden` — caller does not own the booking, or booking is not CONFIRMED

`404 Not Found` — booking does not exist

`500 Internal Server Error`

---

### `POST /api/bookings/{bookingId}/guests`

Add guests to a confirmed booking and send invitation emails.

**Request body** (`application/json`)

```json
{
  "guests": [
    { "email": "jane@example.com", "name": "Jane Doe" },
    { "email": "john@example.com" }
  ]
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `guests` | array | Required. 1–20 items. |
| `guests[].email` | string | Required. Valid email format. |
| `guests[].name` | string | Optional. Max 100 chars. |

**Responses**

`201 Created`
```json
{
  "guests": [
    { "id": "cuid", "email": "jane@example.com", "name": "Jane Doe", "status": "PENDING" }
  ],
  "invitationsSent": 2
}
```

`400 Bad Request` — validation error (e.g. invalid email, >20 guests)

`401 Unauthorized`

`403 Forbidden` — booking not owned by caller or not CONFIRMED

`404 Not Found`

`429 Too Many Requests`

---

### `DELETE /api/bookings/{bookingId}/guests`

Cancel/rescind one or more guest invitations.

**Request body** (`application/json`)

```json
{
  "guestId": "cuid",
  "email": "jane@example.com"
}
```

At least one of `guestId` or `email` is required.

**Responses**

`200 OK`
```json
{ "cancelled": true }
```

`400 Bad Request` — neither `guestId` nor `email` provided

`401 Unauthorized`

`403 Forbidden`

`404 Not Found` — guest invitation not found

---

### `POST /api/bookings/{bookingId}/guests/pdf`

Generate a PDF guest list for the booking.

**Request body** — empty or `{}`

**Responses**

`200 OK` — `Content-Type: application/pdf`  
Binary PDF download.

`401 Unauthorized`

`403 Forbidden`

`404 Not Found`

---

## Guest RSVP Status Values

| Value | Description |
|-------|-------------|
| `PENDING` | Invitation sent, no response yet |
| `ACCEPTED` | Guest confirmed attendance |
| `DECLINED` | Guest declined the invitation |

---

## Error Response Schema

All error responses follow:

```json
{
  "error": "Human-readable error message"
}
```
