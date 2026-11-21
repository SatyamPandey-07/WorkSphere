# WorkSphere community badge catalog

This catalog separates badges that are actually represented in the current
application code from names that are mentioned in product copy but do not yet
have a verified registry entry or unlock rule. The analytics payload is
currently assembled in `src/app/api/analytics/route.ts`; visual components
live under `src/components/badges/`.

## Implemented analytics badges

The following records are returned by the analytics API. Their earned state
and progress are calculated from the authenticated user's data.

| Badge | API ID | Unlock condition | Progress |
| --- | --- | --- | --- |
| WiFi Scout | `wifi_scout` | 3 or more venue speed tests with a positive Wi-Fi speed value | Up to 3 speed tests |
| Cafe Nomad | `cafe_nomad` | Confirmed bookings at 5 distinct venues whose category is `cafe` | Up to 5 unique cafes |
| Night Owl | `night_owl` | At least one venue review created at or after 21:00 or before 05:00 in the server runtime's local timezone | 0 or 1 qualifying review |
| Verified Explorer | `verified_explorer` | 10 or more accurate amenity votes | Up to 10 accurate votes |

The Night Owl calculation currently uses JavaScript `Date.getHours()` on the
server. It is therefore based on the runtime timezone, not a stored venue or
user timezone. Do not describe it as a user's local time until that behavior is
changed.

## Implemented visual components

### Test Pilot Wings

Source: `src/components/badges/TestPilotWingBadge.tsx`

The current component renders an accessible SVG badge with a tooltip and
supports `className` and `testId`. It does not accept a tier, check-in count,
or unlock-state prop. The separate legacy guide
`docs/components/TestPilotWingBadge.md` describes bronze/gold/emerald tiers,
but those tier rules are not represented by the current component interface.
Treat the component as a visual badge until a canonical earning rule is added.

### Verified Explorer

Source: `src/components/badges/VerifiedExplorerBadge.tsx`

This component can accept an `earned` override or load the
`verified_explorer` record from `/api/user/badges`. Its default description
currently says “5+ verified coworking venue check-ins”, while the analytics
route awards its `verified_explorer` record for 10 accurate amenity votes.
That copy/contract mismatch should be resolved before using the component
description as the authoritative earning rule. The analytics API threshold is
the source of truth for the catalog above.

## Names not currently verified in the active registry

The labels **Speed Demon** and **Eco Nomad** are not present as badge records
or dedicated badge components in the current source inspected for this
catalog. They should not be presented as implemented achievements until a
registry entry, icon/component, unlock calculation, progress target, and tests
are added. Likewise, “Night Owl” is currently an analytics badge record, not a
dedicated component under `src/components/badges/`.

## Adding a badge

1. Define a stable lowercase ID, display name, concise description, icon key,
   and explicit numeric target.
2. Compute `earned` and `progress` from server-side, authenticated data.
   Never accept a client-provided earned flag as authority.
3. Add the record to the analytics/API response contract and keep the
   `/api/user/badges` representation consistent if the visual component uses
   that endpoint.
4. Add an accessible visual component or extend a shared badge component.
   Provide a readable name, a text alternative for decorative SVGs, keyboard
   access for tooltips, and a visible focus indicator.
5. Add API/unit tests for below-target, exact-target, above-target, missing
   data and timezone-sensitive conditions.
6. Update this catalog and link it from `docs/README.md`.

## Relevant source and tests

- `src/app/api/analytics/route.ts`
- `src/app/api/user/badges/route.ts`
- `src/components/badges/TestPilotWingBadge.tsx`
- `src/components/badges/VerifiedExplorerBadge.tsx`
- `src/__tests__/components/badges/TestPilotWingBadge.test.tsx`
- `src/__tests__/components/badges/VerifiedExplorerBadge.test.tsx`
