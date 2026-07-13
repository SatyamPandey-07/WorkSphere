# WorkSphere Leaflet Map Integration and Styling Manual

This guide explains how WorkSphere renders its interactive map, how custom markers and dark styling are applied, and how routing requests are built and rendered with OSRM.

> Primary implementation files:
>
> - `src/components/Map.tsx`
> - `src/lib/routing.ts`
> - `src/types/map.ts`

---

## 1. Mapping stack

WorkSphere uses the following mapping technologies:

| Layer | Technology | Responsibility |
|---|---|---|
| UI integration | React Leaflet | React components for Leaflet maps |
| Map engine | Leaflet | Markers, popups, polylines, viewport control |
| Base map | OpenStreetMap-compatible tiles | Geographic background |
| Routing | OSRM | Road-following route geometry |
| Optional routing | OpenRouteService | Alternate routing provider |
| Heatmap | `leaflet.heat` | Activity and density overlays |
| Authentication | Clerk | User avatar used in the location marker |

The map is a client-side component because Leaflet depends on browser APIs such as `window` and the DOM.

---

## 2. Component architecture

```text
AI workspace page
       │
       ├── user location
       ├── MapMarker[]
       ├── MapRoute[]
       └── MapView
              │
              ▼
         Map.tsx
              │
              ├── MapContainer
              ├── TileLayer
              ├── MapController
              ├── AutoCenter
              ├── ZoomWatcher
              ├── ResizeWatcher
              ├── HeatmapOverlay
              ├── Marker + Popup
              └── Polyline
```

The map receives data through three shared interfaces:

- `MapMarker`: venue or destination marker data
- `MapRoute`: route geometry and route metadata
- `MapView`: requested map center, zoom, and animation behavior

Keep shared map types in `src/types/map.ts` so UI components and routing utilities use the same contracts.

---

## 3. Client-only loading

Leaflet should never be rendered during server-side execution.

The page that uses the map should load it dynamically:

```tsx
import dynamic from "next/dynamic";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <div>Loading map…</div>,
});
```

`Map.tsx` must also begin with:

```tsx
"use client";
```

This prevents common errors such as `window is not defined` and `document is not defined`.

---

## 4. Base tile layer

A Leaflet tile layer requires:

```tsx
<TileLayer
  attribution="&copy; OpenStreetMap contributors"
  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
/>
```

### Tile URL parameters

| Token | Meaning |
|---|---|
| `{s}` | Tile subdomain |
| `{z}` | Zoom level |
| `{x}` | Horizontal tile coordinate |
| `{y}` | Vertical tile coordinate |

Always preserve the provider attribution. Before changing providers, verify licensing, rate limits, production usage policy, and whether an API key is required.

A dark tile provider can be configured as:

```tsx
<TileLayer
  attribution="&copy; OpenStreetMap contributors &copy; CARTO"
  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
/>
```

---

## 5. Dark theme styling

WorkSphere can achieve a dark appearance using either a dedicated dark tile provider or CSS filters applied to standard map tiles.

```css
.leaflet-tile-pane {
  filter:
    brightness(0.72)
    contrast(1.15)
    saturate(0.8)
    hue-rotate(175deg)
    invert(0.88);
}
```

Do not apply the filter to the entire `.leaflet-container`; doing so also changes marker, popup, and route colors.

---

## 6. Custom Leaflet icons

WorkSphere uses `L.divIcon()` so marker appearance can be controlled with HTML and CSS.

### Venue marker

```ts
const venueIcon = L.divIcon({
  className: "venue-marker",
  html: `<span class="venue-marker__core"></span>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});
```

```css
.venue-marker {
  background: transparent;
  border: 0;
}

