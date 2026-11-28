# Desk Utilization and Seat Turnover Metrics

This runbook defines reservation-based desk metrics for venue reporting. It documents what the current data can support; it does not add a persisted analytics pipeline.

## Data sources and limits

The Prisma source of truth is [`Booking`](../../prisma/schema.prisma), with the `BookingStatus` enum, and [`VenueSeat`](../../prisma/schema.prisma). A booking stores a local `date` and `time`, optional IANA `timeZone`, optional `duration` in minutes, optional `seatId`, a current `status`, and `createdAt`. It does not store a status-transition history, a scheduled or actual checkout timestamp, or an occupancy-event table.

There is no Prisma `Reservation` or `ReservationEvent` model. The venue availability bus in [`event-bus.ts`](../../src/lib/reservations/event-bus.ts) and desk availability SSE updates are transient notifications, not a durable event log. Therefore, Prisma queries below read current booking/check-in records; they cannot reconstruct every historical booking, cancellation, or seat-release event as it happened.

[`CheckIn`](../../prisma/schema.prisma) is a separate live venue-presence record. It has `createdAt` and `expiresAt`, but no `bookingId` or `seatId`; it supports venue headcount, not per-seat occupancy history. See [`checkIn.ts`](../../src/lib/checkIn.ts).

## 1. Seat utilization

Use a half-open measurement window `W = [t0, t1)`. A booking occupies its scheduled interval `[start, end)`, where `start` is resolved from its `date`, `time`, and `timeZone`, and `end = start + duration`. The main booking endpoint accepts durations from 30 through 480 minutes; legacy or alternate write paths may not enforce that limit. The seating forecast treats a missing duration as 60 minutes.

For **scheduled seat utilization**, include bookings in `PENDING`, `CONFIRMED`, `CHECKED_IN`, or `COMPLETED`; exclude `CANCELLED` and `CANCELLED_BY_OPERATOR`. The first three statuses match the existing availability and forecast logic. Including `COMPLETED` is useful for a historical scheduled-use measure, but does not prove that the entire scheduled interval was physically occupied. For a current/forward-looking measure, use only `PENDING`, `CONFIRMED`, and `CHECKED_IN`.

- **Leased minutes:** For each assigned seat, clip eligible booking intervals to `W`, merge overlapping intervals for that seat, and sum the resulting minutes. Merging prevents conflicting duplicate rows from making one seat appear more than 100% utilized. A booking without `seatId` cannot contribute to seat-level leased minutes; report unassigned bookings separately.
- **Available inventory minutes:** Integrate the number of usable seats over `W`. With a fixed inventory of `N` enabled seats and a full-window measurement, this is `N × duration(W)` minutes. If a seat is disabled or unavailable for only part of `W`, subtract that interval only when the change is known. The schema stores the current `VenueSeat.isEnabled` value, not its history, so historical inventory changes cannot be reconstructed reliably.
- **Utilization percentage:**

  `Utilization (%) = (Leased Minutes / Available Inventory Minutes) × 100`

Use the venue's reporting timezone to choose window boundaries, convert those boundaries to instants, and measure elapsed minutes. Clip intervals to the window before summing. If available inventory minutes are zero, report the metric as not applicable rather than dividing by zero. Do not silently clamp values above 100%; investigate overlaps, duplicate assignments, stale inventory, or incorrect durations.

For booked inventory, use enabled `VenueSeat` rows. The seating-forecast endpoint uses the total seat count (including disabled rows) and falls back to `Venue.maxCapacity`, then `50`, when no seats are configured. Its reported capacity is therefore not necessarily the denominator for enabled-seat utilization. If using a capacity fallback because no seats are configured, label the result as venue-capacity utilization, not measured seat utilization.

### Aggregation windows and edge cases

Daily, weekly, or monthly reports should use explicitly documented local-time boundaries and a single reporting timezone. A local day that crosses a daylight-saving transition can contain 23 or 25 elapsed hours; calculate the denominator from the converted instants rather than assuming every local day is 1,440 minutes. Use `[start, end)` consistently so adjacent windows do not double-count boundary minutes.

Booking times are wall-clock values in each booking's `timeZone`. Use the shared booking date/time adapter rather than parsing a timestamp with the machine's local timezone. Missing `timeZone` values should use a documented reporting-zone fallback; invalid date/time values should be excluded and counted as data-quality errors. The adapter rejects nonexistent spring-forward times and resolves repeated fall-back times to the earlier occurrence.

