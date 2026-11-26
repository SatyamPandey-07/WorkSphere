# Venue Accessibility Compliance and Wheelchair Audit Guidelines

A guide for developers and community auditors on how WorkSphere stores accessibility data, how routes are scored, and how to audit a venue for step-free access. It separates what the code does today from the audit criteria that auditors should apply.

For keyboard and screen reader testing of the venue pages, see the [Venue Detail Views Accessibility Audit](./accessibility/VENUE_DETAILS_A11Y_AUDIT.md). This guide is about physical access to the venue.

## What the code stores today

| Topic from the issue | In the code today |
| --- | --- |
| Accessibility flags in the venue schema | None. The Prisma `Venue` model has no accessibility columns. |
| Wheelchair flag on venue results | A single optional boolean, `amenities.wheelchair`, on venues loaded from OpenStreetMap. |
| Step-free entrance, elevator width, accessible restroom | Not stored per venue. Elevators and ramps appear only as parsed map tags on route segments. |
| Crowdsourced accessibility reports | No accessibility report model or form. |
| Audit and verification workflow | Not in code. This guide defines it. |

The audit rubric below is therefore a process for people. Until a schema exists, audit results live in pull requests, issues or OpenStreetMap, not in WorkSphere's database.

## Where the code lives

| Concern | File |
| --- | --- |
| Venue wheelchair flag from OSM | [`src/lib/venues.ts`](../src/lib/venues.ts) |
| Accessible badge on venue cards | [`src/components/VenueCard.tsx`](../src/components/VenueCard.tsx) |
| "Wheelchair Accessible" filter pill | [`src/components/venues/AmenityFilterPills.tsx`](../src/components/venues/AmenityFilterPills.tsx) |
| OSM tag parsing and 0 to 100 score | [`src/core/accessibility/OSMAccessibilityParser.ts`](../src/core/accessibility/OSMAccessibilityParser.ts) |
| Route penalties for wheelchair mode | [`src/core/accessibility/AccessibleRouter.ts`](../src/core/accessibility/AccessibleRouter.ts) |
| Indoor step-free pathfinding | [`src/core/accessibility/AccessibilityRouter.ts`](../src/core/accessibility/AccessibilityRouter.ts) |
| Incline thresholds and route status | [`src/lib/routing/elevation.ts`](../src/lib/routing/elevation.ts) |
| OpenRouteService wheelchair profile | [`src/lib/accessibility/openRouteService.ts`](../src/lib/accessibility/openRouteService.ts) |

## Architecture overview

### Venue flag

`src/lib/venues.ts` sets `amenities.wheelchair = tags.wheelchair === "yes"` from the venue's OpenStreetMap tags. Values `limited`, `no` and a missing tag all become `false`, so the interface cannot tell "not accessible" from "unknown". `VenueCard` shows an "Accessible" badge only when the flag is true.

The `AmenityFilterPills` component offers a "Wheelchair Accessible" pill that writes a `wheelchair` query parameter. I did not find code that reads that parameter to filter results, so check it before relying on the filter.

### OSM feature parsing

`OSMAccessibilityParser.parseFeatures` turns tags into five booleans:

| Feature | True when |
| --- | --- |
| `isWheelchairAccessible` | `wheelchair` is `yes` or `limited` |
| `hasElevator` | `highway=elevator`, `amenity=elevator` or `wheelchair:place=elevator` |
| `hasRamp` | `kerb=lowered`, `footway=ramp`, or `incline` is `up` or `down` |
| `accessibleEntrance` | `entrance=yes` and (`wheelchair=yes` or `wheelchair:entrance=yes`) |
| `hasTactilePaving` | `tactile_paving=yes` |

Note the parser treats `limited` as accessible, while the venue flag in `venues.ts` does not.

### Accessibility score

`calculateScore` adds points, capped at 100:

| Feature | Points |
| --- | ---: |
| Wheelchair accessible | 40 |
| Elevator | 20 |
| Ramp | 20 |
| Accessible entrance | 10 |
| Tactile paving | 10 |

If the tags include a numeric `suitability` (0 to 10), the score becomes at least `suitability × 10`. Example: a segment with `wheelchair=yes`, `highway=elevator` and `entrance=yes` with `wheelchair:entrance=yes` scores 40 + 20 + 10 = 70.

### Route rules

`AccessibleRouter.evaluateRoute` in wheelchair mode:

- Adds a penalty of 2.0 to a segment with no wheelchair access and no ramp.
- Adds `(grade − 8.33) / 5` when the grade exceeds 8.33 percent.
- Marks a route recommended when its lowest segment score is 60 or more and the penalty multiplier is below 1.5.

`AccessibilityRouter` (indoor graph, wheelchair profile) skips any edge with stairs or a gradient above the profile limit, and reports `NO_ACCESSIBLE_PATH_EXISTS` when nothing remains. It warns when:

- a corridor is narrower than **91 cm (36 in)**: severity `critical` below 80 cm, otherwise `warning`
- a sharp 90 degree corner has less than **100 cm** clear width

`assessAccessibility` in `elevation.ts` gives each route one status:

| Condition | Status |
| --- | --- |
| Stairs present, or grade above 8.33 percent | `inaccessible` |
| Grade above 8.0 percent up to 8.33 percent | `warning` |
| Stair information missing | `unknown` |
| Grade at most 8.0 percent and stairs explicitly absent | `accessible` |

The important rule: **missing data never becomes "accessible".** Auditors should follow the same rule.