.venue-marker__core {
  display: block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  background: linear-gradient(135deg, #7c3aed, #2563eb);
  box-shadow:
    0 0 0 5px rgba(124, 58, 237, 0.2),
    0 0 20px rgba(99, 102, 241, 0.85);
}
```

### Destination marker

```ts
const destinationIcon = L.divIcon({
  className: "destination-marker",
  html: `<span class="destination-marker__pin">D</span>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});
```

### User marker

When Clerk provides a profile image, render it inside a custom `divIcon`. Use a fallback marker if no image exists.

### Marker sizing properties

| Property | Purpose |
|---|---|
| `iconSize` | Overall marker dimensions |
| `iconAnchor` | Point attached to geographic coordinate |
| `popupAnchor` | Popup offset relative to marker |

Incorrect anchors make markers and popups appear displaced.

---

## 7. Default Leaflet assets

Leaflet default image paths can break in bundled Next.js apps. Configure explicit public asset paths or use custom `divIcon` markers.

```ts
delete (L.Icon.Default.prototype as unknown as {
  _getIconUrl?: unknown;
})._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});
```

---

## 8. Marker validation

Never pass invalid coordinates to Leaflet.

```ts
function isValidCoordinate(lat: unknown, lng: unknown) {
  return (
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180
  );
}
```

Validate coordinates before rendering markers.

---

## 9. Overlapping markers

Multiple venues can share identical coordinates. WorkSphere groups markers by rounded latitude/longitude and offsets grouped markers around the original point.

Use a zoom-aware offset rather than a fixed degree offset:

```ts
const metersPerPixel =
  (156543.03392 * Math.cos((latitude * Math.PI) / 180)) /
  Math.pow(2, zoom);
```

This keeps marker separation visually stable across zoom levels.

---

## 10. Viewport management

`MapController` applies explicit map view changes using `flyTo` or `setView`.

`AutoCenter` builds bounds from the user location and all visible markers, then calls `flyToBounds`.

When the map container changes size, call:

```ts
map.invalidateSize();
```

Debounce resize handling to avoid repeated recalculation.

---

## 11. Popup styling

```css
.leaflet-popup-content-wrapper,
.leaflet-popup-tip {
  color: #f4f4f5;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(17, 17, 20, 0.96);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.42);
}
```

Venue popups should remain concise: venue name, category, address, distance, and important amenities.

---

## 12. OSRM request structure

OSRM endpoint:

```text
https://router.project-osrm.org/route/v1/{profile}/{coordinates}
```

Example:

```text
https://router.project-osrm.org/route/v1/driving/
73.8567,18.5204;73.8750,18.5300
?overview=full&geometries=geojson&steps=true
```

OSRM expects:

```text
longitude,latitude
```

Leaflet expects:

```text
latitude,longitude
```

Mixing these orders is the most common routing error.

---

## 13. Routing parameters

| Parameter | Value | Purpose |
|---|---|---|
| `overview` | `full` | Complete route geometry |
| `geometries` | `geojson` | GeoJSON coordinate output |
| `steps` | `true` | Route legs and navigation steps |
| `alternatives` | `true/false` | Optional alternate routes |

Application profile values should be mapped to profiles supported by the selected OSRM deployment.

---

## 14. Parsing OSRM responses

OSRM returns coordinates as `[longitude, latitude]`.

```ts
const coordinates = route.geometry.coordinates.map(
  ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
);
```

Distance is returned in meters and duration in seconds.

---

## 15. Route rendering

```tsx
<Polyline
  positions={route.coordinates}
  pathOptions={{
    color: route.highlighted ? "#22c55e" : "#64748b",
    weight: route.highlighted ? 6 : 4,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round",
  }}
/>
```

Do not render a polyline with fewer than two valid positions.

---

## 16. Multi-stop routing

OSRM accepts semicolon-separated coordinates:

```text
lng1,lat1;lng2,lat2;lng3,lat3
```

Before requesting:

- remove invalid coordinates
- remove consecutive duplicate stops
- ensure at least two unique stops remain
- limit excessive stop counts

---

## 17. Routing error handling

Verify both HTTP success and OSRM-level success:

```ts
const response = await fetch(url);

if (!response.ok) {
  throw new Error(`OSRM request failed with ${response.status}`);
}

const data = await response.json();

if (data.code !== "Ok" || !data.routes?.length) {
  throw new Error(data.message || "No route was returned");
}
```

Recommended UI behavior:

1. keep markers visible
2. clear only the failed route
3. show a non-blocking error
4. allow retry

---

## 18. Public OSRM limitations

The public OSRM endpoint is suitable for development and low-volume testing. It does not provide guaranteed uptime, unlimited production capacity, or an SLA.

For production, consider self-hosted OSRM, OpenRouteService, request throttling, and route-result caching. See the [OSRM Local Routing Guide](file:///c:/Users/ADMIN/OneDrive/Desktop/ECSoC/WorkSphere/docs/LOCAL_ROUTING.md) for details on running a local routing server inside a Docker container.

---

## 19. Optional OpenRouteService

OpenRouteService uses an authenticated request. Keep the key server-side and never expose it through a `NEXT_PUBLIC_` variable.

---

## 20. Heatmap integration

Install:

```bash
npm install leaflet.heat
npm install --save-dev @types/leaflet.heat
```

Import in a client-only module:

```ts
import "leaflet.heat";
```

Example:

```ts
const layer = L.heatLayer(points, {
  radius: 30,
  blur: 18,
  maxZoom: 16,
  gradient: {
    0.3: "#1e3a8a",
    0.55: "#3b82f6",
    0.8: "#8b5cf6",
    1: "#d946ef",
  },
});

layer.addTo(map);

return () => {
  map.removeLayer(layer);
};
```

Each point usually follows:

```ts
[latitude, longitude, intensity]
```

Always remove the layer in cleanup to avoid duplicates.

---

## 21. Map CSS checklist

Useful selectors:

```css
.leaflet-container { }
.leaflet-tile-pane { }
.leaflet-control-zoom { }
.leaflet-control-attribution { }
.leaflet-popup-content-wrapper { }
.leaflet-popup-tip { }
.venue-marker { }
.destination-marker { }
.custom-user-marker { }
```

Ensure the map container has an explicit height.

```css
.worksphere-map .leaflet-container {
  width: 100%;
  height: 100%;
  min-height: 420px;
  background: #09090b;
}
```

---

## 22. Testing guide

Verify:

- tiles load and attribution is visible
- dark styling affects tiles, not markers
- invalid coordinates are skipped
- overlapping markers remain selectable
- auto-centering works
- the route follows roads
- distance and duration are correct
- duplicate stops do not break routing
- failed route requests are recoverable
- heatmap toggling does not create duplicate layers

---

## 23. Troubleshooting

### `window is not defined`

Use `"use client"` and dynamic import with `ssr: false`.

### Blank map

Check map height, tile URL, network requests, and call `invalidateSize()` after layout changes.

### Missing marker icons

Use custom `divIcon` markers or configure explicit public asset paths.

### `Can't resolve 'leaflet.heat'`

```bash
npm install leaflet.heat
npm install --save-dev @types/leaflet.heat
```

### Route appears in the wrong place

Check coordinate order: OSRM uses `longitude,latitude`; Leaflet uses `latitude,longitude`.

### OSRM returns `InvalidUrl` or `NoRoute`

Check profile name, coordinate range, duplicate stops, and semicolon formatting.

---

## 24. Contribution rules

When updating the map:

1. keep rendering in `Map.tsx`
2. keep shared interfaces in `src/types/map.ts`
3. keep routing logic in `src/lib/routing.ts`
4. preserve attribution
5. validate coordinates
6. clean up layers and listeners
7. keep API keys server-side
8. test hot reload and production builds

Run:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

---

## 25. Summary

| File | Responsibility |
|---|---|
| `src/components/Map.tsx` | Map rendering, markers, popups, layers, viewport |
| `src/lib/routing.ts` | OSRM/OpenRouteService request and response handling |
| `src/types/map.ts` | Shared marker, route, and view contracts |

The key rules are to keep Leaflet client-only, preserve attribution, validate coordinates, convert OSRM coordinate order correctly, and clean up custom layers and event listeners.
