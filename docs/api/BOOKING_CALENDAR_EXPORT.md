# Booking Calendar Export API (`GET /api/bookings/:bookingId/calendar.ics`)

The Booking Calendar Export API provides endpoints to download standard RFC 5545 iCalendar (`.ics`) files or generate one-click calendar composition links for confirmed, pending, or cancelled bookings in WorkSphere.

---

## 1. Endpoint Overview

- **HTTP Method:** `GET`
- **Route:** `/api/bookings/:bookingId/calendar.ics`
- **Authentication:** Required (Clerk session token or authenticated browser session)
- **Authorization:** Booking ownership verified (caller can only export their own bookings)
- **Rendering Mode:** Server-side dynamic (`export const dynamic = "force-dynamic"`)
- **Supported Outputs:**
  - Standard RFC 5545 `.ics` file attachment (`Content-Type: text/calendar; charset=utf-8`)
  - One-click calendar web links JSON payload (`?format=links`)

### Key Source Files

- **Route Handler:** `src/app/api/bookings/[bookingId]/calendar.ics/route.ts`
- **Calendar & Deep-Link Generator:** `src/lib/calendar/icsGenerator.ts`
- **RFC 5545 Utilities:** `src/lib/calendar/ics.ts`
- **Date & Timezone Adapter:** `src/lib/booking/dateTimeAdapter.ts`
- **Middleware:** `src/middleware.ts`
- **UI Consumer:** `src/components/bookings/AddToCalendarButton.tsx`

---

## 2. Request Parameters

### Path Parameters

| Parameter   | Type     | Required | Description                                                                                                                                                |
| :---------- | :------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bookingId` | `string` | Yes      | Identifier of the booking. Matches either the internal database ID (`booking.id`) or the user-facing booking confirmation code (`booking.confirmationId`). |

### Query Parameters

| Parameter | Type     | Required | Default     | Description                                                                                                                                                                                                                                                      |
| :-------- | :------- | :------- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`  | `string` | No       | `undefined` | Response format selector. When set to `links`, the endpoint returns a JSON payload containing web calendar links and the ICS download path. If omitted or set to any other value, the endpoint returns an `.ics` file download.                                  |
| `alarm`   | `string` | No       | `30`        | Comma-separated list of reminder offsets in minutes prior to event start (e.g. `?alarm=15,60`). Acceptable values are integers from `0` to `10080` (7 days). Passing `0` disables all display alarms. Omitted parameter defaults to a single 30-minute reminder. |

---

## 3. Authentication, Authorization, and Middleware Behavior

### Clerk Session Authentication

The endpoint requires an active Clerk user identity:

1. **Route-Level Verification:** The handler calls `await auth()` from `@clerk/nextjs/server`. If `userId` is missing or null, the request terminates immediately with HTTP `401 Unauthorized`:
   ```json
   {
     "error": "Unauthorized"
   }
   ```
2. **User Profile Verification:** Upon verifying `userId`, the route invokes `ensureUserExists(userId)` from `@lib/auth` to verify the user record is provisioned in the database.
3. **Global Middleware Protection:** In `src/middleware.ts`, `/api/bookings/(.*)` is not listed in `isPublicRoute`. Unauthenticated browser requests without valid session cookies are intercepted by Clerk middleware and redirected (HTTP `307 Temporary Redirect`) to `/sign-in`.

### Ownership Scoping (Tenant Isolation)

The database lookup enforces caller ownership:

```typescript
const booking = await prisma.booking.findFirst({
  where: {
    OR: [{ id: bookingId }, { confirmationId: bookingId }],
    userId,
  },
  include: { venue: true },
});
```

- If no booking matches both the provided ID/confirmation code **and** the caller's `userId`, the endpoint returns HTTP `404 Not Found`:
  ```json
  {
    "error": "Booking not found"
  }
  ```
- Returning `404` instead of `403` prevents user enumeration and protects booking existence privacy across accounts.

---

## 4. Date, Time, and Timezone Resolution