The schema permits null durations. For comparability with the current seating forecast, use 60 minutes when `duration` is null; exclude and flag zero, negative, or otherwise invalid durations. The booking endpoint normally validates `30..480` minutes, but that constraint is not encoded in the Prisma schema. A same-seat overlap should be flagged; union intervals for utilization so the metric remains bounded, but do not hide the conflict from operators.

## 2. Seat turnover velocity

The repository does not persist actual seat-release timestamps or booking status-transition events. Consequently, true physical turnover velocity cannot be measured from current Prisma rows alone. The following is a **scheduled turnover proxy**, not an observed check-out metric:

1. Select the same non-cancelled statuses used for historical scheduled seat utilization.
2. Keep bookings with a non-null `seatId`, valid start and duration, and a scheduled end instant inside the measurement window `W`.
3. Count each distinct `Booking.id` once. A cancellation is not a turnover event; recurring occurrences count separately when they are separate booking rows.
4. With a fixed inventory of `N` enabled seats, normalize by elapsed 24-hour seat-days:

   `Scheduled turnover velocity = E_W / (N × ((t1 − t0) / 86,400,000))`

Here, `E_W` is the number of qualifying scheduled booking ends in `W`, and `t0`/`t1` are window boundary instants in milliseconds. The unit is **scheduled releases per enabled seat-day**. Count one event per booking end regardless of booking length. This differs from utilization, which measures seat-minutes: a long booking contributes more leased minutes but still only one scheduled release. If inventory changes during `W`, the denominator should be the integral of enabled seat count over elapsed days; current schema data cannot reconstruct historical inventory changes.

Use half-open windows and resolve each booking's timezone before testing its scheduled end. Overlapping bookings assigned to the same seat are data conflicts; flag them rather than interpreting both scheduled ends as verified physical turnovers. A booking marked `COMPLETED` by the geofence workflow may have ended early, but the schema has no completion timestamp, so its actual release time is unavailable.

## 3. Hourly occupancy

The existing [`seating-forecast` route](../../src/app/api/venues/%5BvenueId%5D/seating-forecast/route.ts) estimates hourly occupancy from booking intervals. It counts a booking in hour bucket `[h, h + 1)` when `bookingStart < bucketEnd && bookingEnd > bucketStart`. For example, a 120-minute booking starting at 10:00 overlaps the 10:00 and 11:00 buckets.

The route uses `PENDING`, `CONFIRMED`, and `CHECKED_IN` bookings, defaults a missing duration to 60 minutes, and counts booking rows rather than distinct occupied seats. It combines same-date scheduled counts with an average for prior dates sharing the target weekday, then caps the result at its capacity value. It does not use `Booking.timeZone`, does not require `seatId`, and is a forecast—not a record of people physically present. Its hourly buckets also do not model bookings that cross midnight as occupancy in the following date.

For a timezone-correct seat-level report, resolve starts with the stored booking timezone and intersect each interval with the reporting-zone hour buckets. Deduplicate by seat when calculating the number of occupied seats. For live venue headcount, query unexpired `CheckIn` rows (`expiresAt > now`); these records are not linked to seats and cannot supply historical hourly occupancy.

## 4. Peak vacancy windows

For a selected reporting window and a declared bucket size, use enabled seats and the same eligible booking intervals as the utilization calculation:

1. Group intervals by `seatId`, clip them to the reporting window, and merge overlaps per seat.
2. For each bucket `B`, calculate free seat-minutes as the sum, over enabled seats, of the portion of `B` outside that seat's merged booking intervals.
3. Calculate vacancy percentage as `free seat-minutes / (enabled seats × bucket minutes) × 100`.
4. Rank buckets by vacancy percentage. Combine adjacent buckets tied at the maximum into peak vacancy windows; report their local start/end, vacancy percentage, and free seat-minutes.

Choose and record the bucket size (hourly buckets align with the existing forecast). If inventory is zero, report no vacancy percentage. Use the venue's configured opening hours only when they can be reliably parsed for the reporting date; the current availability and seating-forecast code does not apply `Venue.openingHours` to these calculations. State whether the report covers the full day or only a separately supplied operating window.

The forecast endpoint's `recommendedHours` are the three least-occupied forecast buckets from 09:00 through 17:00. They are not seat-level vacancy intervals and should not be presented as measured peak-vacancy windows.

## 5. Ghost bookings and automatic release

The inspected booking-specific signal is the geofence workflow in [`deskManager.ts`](../../src/lib/reservations/deskManager.ts), using the 250-meter radius in [`geofence.ts`](../../src/lib/geo/geofence.ts):

