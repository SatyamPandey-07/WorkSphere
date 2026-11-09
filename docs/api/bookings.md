# Booking History API Documentation

Comprehensive API documentation for the `/api/bookings/history` endpoint in WorkSphere. This endpoint retrieves paginated historical booking data for authenticated users, supporting cursor-based pagination, status filtering, custom sorting, and date range filtering.

---

## Endpoint Overview

- **HTTP Method:** `GET`
- **Route:** `/api/bookings/history`
- **Authentication:** Required (Session token verified via Clerk Auth)
- **Content-Type:** `application/json`

---

## OpenAPI 3.0 Specification

```yaml
openapi: 3.0.3
info:
  title: WorkSphere Booking History API
  version: 1.0.0
  description: API for fetching historical user workspace and seat bookings with cursor pagination.
paths:
  /api/bookings/history:
    get:
      summary: Retrieve booking history
      description: Returns a cursor-paginated list of past and upcoming bookings for the authenticated user.
      operationId: getBookingHistory
      tags:
        - Bookings
      security:
        - BearerAuth: []
        - CookieAuth: []
      parameters:
        - name: limit
          in: query
          description: Number of records to return per page (alias `take`).
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: take
          in: query
          description: Alias for `limit`.
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: cursor
          in: query
          description: The ID of the last booking record from the previous page for cursor pagination.
          required: false
          schema:
            type: string
            format: uuid
        - name: status
          in: query
          description: >
            Filter bookings by status. Accepts single status or comma-separated values 
            (e.g., `CONFIRMED`, `CANCELLED`, `COMPLETED`, `PENDING`).
            Note: `COMPLETED` includes bookings explicitly marked `COMPLETED` or `CONFIRMED` with a past date.
          required: false
          schema:
            type: string
            example: "CONFIRMED,COMPLETED"
        - name: sort
          in: query
          description: Sort order for booking date and creation time (`asc` or `desc`). Aliases: `order`, `dateSort`.
          required: false
          schema:
            type: string
            enum: [asc, desc]
            default: desc
        - name: order
          in: query
          description: Alias for `sort`.
          required: false
          schema:
            type: string
            enum: [asc, desc]
        - name: dateSort
          in: query
          description: Alias for `sort`.
          required: false
          schema:
            type: string
            enum: [asc, desc]
        - name: startDate
          in: query
          description: Filter bookings on or after this date (ISO 8601 format `YYYY-MM-DD`).
          required: false
          schema:
            type: string
            format: date
            example: "2026-01-01"
        - name: endDate
          in: query
          description: Filter bookings on or before this date (ISO 8601 format `YYYY-MM-DD`).
          required: false
          schema:
            type: string
            format: date
            example: "2026-12-31"
      responses:
        '200':
          description: Successful retrieval of booking history.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BookingHistoryResponse'
        '401':
          description: Unauthorized - User is not authenticated.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '400':
          description: Bad Request - Invalid query parameters or malformed cursor.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '500':
          description: Internal Server Error - Server failure during data retrieval.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

components:
  schemas:
    VenueInfo:
      type: object
      properties:
        id:
          type: string
          example: "v_123456"
        name:
          type: string
          example: "Downtown Innovation Lab"
        category:
          type: string
          example: "Coworking Space"
        address:
          type: string
          example: "100 Tech Plaza, San Francisco, CA"
        imageUrl:
          type: string
          nullable: true
          example: "https://assets.worksphere.com/venues/v_123456.jpg"

    BookingItem:
      type: object
      required:
        - id
        - userId
        - venueId
        - seatId
        - seatNumber
        - date
        - time
        - duration
        - timeZone
        - status
        - confirmationId
      properties:
        id:
          type: string
          example: "clx90abc123456789"
        userId:
          type: string
          example: "user_2N3xY89z..."
        venueId:
          type: string
          example: "v_123456"
        seatId:
          type: string
          example: "seat_88"
        seatNumber:
          type: string
          example: "Desk 04"
        date:
          type: string
          format: date
          example: "2026-10-15"
        time:
          type: string
          example: "09:00"
        duration:
          type: integer
          description: Duration in minutes
          example: 480
        timeZone:
          type: string
          example: "America/Los_Angeles"
        status:
          type: string
          enum: [PENDING, CONFIRMED, COMPLETED, CANCELLED]
          example: "CONFIRMED"
        confirmationId:
          type: string
          example: "WS-89F1A2"
        createdAt:
          type: string
          format: date-time
          example: "2026-10-01T14:22:10.000Z"
        updatedAt:
          type: string
          format: date-time
          example: "2026-10-01T14:22:10.000Z"
        venue:
          $ref: '#/components/schemas/VenueInfo'

    BookingHistoryResponse:
      type: object
      required:
        - bookings
        - nextCursor
        - hasMore
        - total
      properties:
        bookings:
          type: array
          items:
            $ref: '#/components/schemas/BookingItem'
        nextCursor:
          type: string
          nullable: true
          description: The ID of the last item in the current page, used as `cursor` for fetching the next page. Null if no more pages exist.
          example: "clx90abc123456789"
        hasMore:
          type: boolean
          description: Indicates whether additional records are available after the current page.
          example: true
        total:
          type: integer
          description: Total number of records returned in the current batch.
          example: 20

    ErrorResponse:
      type: object
      required:
        - error
      properties:
        error:
          type: string
          example: "Unauthorized"
        message:
          type: string
          example: "Authentication required to access booking history."
        statusCode:
          type: integer
          example: 401
```

