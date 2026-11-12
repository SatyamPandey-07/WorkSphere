# WorkSphere iCalendar (ICS) Specification

This guide describes the iCalendar payloads WorkSphere currently generates, the RFC 5545 conventions they follow, and the recurrence syntax to use if recurring booking support is added.

## Generators and output paths

| API | Purpose | Output |
| --- | --- | --- |
| `generateBookingIcs()` | One booking with normalized UTC timestamps and optional display alarms | RFC 5545 calendar text or `null` for an invalid booking date/time |
| `generateICSContent()` | Legacy single-booking generator with optional timezone and one minute-based alarm | RFC 5545 calendar text or an empty string for invalid date/time |
| `generateBulkICSContent()` | Multiple bookings in one calendar | RFC 5545 calendar text or `null` when no valid booking can be generated |
| `buildGoogleCalendarLink()` | Opens a pre-filled Google Calendar event | HTTPS URL |
| `buildOutlookWebLink()` | Opens a pre-filled Outlook event | HTTPS URL |

The booking generator is implemented in `src/lib/calendar/icsGenerator.ts`. Shared escaping and line-folding helpers live in `src/lib/calendar/ics.ts`.

## Calendar and event structure

A calendar document is enclosed by `BEGIN:VCALENDAR` and `END:VCALENDAR`. The booking generator emits `VERSION:2.0`, a WorkSphere `PRODID`, `CALSCALE:GREGORIAN`, and `METHOD:PUBLISH`, followed by one `VEVENT`.

The booking event can contain:

| Property | Meaning |
| --- | --- |
| `UID` | Stable event identifier derived from the booking ID and `@worksphere.app` |
| `DTSTAMP` | UTC timestamp at which the calendar record was generated |
| `DTSTART` / `DTEND` | Event start and end instants in UTC |
| `SUMMARY` | Booking title |
| `DESCRIPTION` | Booking and venue details |
| `LOCATION` | Venue name and address |
| `GEO` | Optional latitude and longitude when both are valid |
| `STATUS` | `CONFIRMED`, `TENTATIVE`, or `CANCELLED` |
| `TRANSP` | `OPAQUE` for a booking that occupies the calendar time |

A minimal event shape is:

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WorkSphere//Booking Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:booking-123@worksphere.app
DTSTAMP:20261112T120000Z
DTSTART:20261115T043000Z
DTEND:20261115T053000Z
SUMMARY:Booking at WorkSphere Central
DESCRIPTION:Booking at WorkSphere Central\nBooking ID: booking-123
LOCATION:WorkSphere Central\, Pune
STATUS:CONFIRMED
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR
```

The sample values are illustrative. The implementation calculates timestamps from the booking input.

## Date and time representation

WorkSphere serializes event instants in UTC using the basic iCalendar date-time form:

`YYYYMMDDTHHMMSSZ`

For example, `2026-11-15T04:30:00.000Z` becomes `20261115T043000Z`.

The booking path resolves the booking's date and wall-clock time through `parseBookingDateTime(date, time, timeZone)`. If no booking timezone is supplied, it falls back to UTC. The resulting event is emitted in UTC, so the generated event does not require a `TZID` parameter or an embedded `VTIMEZONE` component.

Do not append a local offset to a UTC value. The trailing `Z` is the UTC designator.

## Text escaping

RFC 5545 text values must escape special characters. WorkSphere's `escapeIcsText()` helper applies these transformations before a text value is written:

| Source character | Serialized form |
| --- | --- |
| Backslash (`\\`) | `\\\\` |
| Comma (`,`) | `\\,` |
| Semicolon (`;`) | `\\;` |
| Newline | `\\n` |

The helper is used for event summary, description, location, and alarm description values. Do not pre-escape values before passing them to the generator; doing so can double-escape the text.

## Line endings and folding

- Calendar content lines are joined with CRLF (`\r\n`).
- The generated document ends with a CRLF.
- RFC 5545 limits a content line to 75 octets, not 75 JavaScript characters.
- `foldIcsLine()` uses UTF-8 byte counts and avoids splitting a multi-byte character.
- A folded continuation line begins with one space. That leading space is part of the serialized line and is removed by an iCalendar parser when unfolding.

When adding a new property, pass the complete logical line through `foldIcsLine()`; do not manually split by JavaScript string length.

## Display alarms

A display reminder is represented by a `VALARM` component nested inside its `VEVENT`:

```ics
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
DESCRIPTION:Reminder: Booking at WorkSphere Central
END:VALARM
```

The booking generator supports minute-based reminders through `alarmMinutes`; when omitted, it preserves the existing 30-minute default. The custom-alarm extension associated with issue #7522 adds validated negative RFC 5545 duration triggers, for example:

- `-PT15M` — 15 minutes before the event.
- `-PT1H` — 1 hour before the event.
- `-P1D` — 1 day before the event.

A custom alarm can supply its own `DESCRIPTION`; otherwise the generator uses a booking reminder description. Invalid, zero-length, or positive (after-start) triggers are ignored. An explicit empty custom alarm list means no alarms.

## Recurrence rule reference

RFC 5545 represents recurrence with an `RRULE` property inside a `VEVENT`. For example:

```ics
RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;COUNT=10
```

Common rule parts include:

| Part | Meaning | Example |
| --- | --- | --- |
| `FREQ` | Recurrence frequency | `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` |
| `INTERVAL` | Every N frequency units | `INTERVAL=2` |
| `BYDAY` | Selected weekdays | `BYDAY=MO,WE,FR` |
| `BYMONTHDAY` | Selected days of the month | `BYMONTHDAY=1,15` |
| `COUNT` | Maximum number of occurrences | `COUNT=10` |
| `UNTIL` | Inclusive recurrence end boundary | `UNTIL=20261231T235959Z` |

**Current support boundary:** WorkSphere's current booking generators do not emit `RRULE`, `RDATE`, or `EXDATE` properties and do not expand recurring reservations. The examples in this section are a standards reference for a future recurrence feature, not a claim that recurring bookings are currently supported.

## Calendar links and client compatibility

| Client | WorkSphere integration | Notes |
| --- | --- | --- |
| Google Calendar | `buildGoogleCalendarLink()` | Creates a pre-filled event URL with UTC dates, title, details, location, and timezone |
| Outlook web | `buildOutlookWebLink()` | Creates a pre-filled web compose URL for personal or work accounts |
| Apple Calendar | Download/import the generated `.ics` file | The generator does not create an Apple-specific deep link |
| Desktop Outlook | Download/import the generated `.ics` file | The payload uses standard UTC event properties |

For changes to the generator, validate both the raw ICS text and the resulting import in the target calendar client. Verify the event start/end, venue text, alarms, and non-ASCII text.

## Implementation checklist

- Keep `VEVENT` properties inside the event boundaries and `VALARM` components inside their parent event.
- Escape all user-provided text with `escapeIcsText()`.
- Fold complete content lines with `foldIcsLine()`.
- Keep UTC values in basic iCalendar date-time format.
- Use stable booking identifiers for `UID`.
- Add tests for invalid booking dates, escaping, UTF-8 folding, default and custom alarms, and the absence of alarms when explicitly disabled.
- Do not advertise recurrence support until an API accepts recurrence rules and the generated calendar contains the corresponding RFC 5545 properties.
