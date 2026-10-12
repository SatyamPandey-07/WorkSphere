# `useCommuteEstimator`: Multimodal Transit Times & Carbon Footprint Calculation

This document details the architectural design, multimodal parameters, carbon calculation constants, OSRM routing fallbacks, and UI badge integration for the **`useCommuteEstimator`** custom React hook ([`src/hooks/useCommuteEstimator.ts`](../../src/hooks/useCommuteEstimator.ts)) and its underlying carbon evaluation engine ([`src/lib/commute/carbonEstimator.ts`](../../src/lib/commute/carbonEstimator.ts)).

---

## 1. Overview & System Architecture

In WorkSphere, remote workers and digital nomads frequently evaluate coworking venues based not only on desk availability and Wi-Fi speed, but on **commute friction** and **environmental impact**.

The `useCommuteEstimator` hook provides:

1. **Multimodal Travel Time Estimation:** Calculates trip durations across 6 distinct transit modalities (Walking, Cycling/E-Bike, Public Transit, EV, Gasoline Car, and Scooter/Motorcycle).
2. **Carbon Lifecycle Footprint Modeling:** Derives tailpipe and energy grid emissions per trip, weekly totals, and annual projections compared to an internal combustion engine (ICE) car baseline.
3. **Tree Offset & Ecological Scoring:** Translates avoided emissions into tree-year absorption equivalents and a $0\text{--}100\%$ eco-score tier.
4. **Geolocation Lifecycle Management:** Automatically requests browser geolocation on mount with offline coordinates fallback and `localStorage` mode persistence.
5. **Dual Distance Resolution Engine:** Combines OSRM (Open Source Routing Machine) network routing with an offline-resilient $1.25\times$ urban circuity Haversine fallback.

```mermaid
flowchart TD
    subgraph Inputs["Origin & Destination Inputs"]
        UserLoc["User Coordinates (origin)<br/>navigator.geolocation or custom origin"]
        VenueLoc["Venue Coordinates (destination)<br/>venueLatitude, venueLongitude"]
        Mode["Active Travel Mode<br/>(walking | cycling | transit | ev | car)"]
    end

    subgraph DistanceEngine["Distance Resolution Layer"]
        OSRM{"OSRM Network Routing<br/>(NEXT_PUBLIC_OSRM_URL)"}
        OSRM -->|Success| RouteDist["Street Network Distance (km)<br/>Turn-by-Turn Waypoints"]
        OSRM -->|Timeout / Offline / 429| HaversineFallback["Haversine Geodesic Distance<br/>&times; 1.25 Urban Detour Factor"]
    end

    subgraph CarbonEngine["Carbon & Calorie Engine (carbonEstimator.ts)"]
        Speed["Speed Matrix (speedKmh)<br/>+ Fixed Buffer Minutes"]
        CO2Math["Emissions: d &times; co2GramsPerKm<br/>Baseline: 171 g/km (Gasoline Car)"]
        TreeMath["Tree Offset: Annual Saved CO2 / 21.77 kg<br/>Calorie Burn: d &times; 2 &times; cal/km"]
    end

    subgraph UIOutput["Reactive Hook Output"]
        ActiveEst["activeEstimate: duration, CO2, calories, ecoTier"]
        AllEst["allEstimates: Record<CommuteMode, CommuteEstimate>"]
        Badge["Commute Time & Eco Badge Overlay"]
    end

    UserLoc --> DistanceEngine
    VenueLoc --> DistanceEngine
    RouteDist --> CarbonEngine
    HaversineFallback --> CarbonEngine
    Mode --> CarbonEngine
    CarbonEngine --> ActiveEst
    CarbonEngine --> AllEst
    ActiveEst --> Badge
```

---

## 2. Hook API Reference

### 2.1 Parameters (`UseCommuteEstimatorOptions`)

```typescript
export interface UseCommuteEstimatorOptions {
  venueLatitude: number;
  venueLongitude: number;
  venueName?: string;
  initialMode?: CommuteMode;
  initialOrigin?: { latitude: number; longitude: number } | null;
}
```

