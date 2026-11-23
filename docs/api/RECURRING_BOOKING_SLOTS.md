# Recurring Booking Slot Validation

This guide documents the RRULE-like date expansion and seat availability validation implemented by `src/features/seats/recurringBookingService.ts`, and the corresponding `POST /api/seats/recurring-availability` route.

> **Important implementation scope:** this is a small weekly date selector, not a general RFC 5545 recurrence engine. The date-validation route currently uses a default occupancy store that reports no occupied dates and no candidate desks. The separately implemented booking-creation route is not wired to this validator; it accepts a different recurrence input. See [Architecture](#a-overview-and-architecture) and [Request schema](#c-request-schema-and-validation).

## A. Overview and Architecture

Recurring desk bookings request a set of dates for the same seat. Checking each requested date before booking can identify unavailable dates and, when the occupancy store provides candidate desks, suggest desks with availability across the requested dates.

The relevant code is split across these layers:

1. [`recurringBookingService.ts`](../../src/features/seats/recurringBookingService.ts) expands requested dates and partitions them into available dates and conflicts by calling a `SeatOccupancyStore`.
2. [`route.ts`](../../src/app/api/seats/recurring-availability/route.ts) exposes that validation through `POST /api/seats/recurring-availability`.
3. [`recurringBookingService.test.ts`](../../src/features/seats/__tests__/recurringBookingService.test.ts) tests expansion, conflict partitioning, alternative ordering, and the route handler using an injected store.

The exported service functions are:

```ts
expandRecurringDates(
  rrulePattern: string,
  range: DateRangeInput
): string[]

validateRecurringBookingSlots(
  seatId: string,
  rrulePattern: string,
  dateRange: DateRangeInput,
  store: SeatOccupancyStore
): Promise<RecurringValidationResult>
```

The first function only expands dates. The second calls `getOccupiedDates(seatId, requestedDates)`, classifies every expanded date, and conditionally asks `listCandidateDesks` for alternatives.

This validation flow is distinct from booking creation. [`POST /api/reservations/recurring-book`](../../src/app/api/reservations/recurring-book/route.ts) calls `validateRecurringReservation`, uses `frequency` and generated `dates`, then checks time overlaps while writing bookings. It does not call `validateRecurringBookingSlots` or accept this route's RRULE payload. A successful availability response is therefore not a booking confirmation or a lock on future availability.

**Current wiring limitation:** the default store in `src/app/api/seats/recurring-availability/route.ts` returns an empty occupancy map and an empty candidate list. As written, the exported `POST` route consequently reports every expanded date as available and cannot suggest alternatives. The route handler factory accepts a store, as the unit test demonstrates, but this source does not wire a real occupancy provider into the exported route.

## B. Recurrence Rule Schema

The implementation accepts a string and extracts semicolon-separated `KEY=VALUE` pairs after trimming and uppercasing it. Its example pattern is:

```text
FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1
```

For this implementation:

| Part       | Meaning in this service                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FREQ`     | Parsed as an ordinary key but **not read or validated**. The output is weekly-based regardless of this value.                                                                                                                                   |
| `BYDAY`    | Optional comma-separated set of exact weekday codes. Recognized values are `SU`, `MO`, `TU`, `WE`, `TH`, `FR`, and `SA`.                                                                                                                        |
| `INTERVAL` | Optional positive numeric value, floored to an integer, used as the week-index modulus. Missing, nonnumeric, zero, negative, or non-finite values fall back to `1`. A positive value below `1` floors to `0`, which produces no matching weeks. |

When `BYDAY` is omitted, the implementation selects Monday through Friday. Unrecognized BYDAY tokens are ignored; if none are recognized, no dates match. Weekday tokens with RFC ordinal prefixes, such as `1MO`, are not recognized.

### Supported subset versus RFC 5545

RFC 5545 defines a much broader recurrence grammar. This code does not validate `FREQ`, implement the recurrence grammar, or interpret other rule components such as `COUNT`, `UNTIL`, `BYMONTH`, `BYMONTHDAY`, `WKST`, or timezone properties. Unknown components are simply unused. `FREQ=DAILY` does **not** make this implementation generate daily dates; with `BYDAY=MO`, it still selects Mondays on the implementation's interval weeks. Do not send unsupported components expecting RFC-compliant behavior.

This service supports only weekly-index selection combined with the weekday set above:

**Weekly Monday/Wednesday/Friday** (`INTERVAL=1`):

```text
FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1
```

**Bi-weekly Monday/Wednesday/Friday** (`INTERVAL=2`):

```text
FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2
```

Bi-weekly means every second week according to the interval calculation described below; it does not mean “every two weeks from an independently stored DTSTART.”

Other supported weekday selections include weekends (`BYDAY=SA,SU`), a single weekday (`BYDAY=TU`), or the default weekdays when `BYDAY` is omitted. The value in `FREQ` does not add other frequency modes.

## C. Request Schema and Validation

The route is an HTTP endpoint: `POST /api/seats/recurring-availability`. Its JSON body is:

```json
{
  "seatId": "desk-10",
  "rrulePattern": "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1",
  "dateRange": {
    "startDate": "2026-11-02",
    "endDate": "2026-11-15"
  }
}
```

The route passes the following values to the service:

| Field                 | Type             | Required by route | Behavior                                                          |
| --------------------- | ---------------- | ----------------- | ----------------------------------------------------------------- |
| `seatId`              | non-empty string | Yes               | Trimmed and passed to the store as the seat identifier.           |
| `rrulePattern`        | non-empty string | Yes               | Trimmed by the route; parsed by the service as described above.   |
| `dateRange.startDate` | non-empty string | Yes               | Trimmed; must be a real calendar date in exact `YYYY-MM-DD` form. |
| `dateRange.endDate`   | non-empty string | Yes               | Trimmed; must be a real calendar date in exact `YYYY-MM-DD` form. |

There are no other request fields consumed by this route. Unknown fields are ignored. The service-level `DateRangeInput` type contains `startDate` and `endDate`, both strings. The service does not accept a date-time, timezone, time-of-day, duration, or desk adjacency option.

An empty or missing required field returns HTTP `400`:

```json
{
  "error": "seatId, rrulePattern, and dateRange (startDate, endDate) are required"
}
```

Invalid date format or calendar dates throw from the date parser and the route converts the error to HTTP `400` with `{ "error": "<message>" }`. The service does not reject unknown or malformed recurrence components as a validation error. For example, an unrecognized `BYDAY` can instead produce an empty `requestedDates` array with HTTP `200`.

The lower-level `validateRecurringBookingSlots` API receives positional arguments `(seatId, rrulePattern, dateRange, store)`; it is not called with the HTTP JSON object.

## D. Date Expansion Mechanics

`expandRecurringDates` parses both dates as UTC calendar days, then walks from the start day through the end day in fixed `86,400,000` millisecond increments. Both range endpoints are inclusive.

For each day, it computes:

1. The Sunday UTC midnight at the beginning of the week containing `startDate`.
2. `weekIndex = floor((currentDay - startWeekStart) / 7 days)`.
3. Whether `weekIndex % intervalWeeks` is zero.
4. Whether the current UTC weekday is in the allowed weekday set.

A date is included only when both the week and weekday checks match. The start date's containing week has index `0`, so that whole calendar week qualifies for interval `1` or `2`; for interval `2`, subsequent qualifying weeks have indices `2`, `4`, and so on. The range start still clips output: dates before `startDate` are not emitted.

Representative pseudocode:

```text
start = parse YYYY-MM-DD at UTC midnight
end = parse YYYY-MM-DD at UTC midnight
if end < start: return []

weekZero = start - start.UTCWeekday days  // Sunday-based UTC week
for day from start through end, inclusive, stepping by one UTC day:
    weekIndex = floor((day - weekZero) / 7 days)
    if weekIndex % intervalWeeks == 0 and day.UTCWeekday is allowed:
        append day formatted as YYYY-MM-DD
```

The parser trims the input date, requires four-digit year/two-digit month/two-digit day, and round-trips the UTC date components to reject impossible dates. Because it constructs the value with `Date.UTC(year, ...)`, years `0000` through `0099` are also rejected by the round-trip check (JavaScript treats those numeric years specially). Invalid format throws `Invalid date format (expected YYYY-MM-DD): ...`; an impossible calendar day throws `Invalid calendar date: ...`. If both dates are valid but `endDate` is before `startDate`, the function returns `[]` rather than throwing.

All calculation and formatting use UTC methods and fixed-day milliseconds, so daylight-saving transitions do not affect the sequence. The function is date-only; it does not convert an occurrence to a local time or provide timezone guarantees for a booking's start time. The separate booking-creation flow has its own timezone/time validation.

No separate DTSTART exists in the recurrence string. `dateRange.startDate` serves both as the lower output boundary and as the anchor for the interval's week zero. Duplicate recognized BYDAY tokens are deduplicated by a set, and the day-walk emits each date at most once.

## E. Conflict Detection

The exported `ConflictDetail` type is:

```ts
interface ConflictDetail {
  date: string;
  reason: "BOOKED" | "HELD";
  referenceId?: string;
}
```

- `date` is an expanded occurrence in `YYYY-MM-DD`.
- `reason` is copied from the occupancy-map entry and is `BOOKED` or `HELD` in the declared interface.
- `referenceId` is optional and copied from that entry when provided.

The service asks the store for occupied dates once, then checks every `requestedDate` in order. A matching map entry becomes a conflict; no matching entry makes the date available. It accumulates **all** dates; it does not stop at the first conflict. A recurring series can therefore contain both `availableDates` and `conflictedDates`.

The runtime usage and service test exercise `getOccupiedDates` as a promise of a `Map` keyed by date, with values containing `reason` and optional `referenceId`. The interface's current return annotation is malformed (`Promise>;`), so this observed shape should not be mistaken for a currently valid TypeScript declaration.

Example service result fragment using the occupied-date values in the unit test:

```json
{
  "availableDates": [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-09",
    "2026-11-10",
    "2026-11-12"
  ],
  "conflictedDates": [
    {
      "date": "2026-11-05",
      "reason": "BOOKED",
      "referenceId": "bkg-1"
    },
    {
      "date": "2026-11-11",
      "reason": "HELD",
      "referenceId": "hold-9"
    }
  ]
}
```

The response reflects whatever the injected store reports. This service checks occupancy by date only; it does not compare booking time overlap, duration, or timezone. The booking-creation route has separate time-overlap logic.

## F. Alternative Desk Suggestions

`AlternativeDeskSuggestion` has this shape:

```ts
interface AlternativeDeskSuggestion {
  deskId: string;
  availableForAllRequestedDates: boolean;
  freeDates: string[];
  conflictedDates: string[];
}
```

Suggestions are computed only when the requested seat has at least one conflict and `store.listCandidateDesks` exists. The service passes the original seat ID and the **entire** requested-date list to that method. It then:

- Excludes a returned candidate whose `deskId` equals the requested `seatId`.
- Classifies each candidate across **all requested dates**, not only the requested seat's conflicted dates.
- Sets `availableForAllRequestedDates` when the candidate has no occupied requested dates.
- Sorts fully available candidates first, then by descending count of `freeDates`.

The service itself does not identify neighboring desks or define “adjacent.” Any spatial/geometric filtering must happen in the `listCandidateDesks` implementation supplied by the store. It also does not deduplicate candidate IDs or apply another ranking criterion for equal free-date counts. If there are no candidates, the optional method is missing, or the requested seat has no conflicts, `alternativeDesks` is `[]`.

Illustration only: if a store returns candidate `desk-11` free on every requested date and `desk-12` free on all but one, the service places `desk-11` first. The code does not guarantee either desk is physically adjacent; that depends entirely on the store.

The current route's default store always returns an empty candidate list. The service unit test supplies candidates directly; it does not establish a production adjacency query.

## G. Response Schemas

### Successful validation response

The HTTP route returns the `RecurringValidationResult` directly with status `200`:

```ts
interface RecurringValidationResult {
  seatId: string;
  rrulePattern: string;
  requestedDates: string[];
  availableDates: string[];
  conflictedDates: ConflictDetail[];
  alternativeDesks: AlternativeDeskSuggestion[];
}
```

Example for the route's current default store (assuming the dates and recurrence are valid):

```json
{
  "seatId": "desk-10",
  "rrulePattern": "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1",
  "requestedDates": ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"],
  "availableDates": ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"],
  "conflictedDates": [],
  "alternativeDesks": []
}
```

The route trims `seatId` and `rrulePattern` before calling the service; the result echoes those trimmed values. The service echoes `rrulePattern` as passed to it.

### Conflict response

There is no distinct conflict HTTP status or error envelope. Conflicts are returned as part of the same status-`200` result, and availability may be partial:

```json
{
  "seatId": "desk-10",
  "rrulePattern": "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1",
  "requestedDates": ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"],
  "availableDates": ["2026-11-02", "2026-11-04"],
  "conflictedDates": [
    {
      "date": "2026-11-09",
      "reason": "BOOKED",
      "referenceId": "booking-123"
    },
    {
      "date": "2026-11-11",
      "reason": "HELD",
      "referenceId": "hold-456"
    }
  ],
  "alternativeDesks": []
}
```

This is a service/handler result when an occupancy store reports those conflicts; the currently exported route's default store does not produce them.

### Alternative desk suggestions

`alternativeDesks` is an array in the same response. A service-level illustration:

```json
{
  "deskId": "desk-11",
  "availableForAllRequestedDates": true,
  "freeDates": ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"],
  "conflictedDates": []
}
```

The array member is not a separate response or endpoint; it is included only when the service's conditions for alternative lookup are met.

### Error response

The handler uses HTTP `400` and `{ "error": string }` for missing required fields, malformed JSON, and thrown date parsing errors. Example:

```json
{
  "error": "Invalid calendar date: 2026-02-30"
}
```

Other recurrence-rule irregularities generally do not throw; they are interpreted by the permissive parser and may produce no dates.

## H. Complete Usage Examples

All examples below validate dates only. They do not create bookings. The HTTP examples call `/api/seats/recurring-availability`; when a conflict or candidate is shown, that behavior requires a store that returns those values. The route's current default store returns no conflicts or candidates.

### 1. Weekly recurring booking

Request:

```json
{
  "seatId": "desk-10",
  "rrulePattern": "FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1",
  "dateRange": {
    "startDate": "2026-11-02",
    "endDate": "2026-11-15"
  }
}
```

The expansion is `2026-11-02`, `2026-11-04`, `2026-11-06`, `2026-11-09`, `2026-11-11`, and `2026-11-13`. With the current default store, all six appear in `availableDates`.

### 2. Bi-weekly recurring booking

Request:

```json
{
  "seatId": "desk-10",
  "rrulePattern": "FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2",
  "dateRange": {
    "startDate": "2026-11-02",
    "endDate": "2026-11-30"
  }
}
```

The expanded dates are `2026-11-02`, `2026-11-04`, `2026-11-06`, `2026-11-16`, `2026-11-18`, `2026-11-20`, and `2026-11-30`. The week of November 9 has index 1 and is skipped; November 2's UTC Sunday-based week is week index 0.

### 3. Booking request with conflicts

With the weekly Monday/Wednesday rule above and an occupancy map that marks November 9 as `BOOKED` and November 11 as `HELD`, the service returns:

```json
{
  "seatId": "desk-10",
  "rrulePattern": "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1",
  "requestedDates": ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"],
  "availableDates": ["2026-11-02", "2026-11-04"],
  "conflictedDates": [
    {
      "date": "2026-11-09",
      "reason": "BOOKED",
      "referenceId": "booking-123"
    },
    {
      "date": "2026-11-11",
      "reason": "HELD",
      "referenceId": "hold-456"
    }
  ],
  "alternativeDesks": []
}
```

The service reports all dates and does not create only the available part of the series.

### 4. Booking request with alternative desks

If that same store also returns `desk-11`, free across all four dates, and `desk-12`, occupied on November 9, the result's `alternativeDesks` is ordered with the fully available candidate first:

```json
[
  {
    "deskId": "desk-11",
    "availableForAllRequestedDates": true,
    "freeDates": ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"],
    "conflictedDates": []
  },
  {
    "deskId": "desk-12",
    "availableForAllRequestedDates": false,
    "freeDates": ["2026-11-02", "2026-11-04", "2026-11-11"],
    "conflictedDates": ["2026-11-09"]
  }
]
```

This illustrates the service's sorting and classification. It does not imply that either desk is adjacent; the store decides which candidates to return.

### 5. Invalid date or unrecognized recurrence values

An impossible calendar date, for example `dateRange.startDate = "2026-02-30"`, returns HTTP `400`:

```json
{
  "error": "Invalid calendar date: 2026-02-30"
}
```

By contrast, an unrecognized BYDAY such as `BYDAY=XX` is ignored. With valid range dates and all required fields present, the handler returns HTTP `200` with empty `requestedDates`, `availableDates`, and conflict/suggestion arrays. Similarly, an arbitrary `FREQ` is not rejected or interpreted as a different recurrence frequency.

## I. Error Handling and Edge Cases

- **Missing required fields:** HTTP `400`, with an error string naming the required values.
- **Malformed JSON:** the route's `catch` returns HTTP `400` with the thrown message when the thrown value is an `Error`.
- **Invalid date syntax or impossible date:** date parsing throws; the handler returns HTTP `400` with `{ "error": message }`.
- **Inverted range:** valid dates with `endDate < startDate` expand to `[]`; validation still calls `getOccupiedDates` with that empty list and returns its normal result shape.
- **Empty expansion:** not an error by itself. A no-match BYDAY or an empty range can produce status `200` with empty date arrays.
- **Duplicate weekdays:** recognized BYDAY values are stored in a set, so duplicate tokens do not duplicate dates. Dates are visited once.
- **Unsupported/invalid RRULE parts:** no strict RRULE validation occurs. Unknown components and invalid day tokens are ignored; missing BYDAY defaults to weekdays. The `FREQ` key does not select frequency behavior.
- **UTC boundaries:** dates are parsed and emitted as UTC calendar days; the start and end are inclusive. No local timezone or daylight-saving adjustment is part of this date expander.
- **Desk conflicts:** every requested date is classified, so both available and conflicting dates can be returned. This is date occupancy, not time-overlap validation.
- **Alternative desk absence:** no suggestion is generated unless there is at least one requested-seat conflict and the store implements `listCandidateDesks`. An empty candidate list remains an empty array.
- **Rule interval corner cases:** absent or non-positive/non-finite/unparseable interval values fall back to one; positive values are floored. A value between zero and one floors to zero and therefore yields no dates.

## J. Testing and Integration

The focused service and handler tests are in [`src/features/seats/__tests__/recurringBookingService.test.ts`](../../src/features/seats/__tests__/recurringBookingService.test.ts). They exercise a Monday-through-Thursday multi-week expansion, conflict/availability partitioning, candidate filtering, and the injected-store HTTP handler request. They do not currently cover invalid calendar dates, inverted ranges, or explicit interval-two expansion.

There are two pre-existing source/test limitations to keep in mind when running this suite:

- The `SeatOccupancyStore.getOccupiedDates` return annotation in the service source is currently malformed (`Promise>;`), so the test suite fails TypeScript parsing before executing.
- Even after that parse issue is resolved, the current alternative-desk test data marks `2026-11-05` occupied for `desk-B2` but expects `availableForAllRequestedDates` to be `true`. The service implementation checks every requested date, so this value should be `false` for that candidate. This guide documents the implementation behavior rather than that contradictory assertion.

Run the focused test from the repository root:

```bash
npx jest src/features/seats/__tests__/recurringBookingService.test.ts --runInBand
```

The booking-creation flow has separate tests, including [`src/__tests__/api/recurringBookingCache.test.ts`](../../src/__tests__/api/recurringBookingCache.test.ts) for the distinct `/api/reservations/recurring-book` route and [`src/__tests__/lib/recurringReservationValidation.test.ts`](../../src/__tests__/lib/recurringReservationValidation.test.ts) for its date/time/timezone validation:

```bash
npx jest src/__tests__/api/recurringBookingCache.test.ts src/__tests__/lib/recurringReservationValidation.test.ts --runInBand
```

These are not tests of the RRULE slot-validation service. Add service tests alongside `recurringBookingService.test.ts` when changing the week anchor, interval selection, weekday parsing, inclusive boundaries, conflicts, or candidate sorting. Include both computed date arrays and store call arguments so boundary changes remain explicit.

## K. References

- [Recurring booking service](../../src/features/seats/recurringBookingService.ts)
- [Recurring availability route](../../src/app/api/seats/recurring-availability/route.ts)
- [Recurring booking service tests](../../src/features/seats/__tests__/recurringBookingService.test.ts)
- [Booking creation route](../../src/app/api/reservations/recurring-book/route.ts) (separate flow and payload)
- [Booking API documentation](./bookings.md)
- [API documentation index](./README.md)
- [RFC 5545: Internet Calendaring and Scheduling Core Object Specification](https://www.rfc-editor.org/rfc/rfc5545)
