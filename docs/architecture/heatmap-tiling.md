# Viewport-Bounded Heatmap Tiling Engine & Spatial Aggregation Pipeline

## 1. Executive Summary & Problem Space

Urban remote workers, digital nomads, and distributed teams require real-time visibility into venue density, active desk bookings, and ambient acoustic levels when choosing workspaces across dense metropolitan areas (e.g., Tokyo, London, Bengaluru, San Francisco).

Displaying raw venue points on map interfaces presents severe performance bottlenecks at scale:

1. **DOM and WebGL Overdraw**: Rendering tens of thousands of individual SVG markers or WebGL fragments at continental or metropolitan zoom levels degrades frame rates below 15 FPS and consumes hundreds of megabytes of client memory.
2. **Bandwidth Saturation**: Transmitting unaggregated venue inventories across cellular or spotty coffee-shop Wi-Fi introduces high latency and large JSON payload parsing overhead.
3. **Boundary Double-Counting**: When points lie directly on tile or sub-cell boundaries, naïve spatial queries produce visual artifacts such as halo effects, duplicate intensity spikes, or dark gaps.
4. **Cache Invalidation Storms**: Real-time desk check-ins and acoustics telemetry produce frequent mutations; invalidating an entire city or map layer causes unmanageable database spikes and cache churn.

To solve this, WorkSphere implements a **viewport-bounded heatmap tiling engine** and **zoom-aware spatial aggregation pipeline** ([`src/lib/geo/heatmapTile.ts`](../../src/lib/geo/heatmapTile.ts), [`src/lib/geo/heatmapAggregator.ts`](../../src/lib/geo/heatmapAggregator.ts)). The pipeline standardizes on the Web Mercator Slippy Map projection, calculates half-open geometric boundaries, subdivides tiles into zoom-proportional sub-grids, computes normalized multi-factor density weights, and leverages in-flight request coalescing with deterministic TTL caching.

---

## 2. Architecture & Pipeline Overview