### Wall-Clock to UTC Instant Conversion

Bookings store wall-clock components and an optional IANA timezone:

- `booking.date`: Calendar date in `YYYY-MM-DD` format (e.g., `"2026-07-20"`).
- `booking.time`: Local start time in `HH:mm` or `h:mm A` format (e.g., `"09:00"`).
- `booking.timeZone`: IANA timezone string (e.g., `"Asia/Karachi"`, `"America/New_York"`), defaulting to `"UTC"` if omitted or null.
- `booking.duration`: Raw duration in minutes.

The route normalizes the booking instant through `buildBookingCalendarEvent()`:

```typescript
const timeZone = booking.timeZone || "UTC";
const start = parseBookingDateTime(booking.date, booking.time, timeZone);
```

`parseBookingDateTime` uses iterative offset convergence (`timeZoneOffsetMs`) to resolve daylight saving time (DST) shifts and determine the exact UTC start instant.

### Duration Normalization Rules

Invalid booking durations do **not** independently cause an error or produce HTTP 422:

- Missing (`null`, `undefined`), zero, negative, or non-finite (`NaN`, `Infinity`) duration values fall back to the default duration of 60 minutes (`DEFAULT_DURATION_MINUTES = 60`).
- Valid positive durations are floored to whole integer minutes (`Math.floor(rawDuration)`) and capped at a maximum of 1,440 minutes / 24 hours (`MAX_DURATION_MINUTES = 1440`).
- Event end times are computed as `new Date(start.getTime() + minutes * 60_000)`.

### HTTP 422 Date/Time Parsing and Event Construction Errors

HTTP `422 Unprocessable Entity` occurs exclusively when booking date/time parsing or calendar event construction fails:

- Returned when `parseBookingDateTime()` cannot parse `booking.date` or `booking.time` into a valid timestamp (e.g., corrupt strings, invalid calendar dates, or malformed time expressions).
- Returned if event construction in `buildBookingCalendarEvent()` or `generateBookingIcs()` evaluates to `null`.
- Response body:
  ```json
  {
    "error": "Booking has an invalid date or time"
  }
  ```

---

## 5. Output Modes and Response Contracts

### Mode A: RFC 5545 `.ics` File Export (Default)

When `format` is omitted or not equal to `links`, the endpoint generates a standard iCalendar attachment.

#### HTTP Headers

```http
HTTP/1.1 200 OK
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="WorkSphere_Booking_WS-ABC123.ics"
Cache-Control: private, no-store
```

- **Filename Sanitization:** The filename is constructed as `WorkSphere_Booking_${safeName}.ics`, where `safeName` is `(booking.confirmationId || booking.id).replace(/[^A-Za-z0-9_-]/g, "")`.
- **Cache-Control:** Statically set to `private, no-store` to prevent intermediary caching or proxy persistence of personalized calendar schedules.

#### RFC 5545 Structure

The emitted `.ics` text strictly complies with RFC 5545:

