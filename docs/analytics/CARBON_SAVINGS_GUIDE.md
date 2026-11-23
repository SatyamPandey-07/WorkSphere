# Commuter Carbon Savings Calculation and Emissions Offset Guide

## Overview

WorkSphere estimates how much CO₂e a member avoids by reaching a workspace without driving a gasoline car. The estimate powers the carbon analytics dashboard (`CarbonFootprintTracker`), the venue commute estimator, the team carbon badges, and the Scope 3 ESG exports.

This guide explains the emission factor baselines, the formulas, the date range presets, and the export formats, and points to the code that implements each one. It is written for contributors changing the calculators and for ESG analysts who need to know exactly how a number was produced.

For the GHG Protocol framing and the ESG audit CSV contract, see the [Scope 3 methodology](../sustainability/ghg-scope-3-methodology.md). For the commute estimator hook, see the [`useCommuteEstimator` reference](../hooks/useCommuteEstimator.md).

## Units and conventions

| Term | Meaning |
| --- | --- |
| **g CO₂e / km** | Grams of CO₂ equivalent emitted per kilometre travelled by one person. |
| **kg CO₂e** | Kilograms of CO₂ equivalent. 1 kg = 1,000 g. |
| **Baseline** | The emissions of the same trip made by a gasoline passenger car. |
| **Avoided emissions** | Baseline emissions minus the emissions of the mode actually used, never below zero. |
| **Tree equivalent** | Avoided emissions divided by the CO₂ a mature tree absorbs (see [Tree equivalents](#tree-equivalents)). |

Every calculator clamps negative, `NaN`, and infinite distances to 0 before doing any arithmetic, so a bad distance produces 0 g instead of an error.

## Where the code lives

| Area | File | What it does |
| --- | --- | --- |
| Analytics dashboard factors and aggregation | [`src/lib/sustainability/carbonEngine.ts`](../../src/lib/sustainability/carbonEngine.ts) | Per-trip emissions, monthly summary, team ranking, badge SVG, ESG CSV. |
| Dashboard UI | [`src/components/analytics/CarbonFootprintTracker.tsx`](../../src/components/analytics/CarbonFootprintTracker.tsx) | Date presets, exports, badge download. |
| Dashboard data API | [`src/app/api/analytics/carbon-footprint/route.ts`](../../src/app/api/analytics/carbon-footprint/route.ts) | Date range filtering and ESG CSV export. |
| Venue commute estimator | [`src/lib/commute/carbonEstimator.ts`](../../src/lib/commute/carbonEstimator.ts) | Round-trip, weekly and annual estimates per mode. |
| Mode calculator | [`src/lib/analytics/carbonCalculator.ts`](../../src/lib/analytics/carbonCalculator.ts) | Kilograms saved for `foot`, `bike` and `transit` trips against a 251 g/km baseline. Not imported by any other file today. See the [methodology](./CARBON_CALCULATION_METHODOLOGY.md). |
| Offset summary calculator | [`src/lib/sustainability/carbonCalculator.ts`](../../src/lib/sustainability/carbonCalculator.ts) | kg saved and tree equivalents per trip list. |

## Emission factor baselines

The repository currently keeps **four separate factor tables**. They agree on the shape of the calculation but not on every number, so check which one a screen uses before comparing values.

### Analytics dashboard (`carbonEngine.ts`)

Used by `CarbonFootprintTracker`, the carbon footprint API, team badges, and the ESG CSV.

| Mode | g CO₂e / km |
| --- | ---: |
| `WALKING` | 0 |
| `BICYCLING` | 0 |
| `ELECTRIC_SCOOTER` | 12 |
| `PUBLIC_TRANSIT` | 35 |
| `ELECTRIC_VEHICLE` | 48 |
| `GASOLINE_CAR` (baseline) | 172 |

### Venue commute estimator (`commute/carbonEstimator.ts`)

Used by `useCommuteEstimator` and the venue commute estimator UI. The gasoline car baseline is **171 g CO₂e/km (0.171 kg CO₂e/km)**, described in the code as the EPA / DEFRA average for a gasoline passenger vehicle.

| Mode | g CO₂e / km |
| --- | ---: |
| `walking` | 0 |
| `cycling` | 4 |
| `transit` | 32 |
| `ev` | 48 |
| `motorcycle` | 92 |
| `car` (baseline) | 171 |

### Mode calculator (`analytics/carbonCalculator.ts`)

Not imported by any other file today. The default baseline for an internal combustion engine car is **251 g/km** (`EPA_ICE_GRAMS_PER_KM`), and callers can override it with `iceEmissionGramsPerKm`. Full formulas, properties and a worked comparison are in the [Carbon Calculation Methodology](./CARBON_CALCULATION_METHODOLOGY.md).

| Mode | g CO₂e / km |
| --- | ---: |
| `foot` | 0 |
| `bike` | 0 |
| `transit` | 68 |
| ICE car (baseline) | 251 |

### Offset summary calculator (`sustainability/carbonCalculator.ts`)

Used by the profile overview and nomad stats cards. The baseline is **170 g CO₂e/km**.

| Mode | g CO₂e / km |
| --- | ---: |
| `walking` | 0 |
| `cycling` | 0 |
| `electric_vehicle` | 50 |
| `public_transit` | 60 |
| `gasoline_car` (baseline) | 170 |

### Known inconsistencies

The baselines differ between 170 and 251 g/km, and public transit ranges from 32 to 68 g/km depending on the file. Numbers shown on different screens can therefore disagree for the same trip. Until the tables are consolidated into one shared module, a contributor who changes a factor should update every table that represents the same mode and mention it in the pull request.

## Formulas

### Avoided emissions for one trip (dashboard)

For a trip of `d` kilometres in mode `m`, with factor `EF(m)` and baseline `EF(GASOLINE_CAR)`:

```text
emissions_g = round(d × EF(m))
baseline_g  = round(d × EF(GASOLINE_CAR))
avoided_g   = max(0, baseline_g − emissions_g)
```

Rounding happens per trip, before trips are summed. This is implemented by `calculateCommuteEmissions` in `carbonEngine.ts`.

Worked example, an 8.2 km trip by public transit:

```text
emissions_g = round(8.2 × 35)  = 287
baseline_g  = round(8.2 × 172) = 1,410
avoided_g   = 1,410 − 287      = 1,123  (1.12 kg CO₂e)
```

### Remote and on-site sessions

A trip with a distance of 0 km has 0 g of emissions and 0 g of avoided emissions, because both are proportional to distance. Booking a workspace close to home or working from a nearby workspace instead of driving to a distant office therefore shows up as a shorter distance in the chosen mode. There is no separate "remote desk occupancy" factor in the code: a remote desk session is credited only through the commute distance and mode recorded for that visit.

### Transit mode differentials

Avoided emissions per kilometre compared with the dashboard baseline of 172 g/km:

| Mode | Avoided g CO₂e / km | Share of baseline avoided |
| --- | ---: | ---: |
| Walking or bicycling | 172 | 100% |
| Electric scooter | 160 | 93% |
| Public transit | 137 | 80% |
| Electric vehicle | 124 | 72% |

### Monthly or period summary

`generateMonthlyCarbonSummary` adds up the per-trip figures:

```text
totalDistanceKm       = Σ d
totalEmissionsKgCo2   = Σ emissions_g / 1000
totalAvoidedKgCo2     = Σ avoided_g / 1000
treesEquivalentOffset = totalAvoided_g / 1000 / 1.8
```

Mode breakdown rows use `emissionsKgCo2 = distanceKm × EF(mode) / 1000` and `percentage = round(distanceKm / totalDistanceKm × 100)`.

Worked example with four trips:

| Trip | Mode | km | Emissions (g) | Avoided (g) |
| --- | --- | ---: | ---: | ---: |
| 1 | Walking | 2.4 | 0 | 413 |
| 2 | Bicycling | 5.8 | 0 | 998 |
| 3 | Public transit | 8.2 | 287 | 1,123 |
| 4 | Electric scooter | 3.5 | 42 | 560 |
| **Total** | | **19.9** | **329** | **3,094** |

That gives 0.33 kg emitted, 3.09 kg avoided, and `3.094 / 1.8 = 1.7` tree equivalents.

### Round-trip, weekly and annual estimates (venue commute estimator)

`estimateCommuteForMode` assumes a return journey, a configurable number of work days per week (default 5, clamped to 1–7), and 48 working weeks per year:

```text
co2_trip_g       = round(d × EF(m))
co2_roundtrip_g  = co2_trip_g × 2
co2_weekly_kg    = round(co2_roundtrip_g × days / 10) / 100
co2_annual_kg    = round(co2_weekly_kg × 48 × 10) / 10

car_roundtrip_g  = round(d × 2 × 171)
car_annual_kg    = car_roundtrip_g × days × 48 / 1000
saved_annual_kg  = round(max(0, car_annual_kg − co2_annual_kg) × 10) / 10
trees            = round(saved_annual_kg / 21.77 × 10) / 10
```

The eco score is `round(100 − EF(m) / 171 × 100)`, clamped to 0–100. Tier thresholds: 0 g/km is `zero_emission`, up to 50 g/km is `low_carbon`, 150 g/km or more is `high_emission`, and everything else is `moderate`.

Worked example, 10 km each way by transit (32 g/km), 5 days a week:

```text
co2_roundtrip_g = 10 × 32 × 2     = 640
co2_weekly_kg   = 640 × 5 / 1000  = 3.2
co2_annual_kg   = 3.2 × 48        = 153.6
car_annual_kg   = 3,420 × 5 × 48 / 1000 = 820.8
saved_annual_kg = 820.8 − 153.6   = 667.2
trees           = 667.2 / 21.77   = 30.6
```

### Mode calculator (`calculateCarbonSavings`)

The mode calculator works in kilograms and takes optional rate overrides:

```text
iceKg   = round4(d × (iceEmissionGramsPerKm ?? 251) / 1000)
modeKg  = round4(d × (modeEmissionGramsPerKm ?? default(mode)) / 1000)
savedKg = round4(max(0, iceKg − modeKg))
```

`round4` rounds to four decimal places. See the [Carbon Calculation Methodology](./CARBON_CALCULATION_METHODOLOGY.md) for the properties and a step-by-step example.

### Tree equivalents

Tree equivalents use different constants depending on the calculator:

| Calculator | Divisor | Notes |
| --- | ---: | --- |
| Dashboard monthly summary | 1.8 kg per tree per month | About 21.7 kg per year, spread over 12 months. |
| Team savings (`aggregateTeamCarbonSavings`) | 21.77 kg per tree per year, × 12 | Applied to the monthly avoided kg when `treesEquivalent` is not supplied. |
| Venue commute estimator | 21.77 kg per tree per year | Applied to annual savings. |
| Offset summary calculator | 21 kg per tree per year | |

## Date range presets

`CarbonFootprintTracker` exposes four presets through `getCarbonDatePresetRange`, which returns local-time ISO dates (`YYYY-MM-DD`). With "today" being the current local date:

| Preset | Start date | End date | Days covered |
| --- | --- | --- | ---: |
| `7-days` | today − 7 | **yesterday** | 7 |
| `30-days` | today − 29 | today | 30 |
| `this-month` | 1st of the current month | today | 1 to 31 |
| `ytd` | 1 January of the current year | today | 1 to 366 |

The `7-days` preset ends yesterday, so it never includes today's partial data. The other presets include today. Users can also type any start and end date directly, which clears the active preset.

The dashboard sends the range to `GET /api/analytics/carbon-footprint?startDate=…&endDate=…`. The API accepts the range only when both values match `YYYY-MM-DD` and `startDate <= endDate`, and then keeps trips whose `date` falls inside it, inclusive of both ends. An invalid or missing range is ignored and all trips are used. The summary's `periodMonth` label is `"<startDate> to <endDate>"` for a valid range, otherwise the `month` query parameter.

> **Data provenance:** at the time of writing the API builds trips from the user's latest 20 bookings and assigns distance and mode from a rotating placeholder pattern. If fewer than four trips exist it substitutes four sample trips. The numbers on the dashboard are therefore illustrative until real commute distance and mode are captured per booking. ESG analysts should not treat them as audited measurements.

## Exports

### Scope 3 ESG report (server CSV)

`POST /api/analytics/carbon-footprint` with `{ summary, format: "csv" }` returns the CSV built by `exportCorporateESGReportCSV`. The columns are Booking ID, Workspace Venue, Date, Commute Distance (km), Transit Mode, Trip Emissions (g CO2), Avoided Emissions vs Driving (g CO2), and Green Certified Space, followed by total rows for distance, net emissions, avoided emissions, and tree equivalents. The download is named `WorkSphere-Scope3-ESG-Report-<period>.csv`, with the first space in the period label replaced by a hyphen.

### Dashboard CSV (client)

`handleExportCSV` builds a CSV in the browser with the columns Date, Venue, Commute Mode, Distance (km), CO2 (kg), and Offset Status. Values that start with `=`, `+`, `-`, or `@` are prefixed with a single quote to prevent spreadsheet formula injection, and every cell is quoted. The file is named `worksphere-carbon-report-YYYY-MM.csv` using the current month, not the selected range.

### Team carbon badge (SVG)

Teams are ranked by `monthlyAvoidedKgCo2` in `aggregateTeamCarbonSavings`. The badge tier comes from the rank, not from a threshold:

| Rank | Tier | Colour |
| --- | --- | --- |
| 1 | `EMERALD` | `#10b981` |
| 2 | `GOLD` | `#f59e0b` |
| 3 | `SILVER` | `#94a3b8` |
| 4 and below | `BRONZE` | `#cd7f32` |

`generateTeamBadgeSVG` returns a 600 × 360 SVG showing the team rank, name, regional hub, monthly CO₂e avoided, tree equivalent, and the reporting period. Team, hub, and period text is XML-escaped. `handleExportTeamBadge` downloads it as `worksphere-team-carbon-badge-<team-name>.svg`, where the team name is lower-cased and every run of characters outside `a-z` and `0-9` becomes a single hyphen.

## Changing the calculators

1. Update the factor in every table in [Emission factor baselines](#emission-factor-baselines) that represents the same mode.
2. Keep distance clamping (`safeParseDistance` or the equivalent) in front of any new arithmetic.
3. Round per trip before summing, as the existing code does, so totals match the rows in the exports.
4. Update the worked examples in this guide and the matching tests, for example `src/__tests__/lib/carbonCalculator.test.ts` for the offset summary calculator.