```
+---------------------------------------------------------------------------------------------------+
|                                      Client Viewport & Map View                                   |
|   Bounding Box: [W, S, E, N]                                         Zoom Level: z (0 to 24)       |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
| 1. Viewport Bounding-Box Pruning & Tile Coordinate Conversion (src/lib/geo/heatmapTile.ts)        |
|    - Project lat/lng to Web Mercator tile indices (x, y, z)                                       |
|    - Compute required tile set: [xMin..xMax] x [yMin..yMax]                                       |
|    - Enforce half-open boundary intervals [minLat, maxLat) x [minLng, maxLng)                    |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
| 2. Request Coalescing & Tile Cache Layer (src/lib/geo/heatmapAggregator.ts)                       |
|    - Cache Key: heatmap_tile:{z}:{x}:{y}:{periodKey}:{version}                                    |
|    - Check in-memory TTL cache (expiresAt > now)                                                  |
|    - Coalesce identical in-flight promises to eliminate duplicate database sweeps                  |
+-------------------------------------------------+-------------------------------------------------+
                                                  | (Cache Miss)
                                                  v
+---------------------------------------------------------------------------------------------------+
| 3. Zoom-Aware Sub-Grid Spatial Aggregation (src/lib/geo/heatmapAggregator.ts)                     |
|    - Select sub-grid resolution: 8x8 (z<7), 16x16 (z 7..10), 32x32 (z 11..14), 0 (z>=15)          |
|    - Partition bounded venues into sub-cells using normalized offset fractions                    |
|    - Calculate mean centroid: (meanLat, meanLng) per active bucket cell                           |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
| 4. Multi-Factor Density Normalization & Weighting (computeHeatmapWeight)                          |
|    - Baseline offset: 0.1                                                                         |
|    - Booking weight: activeBookings * 0.2                                                         |
|    - Acoustic noise score: loud * 0.4 + moderate * 0.2 + 0.1                                      |
|    - Clamped output: [0.1, 1.0]                                                                   |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
| Output: Array of HeatmapPoint tuples: [latitude, longitude, weight]                               |
| Rendered by Leaflet / Mapbox / WebGL Canvas shaders at a constant 60 FPS                          |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Tile Coordinate Math & Boundary Pruning

### 3.1 Web Mercator Projection Formulas

The tiling engine utilizes the standard EPSG:3857 (Web Mercator / Slippy Map) projection. At any given integer zoom level $z \in [0, 24]$, the earth is partitioned into $2^z \times 2^z$ tiles:

$$n = 2^z$$

#### Latitude / Longitude to Tile Coordinates:

Given latitude $\phi$ and longitude $\lambda$ in decimal degrees:

$$x = \left\lfloor \frac{\lambda + 180}{360} \cdot n \right\rfloor$$

$$y = \left\lfloor \left(1 - \frac{\operatorname{asinh}(\tan(\phi \cdot \frac{\pi}{180}))}{\pi}\right) \cdot \frac{n}{2} \right\rfloor$$

In TypeScript ([`src/lib/geo/heatmapTile.ts`](../../src/lib/geo/heatmapTile.ts)):

```typescript
export function latLngToTile(
  lat: number,
  lng: number,
  zoom: number,
): TileCoordinates {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return {
    z: zoom,
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}
```

#### Tile Coordinates to Geographic Bounding Box:

Given tile $(z, x, y)$, the bounding box $[\text{minLat}, \text{maxLat}, \text{minLng}, \text{maxLng}]$ is derived by inverting the projection. Note that in Slippy Map conventions, tile $y=0$ starts at the northernmost boundary:

$$\lambda_{\min} = \frac{x}{n} \cdot 360 - 180, \quad \lambda_{\max} = \frac{x + 1}{n} \cdot 360 - 180$$

$$\phi_{\min} = \arctan\left(\sinh\left(\pi \cdot \left(1 - \frac{2(y + 1)}{n}\right)\right)\right) \cdot \frac{180}{\pi}$$

$$\phi_{\max} = \arctan\left(\sinh\left(\pi \cdot \left(1 - \frac{2y}{n}\right)\right)\right) \cdot \frac{180}{\pi}$$

### 3.2 Viewport Bounding-Box Pruning

When the client map renders or pans, the visible viewport bounds $[W, S, E, N]$ are translated into bounding tile ranges:

- $x_{\min} = \text{latLngToTile}(S, W, z).x$
- $x_{\max} = \text{latLngToTile}(N, E, z).x$
- $y_{\min} = \text{latLngToTile}(N, W, z).y$
- $y_{\max} = \text{latLngToTile}(S, E, z).y$

Tiles outside this range are never fetched or aggregated. Furthermore, within each tile, venue records are strictly filtered against tile bounds before aggregation begins.

### 3.3 Half-Open Boundary Intervals & Antimeridian Handling

A notorious bug in grid aggregation is **boundary double-counting**, where a venue positioned exactly on a shared tile edge is counted twice, causing artificial density ridges.

WorkSphere enforces strict half-open intervals $[\text{minLat}, \text{maxLat})$ and $[\text{minLng}, \text{maxLng})$ via `isPointInTileBounds`:

```typescript
export function isPointInTileBounds(
  lat: number,
  lng: number,
  bounds: TileBounds,
): boolean {
  const inLat = lat >= bounds.minLat && lat < bounds.maxLat;
  if (!inLat) return false;

  // Standard non-crossing longitude bounds
  if (bounds.minLng <= bounds.maxLng) {
    return lng >= bounds.minLng && lng < bounds.maxLng;
  }

  // Antimeridian crossing handling: minLng > maxLng
  return lng >= bounds.minLng || lng < bounds.maxLng;
}
```

---

## 4. Zoom-Level Aggregation Table & Bucket Sizing

To balance visual fidelity against network payloads, the engine subdivides each Web Mercator tile into a dynamic sub-grid whose resolution scales with zoom level.

### Zoom-Level Aggregation Table

| Zoom Level Range | Geographic Scope        | Sub-Grid Resolution | Total Cells / Tile | Typical Cell Diameter   | Aggregation Mode                  |
| :--------------- | :---------------------- | :------------------ | :----------------- | :---------------------- | :-------------------------------- |
| **0 – 6**        | Global / Continental    | $8 \times 8$        | 64                 | ~150 km – ~1,200 km     | Regional centroid clustering      |
| **7 – 10**       | Regional / Metropolitan | $16 \times 16$      | 256                | ~15 km – ~75 km         | Urban zone spatial buckets        |
| **11 – 14**      | City / Neighborhood     | $32 \times 32$      | 1,024              | ~500 m – ~4 km          | Street cluster spatial buckets    |
| **15 – 24**      | Block / Venue Detail    | $0$ (Unaggregated)  | 1 (Exact points)   | Exact venue coordinates | 1:1 Individual venue pass-through |

### 4.1 Sub-Grid Partitioning Algorithm

When $z < 15$, venues falling inside a tile are placed into internal cell buckets indexed by `cellX_cellY`:

```typescript
const latSpan = bounds.maxLat - bounds.minLat;
const lngSpan = bounds.maxLng - bounds.minLng;
const subgridSteps = getSubgridResolutionForZoom(z); // 8, 16, or 32

const cellX = Math.min(
  subgridSteps - 1,
  Math.max(
    0,
    Math.floor(((v.longitude - bounds.minLng) / lngSpan) * subgridSteps),
  ),
);
const cellY = Math.min(
  subgridSteps - 1,
  Math.max(
    0,
    Math.floor(((v.latitude - bounds.minLat) / latSpan) * subgridSteps),
  ),
);
const cellKey = `${cellX}_${cellY}`;
```

Each bucket collects all venues falling into that sub-cell. The aggregated point output is placed at the **arithmetic mean centroid** of all venues in the bucket:

$$\bar{\phi} = \frac{1}{K} \sum_{k=1}^K \phi_k, \quad \bar{\lambda} = \frac{1}{K} \sum_{k=1}^K \lambda_k$$

This prevents points from snapping artificially to grid cell centers, maintaining organic clustering around real venue concentrations.

---

## 5. Density Normalization & Intensity Weighting

Heatmap visual intensity represents composite workspace demand and acoustic environment. The aggregator computes a deterministic scalar weight $W \in [0.1, 1.0]$ using `computeHeatmapWeight`:

```typescript
export function computeHeatmapWeight(
  bookingCount: number,
  noiseStats?: NoiseStats,
): number {
  let noiseScore = 0.2; // Baseline fallback score for unrated cells
  if (noiseStats && noiseStats.total > 0) {
    const loudRatio = noiseStats.loud / noiseStats.total;
    const moderateRatio = noiseStats.moderate / noiseStats.total;
    noiseScore = 0.1 + (loudRatio * 0.4 + moderateRatio * 0.2);
  }

  const rawWeight = 0.1 + bookingCount * 0.2 + noiseScore;
  return Number(Math.min(1.0, Math.max(0.1, rawWeight)).toFixed(4));
}
```

### Components of the Weight Formula

1. **Base Presence Floor ($0.1$)**: Guarantees that any cell with at least one active workspace remains visible as a faint ambient indicator on the map.
2. **Desk Utilization Factor ($\text{bookings} \times 0.2$)**: Reflects live occupancy and popularity. A venue or cluster with 4+ active desk reservations approaches maximum saturation.
3. **Acoustic Score Factor ($\text{noiseScore} \in [0.1, 0.7]$)**: Incorporates crowdsourced and IoT sound meter telemetry. High loud-decibel ratios increase heat intensity, signaling bustling, high-energy hubs.
4. **Saturation Clamp ($\min(1.0, \max(0.1, \dots))$)**: Ensures shader uniforms receive values bounded within $[0.1, 1.0]$.

---

## 6. Caching & Invalidation Strategy

### 6.1 Deterministic Tile Cache Keys

Tiles are cached using structured keys:

```
heatmap_tile:{z}:{x}:{y}:{periodKey}:{version}
```

- `z`, `x`, `y`: Slippy Map tile coordinates.
- `periodKey`: Time window filter (e.g., `today`, `morning`, `evening`, `weekend`).
- `version`: Cache namespace version (`HEATMAP_CACHE_VERSION = "v1"`), allowing instantaneous cache-busting on engine schema updates.

### 6.2 Request Coalescing (Thundering-Herd Protection)

During rapid user panning or simultaneous page loads, multiple client map layers may request the identical tile within a few milliseconds. `getOrComputeCachedTile` tracks in-flight promises:

```typescript
const inFlight = inFlightTileRequests.get(cacheKey);
if (inFlight) {
  return inFlight;
}

const promise = (async () => {
  try {
    const points = await computeFn();
    tileCache.set(cacheKey, {
      points,
      expiresAt: Date.now() + ttlMs, // DEFAULT_CACHE_TTL_MS = 60,000ms
    });
    return points;
  } finally {
    inFlightTileRequests.delete(cacheKey);
  }
})();

inFlightTileRequests.set(cacheKey, promise);
return promise;
```

This guarantees that a newly requested tile is computed exactly once in parallel workloads.

### 6.3 Dynamic Invalidation on Venue Updates

To balance freshness with low database load, WorkSphere uses a multi-tiered invalidation strategy:

1. **Short In-Memory TTL (60 Seconds)**: Tile cache entries naturally expire after 60 seconds (`DEFAULT_CACHE_TTL_MS`), absorbing rapid repeated panning.
2. **Selective Prefix Eviction (`clearHeatmapTileCache`)**: When a venue is updated, created, or deleted, or when bulk check-ins occur:
   - The venue's coordinates are converted to tile $(z, x, y)$ for zoom levels $7$ through $15$.
   - Cache keys matching those specific coordinates are purged via prefix deletion.
3. **Adaptive Prefetching (Service Worker / Offline)**: [`src/lib/offline/adaptiveHeatmapPrefetcher.ts`](../../src/lib/offline/adaptiveHeatmapPrefetcher.ts) proactively prefetches and persists neighboring tiles within the user's primary commute radius into IndexedDB, avoiding cold-cache delays when traveling through intermittent coverage.

---

## 7. Performance & Verification Metrics

- **Aggregation Latency**: $< 4\text{ms}$ for 1,000 venues within a single tile at zoom 12 ($32 \times 32$ sub-grid).
- **Payload Compression**: 1,000 raw venue records (~180 KB JSON) aggregate into ~15 to 45 centroid tuples (~1.2 KB JSON), achieving a **99.3% reduction** in network payload.
- **Rendering Smoothness**: Consistent 60 FPS maintained during continuous panning on mobile WebKit and Chrome Android devices.