---

## Detailed Parameter Matrix

| Parameter | Type | Default | Constraints / Enum | Description & Aliases |
| :--- | :--- | :--- | :--- | :--- |
| `limit` | `number` | `20` | `1` to `100` | Page size limit. Alias: `take`. |
| `take` | `number` | `20` | `1` to `100` | Alias for `limit`. |
| `cursor` | `string` | `null` | Valid record ID | Opaque cursor ID matching the last booking ID returned in the previous response. |
| `status` | `string` | `null` | Comma-separated | Filter by booking status (`PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`). |
| `sort` | `string` | `desc` | `asc`, `desc` | Sort ordering by date and timestamp. Aliases: `order`, `dateSort`. |
| `order` | `string` | `desc` | `asc`, `desc` | Alias for `sort`. |
| `dateSort` | `string` | `desc` | `asc`, `desc` | Alias for `sort`. |
| `startDate` | `string` | `null` | `YYYY-MM-DD` | Inclusive start date boundary filter. |
| `endDate` | `string` | `null` | `YYYY-MM-DD` | Inclusive end date boundary filter. |

---

## Cursor-Based Pagination Logic

WorkSphere utilizes Prisma cursor-based pagination for fast, deterministic pagination over large historical datasets without offset performance degradation.

### Request Sequence

1. **Initial Request (Page 1):**
   ```http
   GET /api/bookings/history?limit=10&sort=desc HTTP/1.1
   Host: app.worksphere.com
   Authorization: Bearer <session-token>
   ```

2. **Server Response (Page 1):**
   ```json
   {
     "bookings": [
       { "id": "bk_100", "seatNumber": "Desk A1", "date": "2026-10-05" },
       { "id": "bk_099", "seatNumber": "Desk A2", "date": "2026-10-04" }
     ],
     "nextCursor": "bk_099",
     "hasMore": true,
     "total": 2
   }
   ```

3. **Subsequent Request (Page 2):**
   Pass `nextCursor` value as `cursor` parameter:
   ```http
   GET /api/bookings/history?limit=10&sort=desc&cursor=bk_099 HTTP/1.1
   Host: app.worksphere.com
   Authorization: Bearer <session-token>
   ```

4. **Final Page Response:**
   When no more records are available, `nextCursor` will be `null` and `hasMore` will be `false`:
   ```json
   {
     "bookings": [
       { "id": "bk_001", "seatNumber": "Desk Z9", "date": "2026-01-01" }
     ],
     "nextCursor": null,
     "hasMore": false,
     "total": 1
   }
   ```

---

## Status Filtering Semantics

The `status` query parameter supports both single status values and comma-delimited strings:

- `status=CONFIRMED`: Returns bookings with active confirmation.
- `status=COMPLETED`: Includes explicit `COMPLETED` records **and** historical `CONFIRMED` bookings whose `date` is prior to current UTC date.
- `status=CONFIRMED,COMPLETED`: Combines confirmed and completed filters.

---

## HTTP Status Codes & Error Responses

| Code | Status Title | Reason / Trigger | Example Response Body |
| :--- | :--- | :--- | :--- |
| **`200`** | `OK` | Request succeeded; items returned. | `{ "bookings": [...], "nextCursor": "...", "hasMore": true, "total": 20 }` |
| **`401`** | `Unauthorized` | Missing or invalid Clerk session token. | `{ "error": "Unauthorized" }` |
| **`400`** | `Bad Request` | Invalid parameters (e.g. invalid date format). | `{ "error": "Invalid startDate format. Expected YYYY-MM-DD." }` |
| **`500`** | `Internal Server Error` | Database error or unexpected server failure. | `{ "error": "Internal Server Error" }` |

> [!NOTE]
> If a provided `cursor` ID does not exist in the database (e.g. record was deleted), the endpoint gracefully handles code `P2025` by returning an empty `bookings` array with `nextCursor: null` and `hasMore: false` rather than failing with a 500 error.
