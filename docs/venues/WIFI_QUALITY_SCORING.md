# Venue WiFi Quality Score and Bandwidth Tier Guide

How WorkSphere measures venue WiFi, turns the numbers into a score and a speed tier,
and shows the result to remote workers on venue cards and in search filters.

Each section is marked **Implemented** (behavior that exists in the code today) or
**Specified** (the behavior defined by issue #9426 that the UI should follow, not yet
present in the code). Read the status before relying on a number.

**Source files**

- [`src/lib/wifi/speedBenchmarkEngine.ts`](../../src/lib/wifi/speedBenchmarkEngine.ts): client measurement, jitter, stability score, network tier, bufferbloat grade
- [`src/components/wifi/ProofOfBandwidthModal.tsx`](../../src/components/wifi/ProofOfBandwidthModal.tsx): runs the benchmark and shows results
- [`src/components/ui/NoiseLevelBadge.tsx`](../../src/components/ui/NoiseLevelBadge.tsx): `MachSpeedBadge` and `getMachSpeedTier`
- [`src/components/VenueCard.tsx`](../../src/components/VenueCard.tsx): venue card badges
- [`src/components/venues/VenueFilterBar.tsx`](../../src/components/venues/VenueFilterBar.tsx): WiFi speed range filter
- [`src/types/venue.ts`](../../src/types/venue.ts): `VenueAmenities.wifiQuality`, `VenueAmenities.wifiSpeed`

---

## 1. Data model

**Implemented.** Venue WiFi data lives on `VenueAmenities`:

| Field | Type | Meaning |
|-------|------|---------|
| `wifi` | `boolean` | venue offers WiFi |
| `wifiQuality` | `number \| null` | community rating, 1 to 5 |
| `wifiSpeed` | `number \| null` | download speed in Mbps |

`wifiSpeed` is the input for every tier in this guide. A missing, non numeric, or
non positive value means "no data": show no tier badge instead of a lowest tier.

## 2. Speed tiers

**Specified.** Tiers are based on download speed in Mbps.

| Tier | Download speed | Typical use |
|------|----------------|-------------|
| Bronze | below 25 Mbps | email, messaging, light browsing |
| Silver | 25 up to (not including) 75 Mbps | video calls, cloud documents |
| Gold | 75 up to and including 150 Mbps | HD calls with screen share, large uploads |
| Ultra | above 150 Mbps | multiple heavy users, large file sync |

Boundaries: lower bound inclusive, so exactly 25 is Silver, exactly 75 is Gold, and
exactly 150 is still Gold.

Reference mapper:

```ts
export type WifiSpeedTier = "bronze" | "silver" | "gold" | "ultra";

export function getWifiSpeedTier(
  downloadMbps?: number | null,
): WifiSpeedTier | null {
  if (
    typeof downloadMbps !== "number" ||
    !Number.isFinite(downloadMbps) ||
    downloadMbps <= 0
  ) {
    return null;
  }
  if (downloadMbps < 25) return "bronze";
  if (downloadMbps < 75) return "silver";
  if (downloadMbps <= 150) return "gold";
  return "ultra";
}
```

### Existing classifications (Implemented)

Two other classifications already exist. They answer different questions, so do not
mix them up with the tiers above.

**Mach speed badge** (`getMachSpeedTier`), shown on venue cards when `wifiSpeed` is set:

| Tier | Download speed |
|------|----------------|
| `subsonic` | below 50 Mbps |
| `supersonic` | 50 to 250 Mbps |
| `hypersonic` | above 250 Mbps |

**Network suitability tier** (`classifyNetworkTier`), computed per benchmark run:

| Tier | Download | Upload | Latency | Jitter |
|------|---------:|-------:|--------:|-------:|
| `4K_CONFERENCING` | 45 Mbps or more | 15 Mbps or more | 35 ms or less | 6 ms or less |
| `HD_CONFERENCING` | 20 Mbps or more | 5 Mbps or more | 70 ms or less | 15 ms or less |
| `STANDARD_BROWSING` | 5 Mbps or more | any | 150 ms or less | any |
| `UNSTABLE` | anything else, or download or upload at 0 | | | |

## 3. Jitter, latency, and packet loss penalties

### Implemented: stability score

`SpeedBenchmarkRunner.runBenchmark()` computes a 0 to 100 `stabilityScore`:

```
jitterPenalty      = min(30, jitterMs * 2)
latencyPenalty     = min(30, (avgLatencyMs / 150) * 30)
bufferbloatPenalty = min(15, (bufferbloatDeltaMs / 50) * 15)
stabilityScore     = max(10, round(100 - jitterPenalty - latencyPenalty - bufferbloatPenalty))
```

Jitter here is the RFC 3550 estimate from `calculateRfc3550Jitter()`:
`J(i) = J(i-1) + (|D(i-1, i)| - J(i-1)) / 16`. The result also carries
`meanJitterMs`, the plain average of consecutive probe differences from
`calculateMeanAbsoluteJitter()`. The mean is more representative with the small
number of probes (6) that the benchmark sends. It returns `null` with fewer than 2
valid samples.

Bufferbloat grade (`calculateBufferbloatGrade`), from latency increase under load:

