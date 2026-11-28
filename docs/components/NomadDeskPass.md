# NomadDeskPass

This document covers the Flutter pass screen and the web `NomadDeskPass`
component. They have separate models and QR payloads; do not assume that a
property or behavior from one is available in the other.

## Flutter pass screen

The Flutter widget is `NomadDeskPassScreen` in
`mobile/lib/features/passes/presentation/nomad_desk_pass_screen.dart`.

### Offline pass caching

`NomadDeskPassCache` stores a pass per booking ID. The supplied
`SharedPreferencesNomadDeskPassCache` implementation writes JSON to
SharedPreferences under `nomad_desk_pass_<bookingId>`. The JSON contains:

| Cached field | Purpose |
|---|---|
| `bookingId` | Identifies the booking and cache entry. |
| `venueName` | Name shown on the pass. |
| `qrPayload` | Data encoded into the QR code. |
| `expiresAt` | Optional expiry timestamp, serialized in UTC ISO 8601 format. |

When the screen opens, it reads the cache first. A valid cached pass is
displayed while an optional `loadPass` request runs. If there is no loader,
the cached pass is used without making a network request. If refreshing fails,
the cached pass remains visible with “Showing the saved pass; refresh is
unavailable.” If no cached pass is available, a failed refresh reports “Pass
is unavailable. Try again when online.”

The SharedPreferences cache removes an entry when its JSON fields are
malformed, its booking ID does not match the requested ID, or its non-null
expiry is at or before the current time. A missing cache entry is not itself an
error. Successful refreshes replace the cache entry, but only after the loaded
pass's booking ID has been checked against the requested ID. A cache read
failure is surfaced as “Saved pass could not be read.” A cache write failure
does not replace an already displayed saved pass.

### Flutter widget properties and QR payload

| Property | Type | Required? | Default | Purpose |
|---|---|---:|---|---|
| `bookingId` | `String` | Yes | — | Booking identifier used to read the cache and passed to `loadPass`. A loaded pass must have the same ID. |
| `cache` | `NomadDeskPassCache` | Yes | — | Reads and writes saved pass data. |
| `loadPass` | `NomadDeskPassLoader?` (`Future<NomadDeskPass> Function(String)`) | No | `null` | Optional source of a fresh pass; when omitted, the screen uses the cache only. |
| `key` | `Key?` | No | `null` | Standard Flutter widget key. |

`NomadDeskPass.forBooking` creates the Flutter QR payload as
`worksphere://pass/<bookingId>`, with the booking ID URI-encoded as one path
segment. A `NomadDeskPass` constructed directly can provide its own non-empty
`qrPayload`. Cached data is associated with its booking ID, and a fresh pass
whose ID differs from the requested `bookingId` is rejected.

```dart
NomadDeskPassScreen(
  bookingId: 'booking-123',
  cache: const SharedPreferencesNomadDeskPassCache(),
  loadPass: passRepository.loadPass,
)
```

### Flutter address behavior

The Flutter `NomadDeskPass` data model currently has no `venue.address` field;
it stores `venueName` only. Consequently, the Flutter screen does not display
a venue address and has no address fallback string. It displays
“Venue details unavailable” when `venueName` is empty or whitespace.

## Web `NomadDeskPass` component

The web component is in `src/components/bookings/NomadDeskPass.tsx`. It uses
`venue.address` when it is a non-empty string after trimming. If the address
is null, omitted, not a string, or blank, the location subtitle falls back in
this order:

1. Both `neighborhood` and `city`, joined with `, `.
2. A non-empty `neighborhood`.
3. A non-empty `city`.
4. The first non-empty string in `tags`.
5. No subtitle text (the subtitle container remains present).

For example, an address takes precedence over all other location fields:

```ts
const venueWithAddress = {
  name: 'Central Nomad Hub',
  address: '123 Market Street, Suite 400',
  neighborhood: 'Financial District',
  city: 'San Francisco',
};
// Displayed subtitle: "123 Market Street, Suite 400"
```

When no address is available, the first available fallback is used:

```ts
const venueWithoutAddress = {
  name: 'Bandra Workspace',
  address: null,
  neighborhood: 'Bandra West',
  city: 'Mumbai',
};
// Displayed subtitle: "Bandra West, Mumbai"
```

### Web widget property reference

Every `NomadDeskPassProps` field is optional. When `booking` is absent, the
component constructs a booking from the direct compatibility props. When
`booking` is supplied, those direct data props do not override it.

| Property | Type | Required? | Default | Purpose |
|---|---|---:|---|---|
| `booking` | `NomadDeskBooking` | No | `undefined` | Complete booking data, including its venue and location fields. |
| `isOpen` | `boolean` | No | `true` | Controls whether the pass dialog is rendered and its QR token is loaded. |
| `onClose` | `() => void` | No | `undefined` | Called to close the dialog, including Escape and backdrop interaction. |
| `venueName` | `string` | No | `undefined` | Direct-prop venue name used when constructing a booking. |
| `confirmationId` | `string` | No | `undefined` | Direct-prop confirmation ID; used as the constructed booking ID and confirmation ID. |
| `seatLabel` | `string` | No | `"Hot Desk"` | Direct-prop seat label, mapped to the constructed booking's seat number. |
| `dateLabel` | `string` | No | `"Today"` | Direct-prop date, mapped to the constructed booking's date. |
| `onDownloadPng` | `(filename: string, dataUrl: string) => void` | No | `undefined` | Receives the generated filename and data URL instead of triggering the component's PNG download. |
| `address` | `string \| null` | No | `undefined` | Direct-prop address used when constructing the venue. |
| `city` | `string \| null` | No | `undefined` | Direct-prop city used when constructing the venue and as an address fallback. |
| `neighborhood` | `string \| null` | No | `undefined` | Direct-prop neighborhood used when constructing the venue and as an address fallback. |

The booking's `id` is the key used to load and cache the signed offline
passcard token. The QR encodes that server-issued token; it is not the
Flutter `worksphere://pass/...` URI. `confirmationId` is displayed as the
booking reference and does not replace the booking ID for cache lookup.

```tsx
<NomadDeskPass
  booking={{
    id: 'booking-123',
    confirmationId: 'CONF-123',
    date: '2026-11-28',
    time: '10:00 AM',
    venue: {
      name: 'Bandra Workspace',
      address: null,
      neighborhood: 'Bandra West',
      city: 'Mumbai',
    },
  }}
/>
```