| Parameter        | Type                              |   Default   | Description                                                                                     |
| :--------------- | :-------------------------------- | :---------: | :---------------------------------------------------------------------------------------------- |
| `venueLatitude`  | `number`                          | _Required_  | Destination venue latitude in decimal degrees.                                                  |
| `venueLongitude` | `number`                          | _Required_  | Destination venue longitude in decimal degrees.                                                 |
| `venueName`      | `string`                          | `undefined` | Optional venue name for notifications and accessibility labels.                                 |
| `initialMode`    | `CommuteMode`                     | `"transit"` | Default travel mode selected on first render before user preference is loaded.                  |
| `initialOrigin`  | `{ latitude, longitude } \| null` |   `null`    | Pre-defined origin coordinates. If omitted, the hook queries browser geolocation automatically. |

### 2.2 Return Values (`UseCommuteEstimatorReturn`)

| Return Property           | Type                                           | Description                                                                                            |
| :------------------------ | :--------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `activeMode`              | `CommuteMode`                                  | Current selected travel mode (`"walking"`, `"cycling"`, `"transit"`, `"ev"`, `"car"`, `"motorcycle"`). |
| `setActiveMode`           | `(mode: CommuteMode) => void`                  | Updates active mode and persists choice to `localStorage` (`"worksphere:preferred_commute_mode"`).     |
| `activeEstimate`          | `CommuteEstimate \| null`                      | Computed travel time, CO₂ emissions, calories, and eco metrics for the active mode.                    |
| `allEstimates`            | `Record<CommuteMode, CommuteEstimate> \| null` | Map of calculated estimates across all 6 modes simultaneously for modal comparison tables.             |
| `userCoords`              | `{ latitude, longitude } \| null`              | Current resolved origin coordinates (GPS or fallback offset).                                          |
| `isLoadingLocation`       | `boolean`                                      | `true` while awaiting browser geolocation resolution.                                                  |
| `locationError`           | `string \| null`                               | Geolocation error message if permission is denied or timed out.                                        |
| `requestCurrentLocation`  | `() => Promise<void>`                          | Imperatively re-triggers geolocation prompt.                                                           |
| `workDaysPerWeek`         | `number`                                       | Number of weekly commute roundtrips for projections (default: `5`).                                    |
| `setWorkDaysPerWeek`      | `(days: number) => void`                       | Updates the weekly schedule multiplier ($1\text{--}7\text{ days}$).                                    |
| `showWeeklyProjection`    | `boolean`                                      | Toggle flag for weekly/annual savings view.                                                            |
| `setShowWeeklyProjection` | `(show: boolean) => void`                      | Setter for weekly/annual projection view.                                                              |

---

## 3. Supported Travel Modes Specification

WorkSphere models six distinct travel modes in `COMMUTE_MODES`:

| Mode Key         | Label                    | Icon | Speed ($\text{km/h}$) | Tailpipe & Lifecycle $\text{CO}_2$ ($\text{g/km}$) | Calorie Burn ($\text{cal/km}$) | Departure Buffer | Environmental Impact & Tier                                                                         |
| :--------------- | :----------------------- | :--: | :-------------------: | :------------------------------------------------: | :----------------------------: | :--------------: | :-------------------------------------------------------------------------------------------------- |
| **`walking`**    | **Walking**              |  🚶  |         $4.8$         |                  **$0\text{ g}$**                  |              $55$              |  $0\text{ min}$  | **`zero_emission` (100% Eco):** Zero tailpipe and zero grid footprint. Maximum health boost.        |
| **`cycling`**    | **Bicycle / E-Bike**     |  🚲  |        $16.0$         |                  **$4\text{ g}$**                  |              $35$              |  $2\text{ min}$  | **`low_carbon` (98% Lower):** Near-zero emissions including e-bike battery grid charging lifecycle. |
| **`transit`**    | **Public Transit**       |  🚆  |        $28.0$         |                 **$32\text{ g}$**                  |              $12$              |  $5\text{ min}$  | **`low_carbon` (81% Lower):** Shared metro, electric light rail, and hybrid bus passenger average.  |
| **`ev`**         | **Electric Vehicle**     |  ⚡  |        $40.0$         |                 **$48\text{ g}$**                  |              $0$               |  $2\text{ min}$  | **`low_carbon` (72% Lower):** Zero tailpipe emissions; grid generation lifecycle equivalent.        |
| **`motorcycle`** | **Scooter / Motorcycle** |  🛵  |        $35.0$         |                 **$92\text{ g}$**                  |              $0$               |  $1\text{ min}$  | **`moderate` (46% Lower):** Lightweight single-rider motor vehicle baseline.                        |
| **`car`**        | **Gasoline Car**         |  🚗  |        $40.0$         |                 **$171\text{ g}$**                 |              $0$               |  $3\text{ min}$  | **`high_emission` (0% Reference):** EPA / DEFRA average gasoline passenger vehicle baseline.        |