- It applies to bookings in `CONFIRMED`, `PENDING`, or `CHECKED_IN`.
- A report at more than 250 meters starts a persisted exit timer; returning to 250 meters or nearer clears it.
- If a later report is still outside and the recorded absence is **more than 30 minutes**, an atomic update changes the booking status to `COMPLETED` and broadcasts availability. This is an automatic completion/release heuristic, not a cancellation.
- No separate no-show threshold, lack-of-check-in cancellation rule, or automatic ghost-booking cancellation was found. Do not infer a ghost booking solely from a reservation without a check-in.

The [`CheckIn` TTL](../../src/lib/checkIn.ts) is four hours and supports live venue-presence expiry; it does not cancel or complete a `Booking`.

**Schema alignment gap:** the geofence implementation reads and writes `Booking.geofenceExitAt`, and a SQL migration adds that column, but `geofenceExitAt` is absent from the current `Booking` model in `schema.prisma`. The Prisma examples below intentionally do not select or filter on that field. Resolve this schema/migration drift before relying on geofence persistence in a generated Prisma Client.

## 6. Prisma query examples

There is no durable reservation-event table to aggregate. The first query counts current booking records by their scheduled start date and current status; it is not a status-transition event count. `date` is a string, so use zero-padded `YYYY-MM-DD` boundaries for this grouping.

```typescript
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const byStartDateAndCurrentStatus = await prisma.booking.groupBy({
  by: ["date", "status"],
  where: {
    venueId,
    date: { gte: fromDate, lte: throughDate },
  },
  _count: { _all: true },
});
```

Fetch the configured inventory and booking fields needed to calculate intervals, utilization, turnover proxies, and vacancy. The example uses the full venue booking set to avoid dropping bookings that start before a window but overlap it; for large venues, paginate or narrow the query only with a documented duration/timezone lookback that is safe for every write path.

```typescript
const [venue, enabledSeats, bookings] = await Promise.all([
  prisma.venue.findUnique({
    where: { id: venueId },
    select: { maxCapacity: true },
  }),
  prisma.venueSeat.findMany({
    where: { venueId, isEnabled: true },
    select: { id: true, seatNumber: true },
  }),
  prisma.booking.findMany({
    where: {
      venueId,
      status: {
        in: [
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
          BookingStatus.COMPLETED,
        ],
      },
    },
    select: {
      id: true,
      seatId: true,
      date: true,
      time: true,
      timeZone: true,
      duration: true,
      status: true,
      createdAt: true,
    },
  }),
]);
```

Resolve each start using `bookingStartsAt(booking, reportingTimeZone)` from [`bookingTime.ts`](../../src/lib/bookingTime.ts). Treat null duration as the documented 60-minute fallback, reject invalid starts or non-positive durations, and compute `end = start + durationMinutes × 60,000`. Clip each interval to the reporting window and merge per `seatId` before summing leased minutes. `createdAt` is when the booking row was created; it is not a check-in, completion, cancellation, or turnover timestamp.

For live venue presence, the schema-backed query is:

```typescript
const now = new Date();
const activeCheckIns = await prisma.checkIn.findMany({
  where: {
    venueId,
    expiresAt: { gt: now },
  },
  select: {
    userId: true,
    createdAt: true,
    expiresAt: true,
  },
});
```

This yields a current headcount input, not seat-level utilization. For a zero-seat configuration, `Venue.maxCapacity` can be reported as a venue-capacity fallback, but it is not a list of individually assignable seats. A historical utilization denominator based on `isEnabled` is only as accurate as the current inventory state because enable/disable history is not stored.

## 7. Operational interpretation and data quality

- Keep scheduled utilization, live check-in headcount, and predicted occupancy as separate measures; they answer different questions.
- Respect each booking's stored timezone when constructing intervals, and document the reporting timezone used for aggregation. Do not concatenate `date` and `time` and rely on the server's local timezone.
- Use half-open intervals and merge same-seat overlaps for duration totals. Flag conflicting assignments and missing `seatId` values rather than treating them as trustworthy occupancy.
- Exclude cancelled statuses from scheduled-use metrics, but remember that the current status alone cannot show when cancellation occurred or whether a booking was previously active.
- Compare `Booking` and `CheckIn` only as separate signals: `CheckIn` has no booking/seat relation, can be renewed, and expires after four hours unless refreshed.
- Label schedule-derived values as booked or predicted minutes, not physical occupancy. The schema lacks durable actual check-in/check-out intervals and historical seat-inventory snapshots.
- Do not use the transient availability event stream as an audit source. If actual turnover, cancellation timing, or historical occupancy is required, the application needs a durable, timestamped event/occupancy record and a schema that represents it.
