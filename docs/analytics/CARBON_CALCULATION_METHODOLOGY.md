# Carbon Calculation Methodology

The math behind `calculateCarbonSavings` in [`src/lib/analytics/carbonCalculator.ts`](../../src/lib/analytics/carbonCalculator.ts): constants, formulas, properties, and a step-by-step transit comparison. For the other calculators, date ranges and exports, see the [Commuter Carbon Savings Guide](./CARBON_SAVINGS_GUIDE.md).

## Scope

This document covers the mode calculator in `src/lib/analytics/carbonCalculator.ts`. It has no tests of its own, and **no other file in the app imports it today**. The dashboard (`CarbonFootprintTracker`), the carbon API and the profile cards use the other calculators listed in the guide. Read this as the reference for the function's behavior, not as a description of what the dashboard shows.

## Constants

| Constant | Value | Unit | Notes |
| --- | ---: | --- | --- |
| `EPA_ICE_GRAMS_PER_KM` | 251 | g CO₂e per km | Baseline for a gasoline passenger car. |
| `DEFAULT_TRANSIT_GRAMS_PER_KM` | 68 | g CO₂e per passenger km | Default for `transit`. |
| `foot` | 0 | g CO₂e per km | Default for `foot`. |
| `bike` | 0 | g CO₂e per km | Default for `bike`. |

The modes are `foot`, `bike` and `transit`. `getDefaultModeEmissionGramsPerKm(mode)` returns 0 for `foot` and `bike`, and 68 for anything else.

### Where 251 comes from

The constant is named for the EPA. The code does not cite a source, and I did not check it against a live EPA page. For context, the EPA's typical passenger vehicle figure is about 400 g CO₂ per mile, and 400 / 1.609344 is about 249 g/km, so 251 g/km is in that range. Use the number as the repository's baseline, not as a statement of the current EPA value.

### Units and conversions

| Conversion | Factor |
| --- | --- |
| grams to kilograms | divide by 1,000 |
| miles to kilometers | multiply by 1.609344 |
| g/mile to g/km | divide by 1.609344 |

Inputs are in kilometers and grams per kilometer. Outputs are in kilograms.

## Formulas

For distance `d` in km, a baseline rate `B` and a mode rate `M` (both g/km):

```text
d'      = d if d is a finite number greater than 0, otherwise 0
B       = iceEmissionGramsPerKm  ?? 251
M       = modeEmissionGramsPerKm ?? default(mode)

iceKg   = round4(d' × B / 1000)
modeKg  = round4(d' × M / 1000)
savedKg = round4(max(0, iceKg − modeKg))
percent = iceKg > 0 ? round1(savedKg / iceKg × 100) : 0
```

`round4` and `round1` round to 4 and 1 decimal places. `distanceKm` in the result is `d'` rounded to 3 decimal places.

Both overrides are optional. They use `??`, so `0` is a valid override (a zero-emission mode), while `undefined` falls back to the default. A `null` is not a valid input type.

## Properties

These follow from the formulas and are worth keeping when you change the code.

1. **Savings are never negative.** `savedKg` is `max(0, ...)`, so a mode that emits more than the baseline reports 0 saved, not a negative number. Example: `modeEmissionGramsPerKm: 300` against the 251 baseline over 10 km gives `modeEmissionsKg: 3`, `iceEmissionsKg: 2.51`, `savedKg: 0`.
2. **Percent is between 0 and 100.** Since `0 <= savedKg <= iceKg`, the ratio is in [0, 1]. With `iceKg = 0` the code returns 0 instead of dividing by zero.
3. **Linear in distance.** Before rounding, doubling `d'` doubles every kilogram value. The percent does not depend on distance, because `d'` cancels: `percent = (B − M) / B × 100` when `M < B`.
4. **Bad distances are safe.** Negative, `NaN`, `Infinity` and non-number distances become 0, so every output is 0.
5. **Rounding is applied to each value separately.** `savedKg` is computed from the already rounded `iceKg` and `modeKg`, so it can differ in the last digit from `round4(d' × (B − M) / 1000)`.

Closed form for a mode that beats the baseline: `savedKg ≈ d' × (B − M) / 1000`, and `percent ≈ (B − M) / B × 100`. With the defaults, transit saves `(251 − 68) / 251 = 72.9` percent regardless of distance.

## Walkthrough: comparing transit modes on a 10 km commute

Baseline `B = 251` g/km, so the car emits `10 × 251 / 1000 = 2.51` kg.

| Step | foot | bike | transit |
| --- | ---: | ---: | ---: |
| Mode rate `M` (g/km) | 0 | 0 | 68 |
| `modeKg = 10 × M / 1000` | 0 | 0 | 0.68 |
| `iceKg` | 2.51 | 2.51 | 2.51 |
| `savedKg = iceKg − modeKg` | 2.51 | 2.51 | 1.83 |
| `percent = savedKg / iceKg × 100` | 100 | 100 | 72.9 |

Reading it: walking or cycling avoids the full 2.51 kg, and transit avoids 1.83 kg, about 73 percent.

### With a custom baseline

Using the 170 g/km baseline from the offset summary calculator for a 10 km bike trip:

```typescript
calculateCarbonSavings({
  distanceKm: 10,
  mode: "bike",
  iceEmissionGramsPerKm: 170,
});
// iceEmissionsKg: 1.7, modeEmissionsKg: 0, savedKg: 1.7, savingsPercent: 100
```

### With rounding

A 3.333 km transit trip:

```text
iceKg   = round4(3.333 × 251 / 1000) = round4(0.836583) = 0.8366
modeKg  = round4(3.333 × 68  / 1000) = round4(0.226644) = 0.2266
savedKg = round4(0.8366 − 0.2266)    = 0.61
percent = round1(0.61 / 0.8366 × 100) = 72.9
```

## How other tables compare

The same trip uses different numbers in different calculators. Rates are g CO₂e per km.

| Mode | Mode calculator (this doc) | Dashboard (`carbonEngine`) | Venue commute estimator | Offset summary |
| --- | ---: | ---: | ---: | ---: |
| Walking | 0 | 0 | 0 | 0 |
| Cycling | 0 | 0 | 4 | 0 |
| Electric scooter | none | 12 | none | none |
| Public transit | 68 | 35 | 32 | 60 |
| Electric vehicle | none | 48 | 48 | 50 |
| Gasoline car baseline | 251 | 172 | 171 | 170 |

### Rail and micro-mobility

- **Rail:** no calculator has a separate rail factor. Rail and bus both fall under the single transit rate in each table.
- **Micro-mobility:** only the dashboard table has an electric scooter (12 g/km). The mode calculator has no scooter mode.

### PUE and green venues

The issue asks about Power Usage Effectiveness (PUE) ratings for green certified venues. **There is no PUE value or energy-based venue calculation anywhere in the code.** The only green signal is the boolean `isGreenCertifiedVenue` on a commute record in `carbonEngine.ts`, which is counted per venue visited and feeds a badge that is marked verified after 3 green venue visits. It does not change any kilogram figure.

## Changing the calculator

1. Edit the constant or formula in `src/lib/analytics/carbonCalculator.ts`.
2. Keep the three properties above: no negative savings, percent in [0, 100], safe bad input.
3. Update the tables and worked examples in this document.
4. Decide whether the other calculators should move too. See the "Known inconsistencies" section of the [guide](./CARBON_SAVINGS_GUIDE.md).