---

## 4. Carbon Calculation Constants & Mathematical Model

### 4.1 Standard Environmental Constants

```typescript
export const GASOLINE_CAR_BASELINE_CO2_PER_KM = 171; // g CO2 / km (EPA / DEFRA passenger car)
export const TREE_ANNUAL_CO2_ABSORPTION_KG = 21.77; // Average mature tree absorbs ~21.77 kg CO2 / year
```

### 4.2 Mathematical Formulas

Given one-way street distance $d$ in kilometers and travel mode configuration $(v, E_{\text{co2}}, C_{\text{cal}}, t_{\text{buf}})$:

#### 1. Trip Duration

$$t_{\text{trip}} = \max\left(1, \operatorname{round}\left(\frac{d}{v} \cdot 60 + t_{\text{buf}}\right)\right) \quad (\text{minutes})$$

#### 2. Emissions & Cumulative Projections

$$\text{CO}_{2, \text{one-way}} = \operatorname{round}(d \cdot E_{\text{co2}}) \quad (\text{grams})$$

$$\text{CO}_{2, \text{round-trip}} = 2 \cdot \text{CO}_{2, \text{one-way}} \quad (\text{grams})$$

$$\text{CO}_{2, \text{weekly}} = \frac{\text{CO}_{2, \text{round-trip}} \cdot W_{\text{days}}}{1000} \quad (\text{kg})$$

$$\text{CO}_{2, \text{annual}} = \text{CO}_{2, \text{weekly}} \cdot 48 \quad (\text{kg, assuming 48 working weeks/year})$$

#### 3. Avoided Carbon vs. Gasoline Car Baseline

$$\Delta\text{CO}_{2, \text{round-trip}} = \max\left(0, (2 \cdot d \cdot 171) - \text{CO}_{2, \text{round-trip}}\right) \quad (\text{grams})$$

$$\Delta\text{CO}_{2, \text{annual}} = \max\left(0, \text{CO}_{2, \text{car, annual}} - \text{CO}_{2, \text{annual}}\right) \quad (\text{kg})$$

#### 4. Tree Absorption Equivalency

$$\text{Trees Equivalent} = \frac{\Delta\text{CO}_{2, \text{annual}}}{21.77}$$

#### 5. Eco-Friendliness Score

$$\text{EcoScore} = \max\left(0, \min\left(100, \operatorname{round}\left(100 - \frac{E_{\text{co2}}}{171} \cdot 100\right)\right)\right)\%$$

---

## 5. OSRM API Routing & Fallback Strategies

WorkSphere routes commute requests through a multi-tiered routing cascade:

```
Tier 1: OSRM Local Engine (NEXT_PUBLIC_OSRM_URL)
   ↓ (Network Failure / Unconfigured)
Tier 2: Public OSRM Router (https://router.project-osrm.org)
   ↓ (Rate Limit HTTP 429 / Timeout > 5000ms / Offline)
Tier 3: Haversine Great-Circle Geodesic × 1.25 Urban Detour Factor
```

### 5.1 OSRM Profile Mapping

OSRM profiles match travel modes:

- `walking` $\to$ `foot`
- `cycling` $\to$ `bike`
- `car`, `ev`, `motorcycle`, `transit` $\to$ `driving`

