# BookingDatePicker Timezone Behavior

`BookingDatePicker` accepts an optional `timeZone` prop:

```ts
timeZone?: string;
```

The value should be a valid IANA timezone identifier, such as `Asia/Kolkata` or
`America/Los_Angeles`. For inputs parsed as instants (a `Date` or a date string
that does not begin with `YYYY-MM-DD`), the component uses
`Intl.DateTimeFormat` with that timezone to determine the calendar year, month,
and day.

Strings beginning with `YYYY-MM-DD` are treated as calendar dates directly.
Their year, month, and day are used as supplied, without timezone conversion or
timezone validation.

## Invalid Timezones and UTC Fallback

The component validates a timezone by constructing and formatting with
`Intl.DateTimeFormat`. If the identifier is unrecognized or invalid, that
validation throws and is caught. The component then extracts the date using UTC
date getters (`getUTCFullYear()`, `getUTCMonth()`, and `getUTCDate()`). Missing
or empty `timeZone` values also use this UTC path.

There is **no warning emitted** for an invalid timezone: the implementation
catches the validation error without calling `console.warn`, `console.error`,
or another logging API.

## Examples

For `Date` inputs, a valid IANA timezone determines the calendar date:

```tsx
import { BookingDatePicker } from "@/components/bookings/BookingDatePicker";

const instant = new Date("2026-01-01T00:30:00.000Z");

<BookingDatePicker value={instant} timeZone="Asia/Kolkata" />;
// parseToCalendarTuple(instant, "Asia/Kolkata") => { year: 2026, month: 1, day: 1 }
```

An invalid identifier falls back to the UTC date for that same instant:

```tsx
import { BookingDatePicker } from "@/components/bookings/BookingDatePicker";

const instant = new Date("2026-01-01T00:30:00.000Z");

<BookingDatePicker value={instant} timeZone="Not/AZone" />;
// parseToCalendarTuple(instant, "Not/AZone") => { year: 2026, month: 1, day: 1 }
```

With a valid timezone such as `America/Los_Angeles`, the same instant resolves
to December 31, 2025. The invalid-timezone example instead uses UTC.

## Tests

[`src/__tests__/components/bookings/BookingDatePicker.test.tsx`](../../src/__tests__/components/bookings/BookingDatePicker.test.tsx)
contains these relevant cases:

- **“anchors calendar tuples at noon UTC and steps across US spring-forward and fall-back DST boundaries without shifting days”** covers calendar tuple parsing with valid IANA zones and UTC-anchored day stepping.
- **“renders and selects exact Y-M-D dates across DST boundaries without off-by-one shifts”** covers rendering and selection with `timeZone="America/Los_Angeles"`.

That test file does **not** currently contain a case for an invalid timezone or its UTC fallback. The fallback described above is verified against the component implementation, not claimed as test coverage.
