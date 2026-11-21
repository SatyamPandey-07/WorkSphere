# DST-Safe Desk Reservation Durations

## Purpose

Reservation duration is elapsed time between two instants, not the difference between two local clock readings. A daylight-saving transition changes the UTC offset of a timezone. As a result, a reservation that appears to span two hours on a wall clock may represent one or three elapsed hours.

WorkSphere's seat-hold helpers in `src/features/seats/seatHoldService.ts` normalize accepted inputs to epoch milliseconds and subtract those absolute instants.

## The failure mode

A spring-forward transition skips one local hour. A fall-back transition repeats one local hour. Subtracting local hour/minute fields or constructing both endpoints with a fixed offset can therefore overcount, undercount, or produce an invalid duration.

| Region / transition | Local interval | Actual elapsed time |
|---|---|---:|
| Northern hemisphere, New York spring 2024 | 2024-03-10 01:30 -05:00 → 03:30 -04:00 | 1 hour |
| Northern hemisphere, New York autumn 2024 | 2024-11-03 00:30 -04:00 → 02:30 -05:00 | 3 hours |
| Southern hemisphere, Sydney spring 2024 | 2024-10-06 01:30 +10:00 → 03:30 +11:00 | 1 hour |
| Southern hemisphere, Sydney autumn 2024 | 2024-04-07 01:30 +11:00 → 03:30 +10:00 | 3 hours |

The examples use explicit offsets to identify each instant unambiguously. A local time without an offset may be ambiguous or may not exist at a transition.

## WorkSphere normalization contract

`calculateSeatHoldDurationMs(startAt, endAt)` accepts:

- A valid JavaScript `Date` object.
- A finite epoch-millisecond number.
- An ISO-8601 timestamp ending in `Z` or an explicit `±HH:MM` offset.

It rejects timezone-naive strings, invalid timestamps, unsafe durations, and intervals whose end is not after their start. The result is `endEpochMs - startEpochMs`, i.e. actual elapsed milliseconds.

`calculateSeatHoldExpiryMs` validates the same interval and returns the absolute end instant as epoch milliseconds. Persist and compare expiry instants, not local display strings.

### Safe and unsafe examples

```ts
import { calculateSeatHoldDurationMs } from "@/features/seats/seatHoldService";

// New York spring-forward: local clock advances two hours,
// but only one real hour elapsed.
const elapsed = calculateSeatHoldDurationMs(
  "2024-03-10T01:30:00-05:00",
  "2024-03-10T03:30:00-04:00",
);
console.log(elapsed / 60_000); // 60

// Do not subtract getHours(), getMinutes(), or formatted local strings.
// The repeated autumn hour makes wall-clock arithmetic ambiguous.
```

## UTC and service-boundary rules

1. Convert user-entered local date/time plus an IANA timezone into one unambiguous instant at the API boundary.
2. Carry instants between services as UTC ISO strings (`toISOString()`) or integer epoch milliseconds/seconds with the unit stated in the field name and contract.
3. Do not infer an instant from a timezone-naive ISO string.
4. Calculate billing and lock TTLs from absolute instants. Convert to a venue's timezone only for display and user input.
5. Never assume every local day is 24 hours; DST days can be 23 or 25 hours.

The current seat-hold helper uses native `Date` parsing for explicit-offset values. If a caller uses `date-fns-tz` or Luxon to interpret an IANA timezone, it must first resolve the local input to an instant, then pass that instant to the helper. Do not mix library-local date arithmetic with epoch arithmetic or apply a timezone offset twice.

## DST-aware tests

- Use explicit offsets in fixtures so test meaning does not depend on the machine's `TZ` setting.
- Cover both spring-forward and fall-back transitions in Northern and Southern hemisphere zones.
- Assert elapsed milliseconds, not formatted local-clock differences.
- Include ambiguous/nonexistent local strings and assert that timezone-naive input is rejected.
- Include invalid dates, non-finite epoch values, zero-length intervals, and end-before-start intervals.
- Keep the timezone and exact expected elapsed duration in each test name.

## Monotonic clocks versus reservation time

A monotonic clock (such as `performance.now()`) is appropriate for measuring an in-process timeout because it is not affected by wall-clock corrections. It is not a durable reservation timestamp and cannot be compared across machines or persisted as an expiry. Reservation start/end instants must be absolute UTC timestamps; elapsed duration is their epoch difference. Use monotonic time only for local elapsed-time measurement within one running process.

## Related implementation and tests

- `src/features/seats/seatHoldService.ts`
- `src/__tests__/features/seats/seatHoldService.test.ts`
- [Booking API documentation](../api/bookings.md)