### 5.2 The 1.25x Urban Detour Factor Fallback

When a user is offline, roaming, or OSRM times out, the distance is calculated geometrically via the **Haversine formula**:

$$\Delta\phi = \frac{(\text{lat}_2 - \text{lat}_1)\pi}{180}, \quad \Delta\lambda = \frac{(\text{lon}_2 - \text{lon}_1)\pi}{180}$$

$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\text{lat}_1 \cdot \pi/180)\cos(\text{lat}_2 \cdot \pi/180)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$

$$d_{\text{geodesic}} = 2 R \cdot \operatorname{atan2}(\sqrt{a}, \sqrt{1 - a}), \quad R = 6371\text{ km}$$

Because streets follow Manhattan grids and winding terrain rather than straight lines, an empirical **$1.25\times$ urban circuity factor** is applied:

$$d_{\text{urban}} = \operatorname{round}(d_{\text{geodesic}} \cdot 1.25 \cdot 100) / 100$$

This yields an estimation accuracy within $\pm 7\%$ of actual road distance across European, North American, and Asian metro areas without making a single network request.

---

## 6. Code Example: Commute Time Badge Integration

The following component demonstrates how to embed a compact, accessible commute time and carbon savings badge inside venue cards and search result rows:

```tsx
"use client";

import React from "react";
import { Clock, Leaf, AlertCircle } from "lucide-react";
import { useCommuteEstimator } from "@/hooks/useCommuteEstimator";
import { type CommuteMode } from "@/lib/commute/carbonEstimator";

interface VenueCommuteBadgeProps {
  venueLatitude: number;
  venueLongitude: number;
  venueName?: string;
}

export function VenueCommuteBadge({
  venueLatitude,
  venueLongitude,
  venueName = "Venue",
}: VenueCommuteBadgeProps) {
  const {
    activeMode,
    setActiveMode,
    activeEstimate,
    isLoadingLocation,
    locationError,
  } = useCommuteEstimator({
    venueLatitude,
    venueLongitude,
    venueName,
    initialMode: "transit",
  });

  if (isLoadingLocation) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 animate-pulse">
        <Clock className="w-3.5 h-3.5" />
        Calculating commute…
      </span>
    );
  }

  if (!activeEstimate) {
    return null;
  }

  const modes: CommuteMode[] = ["walking", "cycling", "transit", "car"];

  return (
    <div
      role="region"
      aria-label={`Commute estimate for ${venueName}`}
      className="inline-flex items-center gap-2 p-1 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs shadow-xs"
    >
      {/* Mode Selector Buttons */}
      <div className="flex items-center gap-0.5">
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setActiveMode(mode)}
            title={`Switch to ${mode}`}
            aria-pressed={activeMode === mode}
            className={`px-1.5 py-0.5 rounded-md text-xs transition-colors ${
              activeMode === mode
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs font-semibold"
                : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
          >
            {mode === "walking" && "🚶"}
            {mode === "cycling" && "🚲"}
            {mode === "transit" && "🚆"}
            {mode === "car" && "🚗"}
          </button>
        ))}
      </div>

      {/* Commute Time Readout */}
      <div className="flex items-center gap-1 font-semibold text-zinc-800 dark:text-zinc-200 pr-1">
        <Clock className="w-3.5 h-3.5 text-zinc-400" />
        <span>{activeEstimate.durationFormatted}</span>
        <span className="text-zinc-400 font-normal">
          ({activeEstimate.distanceKm} km)
        </span>
      </div>

      {/* Eco Savings Pill */}
      <span
        title={activeEstimate.ecoBadgeText}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${activeEstimate.ecoColorClass}`}
      >
        <Leaf className="w-3 h-3" />
        <span>
          {activeEstimate.co2SavedVsCarGramsRoundTrip > 0
            ? `-${(activeEstimate.co2SavedVsCarGramsRoundTrip / 1000).toFixed(1)}kg CO₂`
            : "Baseline"}
        </span>
      </span>

      {locationError && (
        <span title={locationError} className="text-amber-500">
          <AlertCircle className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  );
}
```