## Audit criteria

These criteria use the standards the code references: the 8.33 percent (1:12) slope and the 36 inch route width. Other values come from the 2010 ADA Standards for Accessible Design. Where your country has its own code, use it and note which one you used.

Record every result as **Pass**, **Fail** or **Not verified**. Do not guess.

### 1. Approach and step-free entrance

| Check | Pass when |
| --- | --- |
| Route from the street or parking to the entrance | Continuous, no steps or kerbs without a ramp or dropped kerb |
| Entrance door | At least 32 in (815 mm) clear opening, measured with the door open at 90 degrees |
| Threshold | No step. Any change in level is a ramp or a bevelled threshold |
| Ramp slope | At most 1:12 (8.33 percent) |
| Ramp width | At least 36 in (915 mm) between handrails |
| Landings | Level landing at the top and bottom of each ramp, at least 60 in (1525 mm) long |
| Door operation | Can be opened without tight grasping, or has an automatic opener |

### 2. Interior routes and elevators

| Check | Pass when |
| --- | --- |
| Corridor width | At least 36 in (915 mm) clear. The code warns below 91 cm |
| Turning space | A 60 in (1525 mm) circle or T-shaped turn exists at dead ends and at desks |
| Internal doors | At least 32 in (815 mm) clear |
| Elevator reaches every floor with workspace | Yes |
| Elevator door clear opening | Measured and recorded in mm. Compare with your local code (ADA 2010 section 407 for the United States) |
| Elevator car interior | Width and depth measured and recorded. Compare with the same code |
| Elevator controls and signals | Reachable from a seated position, with audible and visual floor signals |

### 3. Accessible restroom

| Check | Pass when |
| --- | --- |
| Restroom on an accessible route | Yes, on the same floor as the workspace or reachable by elevator |
| Door | At least 32 in (815 mm) clear opening |
| Turning space | A 60 in (1525 mm) circle or T-shaped turn inside |
| Toilet | Grab bars present and side clear space available |
| Sink | Reachable from a seated position, with knee clearance |

### 4. Workspace

| Check | Pass when |
| --- | --- |
| At least one desk or table | Has knee clearance and a reachable surface |
| Aisles to that desk | At least 36 in (915 mm) clear |
| Power outlets and light switches | Reachable from a seated position |

### Overall result

| Result | Rule |
| --- | --- |
| Step-free verified | Every check in sections 1 and 2 is Pass |
| Partially accessible | Entrance passes, but a check in sections 2 to 4 fails |
| Not accessible | The entrance or the only route to the workspace fails |
| Not verified | Any check in section 1 or 2 is Not verified |

Map these to OpenStreetMap tags when you can: `wheelchair=yes` for step-free verified, `limited` for partially accessible, `no` for not accessible, and leave the tag unset when not verified. Use `wheelchair:entrance` and `toilets:wheelchair` for the separate checks.

### Worked example

A cafe has a 9.5 cm step at the door and a ramp at the side. The ramp rises 30 cm over 3.6 m, which is a slope of 30 / 360 = 8.33 percent, at the limit. The ramp is 95 cm wide, the door clear opening is 78 cm, and the indoor corridor is 110 cm.

| Check | Result |
| --- | --- |
| Ramp slope 8.33 percent | Pass, since it is at most 1:12 |
| Ramp width 95 cm | Pass, since it is above 91.4 cm (36 in) |
| Entrance door 78 cm | Fail, since it is below 81.3 cm (32 in) |
| Corridor 110 cm | Pass |

The entrance fails, so the overall result is **Not accessible** and the OSM tag would be `wheelchair=no` until the door is widened or a wider door is found.

## Reviewing crowdsourced accessibility reports

WorkSphere has no accessibility report form. When a report arrives as an issue, comment or pull request, review it like this:

1. **Check the evidence.** A photo with a tape measure, a dated measurement, or a link to a map edit counts. "It seemed fine" does not.
2. **Check it covers the criteria.** A report that only says "has a ramp" supports one check and leaves the rest Not verified.
3. **Check the date.** Entrances change. Treat a report older than about two years as needing a recheck.
4. **Look for conflicts.** If two reports disagree, mark the venue Not verified and ask for a measurement.
5. **Prefer the stricter result** when unsure. A false "accessible" sends a person to a venue they cannot enter.
6. **Respect privacy.** Do not accept photos of other people, and keep personal details out of reports.

The generic amenity voting system (`AmenityValidation` and `AmenityVote`) accepts any amenity name, with a 5 vote minimum, hiding below 60 percent confidence and consensus at 80 percent. It is not wired to accessibility, and votes are not measurements, so do not use them as verification.

## Contributing a verified audit

1. Visit the venue or use dated measurements from the venue.
2. Fill in the rubric above, with each result Pass, Fail or Not verified and the measured value in mm or cm.
3. Open an issue or pull request with the rubric, photos of key measurements, the date, and your result.
4. If the venue is on OpenStreetMap, update the `wheelchair`, `wheelchair:entrance` and `toilets:wheelchair` tags there. The app reads them from OSM.
5. Never claim "fully accessible". State what you checked.

## Guidelines for developers

- Keep three states: accessible, not accessible and unknown. A boolean hides unknown.
- Do not convert missing data to `true` or to `false`.
- If you add a venue accessibility schema, store the result, the date, the source and the measured values.
- Keep the 8.33 percent and 91 cm values in the constants that already hold them.
- Update this guide with any change to thresholds.
