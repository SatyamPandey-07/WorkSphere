# Venue Carbon Footprint Methodology and Emission Factors

How WorkSphere estimates venue energy use and emissions, how eco badges are awarded, and how to add a new telemetry signal. It describes what the code does today and marks where the issue's topics have no implementation yet.

Commute emissions are covered elsewhere: see the [Commuter Carbon Savings Guide](./CARBON_SAVINGS_GUIDE.md), the [Carbon Calculation Methodology](./CARBON_CALCULATION_METHODOLOGY.md) and the [GHG Scope 3 Methodology](../sustainability/ghg-scope-3-methodology.md). This guide covers the venue side.

## What exists and what does not

| Topic from the issue | In the code today |
| --- | --- |
| Energy use from HVAC, lighting and computing | No equipment model. The only energy signal is a `powerKw` reading in venue telemetry samples. |
| Regional grid emission factors by country | None. No lookup table or grid intensity value exists. |
| Venue emissions in kg CO₂e | `CarbonFootprintTracker` displays a `carbonKg` value passed in by the caller. Nothing computes it. |
| Eco badges from verified renewable energy | No renewable energy data. Badges use a caller-supplied boolean or commute totals. |
| Sensor developer guide | See [Adding a telemetry signal](#adding-a-telemetry-signal). |

The sections below document the pieces that do exist, then give the formulas a future implementation would follow.

## Where the code lives

| Concern | File |
| --- | --- |
| Energy vs baseline display | [`src/components/analytics/CarbonFootprintTracker.tsx`](../../src/components/analytics/CarbonFootprintTracker.tsx) |
| Telemetry aggregation and anomalies | [`src/lib/telemetry/venueTelemetryEngine.ts`](../../src/lib/telemetry/venueTelemetryEngine.ts) |
| Telemetry card | [`src/components/telemetry/VenueTelemetryCard.tsx`](../../src/components/telemetry/VenueTelemetryCard.tsx) |
| Workspace badges and ESG records | [`src/lib/sustainability/carbonEngine.ts`](../../src/lib/sustainability/carbonEngine.ts) |
| Cumulative milestone badges | [`src/app/api/sustainability/track/route.ts`](../../src/app/api/sustainability/track/route.ts) |
| Eco points and badge ladder | [`src/core/sustainability/CarbonCreditMinter.ts`](../../src/core/sustainability/CarbonCreditMinter.ts) |

## Energy use against a baseline

### The tracker component

`CarbonFootprintTracker` is a display component. Its props are `actualKwh`, `baselineKwh`, and optionally `carbonKg`, `venueName`, `periodLabel` and `className`.

```text
safeActual   = actualKwh if finite, clamped to 0 or more, otherwise 0
safeBaseline = baselineKwh if finite and above 0, otherwise 1
rawPercent   = safeActual / safeBaseline × 100
barWidth     = clamp(rawPercent, 0, 100)
over         = rawPercent > 100
overagePct   = round(rawPercent − 100)
```

The progress bar is emerald at or below the baseline and amber above it. When `over` is true the card shows "+N% above baseline". When `carbonKg` is a finite number it is printed as "Estimated emissions: N kg CO₂e". The component does no emission math.

### The telemetry engine

`aggregateVenueTelemetry(samples, baselineKwh = 1000)` uses the same percentages for a list of samples. Each sample can hold `downloadMbps`, `uploadMbps`, `latencyMs`, `noiseDb`, `powerKw` and `timestampMs`. Values that are not finite and non-negative are skipped.

```text
estimatedKwh         = sum of every valid powerKw
baselineUsagePercent = round1(estimatedKwh / baseline × 100)
clampedBarPercent    = clamp(baselineUsagePercent, 0, 100)
overagePercent       = max(0, round(baselineUsagePercent − 100))
```

**Unit caveat:** `estimatedKwh` is the plain sum of kW readings. It does not multiply by time, and `timestampMs` is not used. The number is a true kWh figure only when samples are exactly one hour apart. For other intervals, convert first (see the formulas below).

## Formulas for a full estimate

These are the standard relationships. The repository does not implement them, so treat them as the method to follow when you add the feature.

Energy over a session of `T` hours, for each load `i` with average power `P_i` (kW):

```text
E_kWh = Σ ( P_i × h_i )
E_kWh = Σ ( P_j × Δt_j )        when using power samples, Δt in hours
```

Typical load groups are HVAC, lighting and computing equipment. Each is metered or estimated separately and summed.

Location-based emissions:

```text
CO2e_kg = E_kWh × EF_grid
```

`EF_grid` is the grid emission factor in kg CO₂e per kWh for the venue's region and year. It must come from a cited source and be stored with its year and region.

Intensity per desk-hour, a useful comparison between venues:

```text
intensity = CO2e_kg / (desks × hours)
```

### Sample calculation: an 8-hour co-working session

Eight hourly power readings from a venue meter, in kW: 12, 13, 14, 15, 15, 14, 13, 12, with a baseline of 120 kWh.

| Step | Calculation | Result |
| --- | --- | ---: |
| Energy | 12 + 13 + 14 + 15 + 15 + 14 + 13 + 12 (each reading covers one hour) | 108 kWh |
| Percent of baseline | 108 / 120 × 100 | 90 percent |
| Above baseline? | 90 is not above 100 | no |
| Mean power | 108 / 8 | 13.5 kW |
| Surge threshold | 13.5 × 1.6 | 21.6 kW |

`aggregateVenueTelemetry` returns `baselineUsagePercent: 90`, `overagePercent: 0` and no anomalies for these samples. Adding a ninth reading of 40 kW lifts the mean to 16.44 kW, so the surge threshold is 26.3 kW, and the engine flags the 40 kW reading as "Power draw surge above rolling mean".

For the emissions step, assume a grid factor of **0.4 kg CO₂e per kWh**. This value is an assumption for the example only and is not a repository constant:

```text
CO2e_kg   = 108 × 0.4 = 43.2 kg
intensity = 43.2 / (40 desks × 8 h) = 0.135 kg per desk-hour
```

The 40 desks figure is also an assumption. Pass `43.2` as `carbonKg` to show it on the tracker.

## Regional emission factors

No country or territory factor table exists in the code. Do not hardcode numbers from memory when you add one. Use this process:

1. Pick the accounting method. Location-based uses the average grid factor of the venue's region. Market-based uses supplier or certificate specific factors. The GHG Protocol Scope 2 Guidance defines both.
2. Take factors from a published dataset for the venue's country or grid region, and record the dataset name, year and URL beside each value.
3. Store the factor with its unit (kg CO₂e per kWh), region code (ISO 3166) and year.
4. Fall back to a clearly labeled default when a region is missing, and show that in the interface.
5. Update the year at least annually. Grid factors change as the generation mix changes.

## Eco-certification badges

Three separate badge systems exist. None of them verifies renewable energy usage.

### Workspace badges (`carbonEngine.ts`)

| Badge | Rule |
| --- | --- |
| `b-zero-emissions` | walking plus cycling distance is at least 70 percent of total distance |
| `b-solar-patron` | `greenVenuesVisitedCount` is at least 3 |
| `b-climate-positive` | total avoided emissions are at least 25,000 g (25 kg) |

`greenVenuesVisitedCount` counts commute records where `isGreenCertifiedVenue` is true. That flag is a boolean supplied by the caller (the carbon footprint API reads it from the request records with `Boolean(...)`). The code does not check a certificate, a renewable energy share or any meter data. The badge description says "100% solar and green-grid powered", but the code only counts the flag.

### Cumulative milestone tiers (`/api/sustainability/track`)

| Tier | Total offset |
| --- | --- |
| Bronze Eco-Nomad | 10 kg or more |
| Silver Eco-Nomad | 50 kg or more |
| Gold Eco-Nomad | 100 kg or more |
| Emerald Eco-Nomad | 250 kg or more |

The route currently uses a fixed `totalOffsetKg` of 125.5 and a commented-out database write, so every request resolves to Gold. It is a placeholder, not a real running total.

### Eco points and badge ladder (`CarbonCreditMinter.ts`)

Eco points are `floor(gramsSaved / 100)`. Badges unlock when the running total of grams saved reaches the threshold.

| Badge | Grams saved |
| --- | ---: |
| First Green Mile | 500 |
| Eco-Nomad Bronze | 2,500 |
| Eco-Nomad Silver | 10,000 |
| Emerald Eco Champion | 50,000 |

Note that the Bronze, Silver and Emerald names appear in both this ladder and the milestone tiers above, with different thresholds (for example Silver is 10 kg here and 50 kg there).

## Adding a telemetry signal

Follow these steps to add a venue sensor reading, for example a CO₂ concentration or a sub-meter for HVAC.

1. **Add the field to the sample type.** Add an optional numeric field to `VenueTelemetrySample` in `venueTelemetryEngine.ts`, with the unit in its name (for example `hvacKw`).
2. **Validate it.** Reuse the existing finite and non-negative check so bad readings are skipped, not summed.
3. **Aggregate it.** Add a running sum and count in `aggregateVenueTelemetry`, then add an `avg...` field to `AggregatedVenueTelemetry`. Return 0 when there are no valid readings.
4. **Convert units.** If the field is power in kW, multiply by the interval in hours before adding it to an energy total. Do not repeat the plain-sum shortcut.
5. **Add anomaly rules** to `detectTelemetryAnomalies` if the signal needs thresholds, and add the metric name to the `TelemetryAnomaly` union.
6. **Show it.** Render the value in `VenueTelemetryCard` and add a `data-testid`.
7. **Test it.** Extend `src/__tests__/lib/telemetry/venueTelemetryEngine.test.ts` with valid, empty, negative and `NaN` cases.
8. **Document it.** Add the field, unit and formula to this guide.

## References

- GHG Protocol, *Corporate Accounting and Reporting Standard*, World Resources Institute and World Business Council for Sustainable Development.
- GHG Protocol, *Scope 2 Guidance*, 2015. Defines location-based and market-based electricity emissions.
- US EPA, *Greenhouse Gases Equivalencies Calculator*, for emissions equivalency conventions.
- Grid emission factor datasets for a region (for example national grid operators, the IEA, or the EPA eGRID database for the United States). Pick one per region and cite it where you use it.

The repository does not link to specific dataset versions, so check each source for the current edition before using a number.