1. **Line Endings:** Every line terminates with CRLF (`\r\n`).
2. **Line Folding:** Lines exceeding 75 octets are folded per RFC 5545 Section 3.1. Continuation lines begin with a single space (`\x20`), and UTF-8 multi-byte characters are preserved across folds without truncation.
3. **Text Escaping:** Reserved characters in `SUMMARY`, `DESCRIPTION`, and `LOCATION` are escaped using `escapeIcsText()`:
   - Backslash (`\`) becomes `\\`
   - Semicolon (`;`) becomes `\;`
   - Comma (`,`) becomes `\,`
   - Newline (`\n` or `\r\n`) becomes literal `\n`
4. **Timestamps:** Start and end times are serialized in basic UTC format (`YYYYMMDDTHHMMSSZ`), eliminating the need for complex embedded `VTIMEZONE` tables while ensuring universal synchronization across Apple, Google, and Microsoft calendars.

#### Calendar Properties

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WorkSphere//Booking Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:ckbooking123@worksphere.app
DTSTAMP:20261122T000000Z
DTSTART:20260720T040000Z
DTEND:20260720T050000Z
SUMMARY:Booking at Hub
DESCRIPTION:Booking at Hub\nAddress: 1 Main St\nBooking ID: WS-ABC123\nDuration: 60 min\nLocal time zone: Asia/Karachi
LOCATION:Hub\, 1 Main St
GEO:25.39;68.35
STATUS:CONFIRMED
TRANSP:OPAQUE
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT30M
DESCRIPTION:Reminder: Booking at Hub
END:VALARM
END:VEVENT
END:VCALENDAR
```

- **`UID`:** Formatted as `${booking.id.replace(/[^A-Za-z0-9-]/g, "")}@worksphere.app`.
- **`STATUS`:** Mapped from booking status:
  - `CANCELLED` or `CANCELLED_BY_OPERATOR` maps to `CANCELLED`
  - `PENDING` maps to `TENTATIVE`
  - Any other value (e.g. `CONFIRMED`) maps to `CONFIRMED`
- **`GEO`:** Included only when venue `latitude` and `longitude` are valid finite numbers (`|lat| <= 90`, `|lng| <= 180`).
- **`TRANSP`:** Always `OPAQUE` to block out the reservation slot on attendee calendars.

---

### Mode B: Calendar Links JSON (`format=links`)

When `format=links` is provided, the endpoint returns one-click compose URLs and the direct ICS URL.

#### HTTP Headers

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: private, no-store
```

#### JSON Response Schema

| Field            | Type     | Description                                                                                                          |
| :--------------- | :------- | :------------------------------------------------------------------------------------------------------------------- |
| `googleUrl`      | `string` | Pre-filled Google Calendar web compose link (`https://calendar.google.com/calendar/render?...`).                     |
| `outlookUrl`     | `string` | Pre-filled Outlook Personal / Live compose link (`https://outlook.live.com/calendar/0/deeplink/compose?...`).        |
| `outlookWorkUrl` | `string` | Pre-filled Outlook Work / Office 365 compose link (`https://outlook.office.com/calendar/0/deeplink/compose?...`).    |
| `icsUrl`         | `string` | Relative path to download the raw `.ics` calendar file for this booking (`/api/bookings/{booking.id}/calendar.ics`). |

> [!IMPORTANT]
> The `icsUrl` returned in the JSON payload always uses the internal database booking ID (`booking.id`), formatted as `/api/bookings/${encodeURIComponent(booking.id)}/calendar.ics`. This holds true regardless of whether the initial request queried the endpoint using a public confirmation ID (`booking.confirmationId`) or the database ID.

#### Example JSON Response

```json
{
  "googleUrl": "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Booking+at+Hub&dates=20260720T040000Z%2F20260720T050000Z&details=Booking+at+Hub%0AAddress%3A+1+Main+St%0ABooking+ID%3A+WS-ABC123%0ADuration%3A+60+min%0ALocal+time+zone%3A+Asia%2FKarachi&location=Hub%2C+1+Main+St&ctz=Asia%2FKarachi",
  "outlookUrl": "https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=Booking+at+Hub&startdt=2026-07-20T04%3A00%3A00Z&enddt=2026-07-20T05%3A00%3A00Z&body=Booking+at+Hub%0AAddress%3A+1+Main+St%0ABooking+ID%3A+WS-ABC123%0ADuration%3A+60+min%0ALocal+time+zone%3A+Asia%2FKarachi&location=Hub%2C+1+Main+St",
  "outlookWorkUrl": "https://outlook.office.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=Booking+at+Hub&startdt=2026-07-20T04%3A00%3A00Z&enddt=2026-07-20T05%3A00%3A00Z&body=Booking+at+Hub%0AAddress%3A+1+Main+St%0ABooking+ID%3A+WS-ABC123%0ADuration%3A+60+min%0ALocal+time+zone%3A+Asia%2FKarachi&location=Hub%2C+1+Main+St",
  "icsUrl": "/api/bookings/ckbooking123/calendar.ics"
}
```

---

## 6. Alarm and Reminder Configuration (`?alarm=...`)

The endpoint accepts a comma-separated query string parameter `alarm` to control event reminder offsets:

```http
GET /api/bookings/ckbooking123/calendar.ics?alarm=15,60,1440 HTTP/1.1
```

### Parsing Rules

1. Values are split by commas and converted into numbers.
2. Only integers $0 \le n \le 10080$ (`MAX_ALARM_MINUTES`) are accepted.
3. For each positive integer $n > 0$, an RFC 5545 `VALARM` block is appended with trigger `-PT{n}M`.
4. If `alarm=0` is passed, all alarms are suppressed (`VALARM` count is 0).
5. If `alarm` is omitted, the default reminder is 30 minutes before the event (`TRIGGER:-PT30M`).

### Example Alarm Configurations

| Query Parameter           | Generated Reminders                                                                    |
| :------------------------ | :------------------------------------------------------------------------------------- |
| _(omitted)_               | 1 reminder: 30 minutes prior (`TRIGGER:-PT30M`)                                        |
| `?alarm=0`                | No reminders (`VALARM` omitted)                                                        |
| `?alarm=15`               | 1 reminder: 15 minutes prior (`TRIGGER:-PT15M`)                                        |
| `?alarm=10,120`           | 2 reminders: 10 minutes prior (`TRIGGER:-PT10M`) and 2 hours prior (`TRIGGER:-PT120M`) |
| `?alarm=15,invalid,20000` | 1 reminder: 15 minutes prior (invalid and out-of-range values are ignored)             |

---

## 7. Error Responses

| Status Code                 | Error Message                                      | Cause                                                                                                                                                                                                          |
| :-------------------------- | :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized`          | `{"error": "Unauthorized"}`                        | Caller does not possess an active Clerk session or token.                                                                                                                                                      |
| `404 Not Found`             | `{"error": "Booking not found"}`                   | No booking exists with the specified ID/confirmation code belonging to the authenticated user.                                                                                                                 |
| `422 Unprocessable Entity`  | `{"error": "Booking has an invalid date or time"}` | The booking's date or time string could not be parsed into a valid start instant, or calendar event construction failed. (Note: Invalid durations do not trigger HTTP 422; durations fall back to 60 minutes). |
| `500 Internal Server Error` | `{"error": "Failed to generate calendar file"}`    | Unhandled database or calendar generator exception during processing.                                                                                                                                          |

---

## 8. Client Usage Examples

### 1. Direct ICS File Download via `cURL`

```bash
curl -X GET \
  -H "Authorization: Bearer <CLERK_SESSION_TOKEN>" \
  "https://worksphere.app/api/bookings/WS-ABC123/calendar.ics?alarm=15,60" \
  -o "booking.ics"
```

### 2. Fetching One-Click Links in Frontend Client

```typescript
async function fetchCalendarLinks(bookingId: string) {
  const response = await fetch(
    `/api/bookings/${bookingId}/calendar.ics?format=links`,
    {
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch calendar links: ${response.statusText}`);
  }

  const links = await response.json();
  return links as {
    googleUrl: string;
    outlookUrl: string;
    outlookWorkUrl: string;
    icsUrl: string;
  };
}
```

---

## 9. Automated Testing & Verification

Validation for this endpoint is maintained in Jest:

```bash
npm test -- src/__tests__/api/bookingCalendarIcs.test.ts
npm test -- src/__tests__/lib/calendar/icsGenerator.test.ts
npm test -- src/__tests__/lib/calendar/ics.test.ts
```

Key test assertions verify:

- 401 response for unauthenticated calls.
- 404 response for bookings owned by other users.
- 422 response for corrupt or unparseable date/time fields.
- Correct `.ics` MIME type, headers, and filename sanitization.
- Accurate RFC 5545 line folding and CRLF formatting.
- `?format=links` generation for Google Calendar and Outlook Web.
- Default (30m), custom (`?alarm=10,120`), and disabled (`?alarm=0`) alarms.