| Grade | Delta |
|-------|------:|
| A+ | 5 ms or less |
| A | 15 ms or less |
| B | 30 ms or less |
| C | 60 ms or less |
| D | 150 ms or less |
| F | above 150 ms |

### Specified: packet loss and composite score

The code has a `packetLossPct` field, but it is currently set to a constant `0.0`.
Until real loss measurement exists, treat loss as "no data" and apply no loss penalty.

When loss is measured, the composite score should be:

```
speedScore       = min(100, (downloadMbps / 150) * 100)
packetLossPenalty = min(25, packetLossPct * 5)
reliability      = max(10, stabilityScore - packetLossPenalty)
compositeScore   = round(0.6 * speedScore + 0.4 * reliability)
```

Worked example: 90 Mbps download, stability score 80, 2 percent loss.

```
speedScore        = min(100, 90 / 150 * 100)  = 60
packetLossPenalty = min(25, 2 * 5)            = 10
reliability       = max(10, 80 - 10)          = 70
compositeScore    = round(0.6 * 60 + 0.4 * 70) = 64
```

Speed tier for this venue is Gold (90 Mbps). The composite score is shown separately
from the tier, so a fast but unstable venue is visibly distinguishable.

## 4. Client side measurement telemetry

**Implemented.** The benchmark runs in the browser and uses these endpoints:

| Phase | Request | Notes |
|-------|---------|-------|
| Latency and jitter | 6 `HEAD /api/telemetry/speedtest?probe=<i>` | `cache: "no-store"`, durations feed jitter |
| Download | `GET /api/telemetry/speedtest?chunkSize=3145728` | 3 MB payload, Mbps from bytes and elapsed time |
| Upload | `POST /api/telemetry/speedtest/upload` | 1.5 MB body |
| Under load | `HEAD /api/telemetry/speedtest?probe=loaded` | used for bufferbloat delta |

Progress is reported through `BenchmarkProgress` (`phase` is `idle`, `latency`,
`download`, `upload`, `bufferbloat`, `complete`, or `error`). The final
`BenchmarkMetrics` object contains `downloadMbps`, `uploadMbps`, `latencyMs`,
`jitterMs`, `meanJitterMs`, `packetLossPct`, `stabilityScore`, `tier`, `timestamp`,
and the bufferbloat fields. A run can be cancelled with `SpeedBenchmarkRunner.cancel()`.

Notes for integrators:

- Results come from one device on one network at one moment. Treat a single run as
  an observation, not a venue verdict.
- If the upload request fails, upload is reported as 0 and the tier becomes `UNSTABLE`.

## 5. UI display guidelines

### Venue cards

- **Implemented:** when `amenities.wifiSpeed` is set, `VenueCard` renders `MachSpeedBadge`.
  The card also shows WiFi quality as a rating: a `WiFi n/5` badge when `wifiQuality`
  is 3 or higher, and a WiFi tag that is hidden when the vote metrics are low confidence.
- **Specified:** the speed tier badge (Bronze, Silver, Gold, Ultra) is derived from
  `wifiSpeed` with `getWifiSpeedTier()`.
- Always put the tier name in text. Color alone is not enough for accessibility.
- If there is no `wifiSpeed`, render nothing for the tier. Do not show Bronze.

Reference badge:

```tsx
const TIER_STYLES: Record<WifiSpeedTier, { label: string; className: string }> = {
  bronze: { label: "Bronze", className: "bg-orange-500/15 text-orange-700" },
  silver: { label: "Silver", className: "bg-slate-400/20 text-slate-700" },
  gold: { label: "Gold", className: "bg-amber-400/20 text-amber-700" },
  ultra: { label: "Ultra", className: "bg-violet-500/15 text-violet-700" },
};

export function WifiTierBadge({ downloadMbps }: { downloadMbps?: number | null }) {
  const tier = getWifiSpeedTier(downloadMbps);
  if (!tier) return null;
  const { label, className } = TIER_STYLES[tier];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      title={`WiFi ${label}: ${Math.round(downloadMbps as number)} Mbps download`}
    >
      WiFi {label}
    </span>
  );
}
```

### Search filters

**Implemented:** `VenueFilterBar` has a WiFi speed range filter (Mbps).
`DEFAULT_WIFI_RANGE` is `[10, 300]`. The URL params are `minWifi` and `maxWifi`, each
clamped to 0 to 500. The filter is controlled through `wifiSpeedRange` and
`onWifiSpeedRangeChange`, and the "custom filter active" state turns on when the range
differs from the default.

**Specified:** tier shortcuts map to ranges for the same filter:

| Shortcut | `minWifi` | `maxWifi` |
|----------|----------:|----------:|
| Bronze | 0 | 24 |
| Silver | 25 | 74 |
| Gold | 75 | 150 |
| Ultra | 151 | 500 |

### Comparison view

**Implemented:** `ComparisonDrawer` compares `wifiQuality` (1 to 5) and scales it
to a 0 to 100 bar with `wifiQuality * 20`.

## 6. Checklist for changes

- Keep tier thresholds in one shared function and import it everywhere.
- Handle `null`, `0`, negative, and `NaN` speeds as "no data".
- Never show a tier from a failed benchmark run.
- Update this guide when thresholds or penalty weights change.
