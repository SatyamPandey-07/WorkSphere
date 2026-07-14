# Leaflet Maps & Routing Guide

## Overview

WorkSphere uses **React Leaflet** to power its interactive mapping experience, **OpenStreetMap** as the default tile provider, and **OSRM (Open Source Routing Machine)** for route generation.

The mapping layer is responsible for visualizing AI search results, displaying user and venue locations, generating navigation routes, and keeping the map synchronized with application state.

---

# Architecture Overview

The mapping system is primarily implemented in:

- `src/components/Map.tsx`
- `src/lib/routing.ts`
- `src/types/map.ts`

The overall rendering flow is:

```text
User Location
      │
      ▼
AI Search Results
      │
      ▼
MapMarker[] + MapRoute[] + MapView
      │
      ▼
Map.tsx
      │
      ├── AutoCenter
      ├── MapController
      ├── Marker Rendering
      ├── Popup Rendering
      └── Route Rendering
```

The map component focuses only on presentation while routing logic and shared data models remain isolated from the UI.

---

# Client-side Rendering

The map is loaded using a Next.js dynamic import.

This ensures Leaflet is only initialized in the browser, avoiding server-side rendering issues caused by browser-specific APIs.

Keeping the map client-only improves compatibility with the App Router and prevents hydration-related rendering problems.

---

# Shared Data Models

The mapping layer relies on three reusable data models defined in `src/types/map.ts`.

## MapMarker

Represents every marker displayed on the map.

It contains:

- Unique identifier
- Coordinates
- Venue name
- Category
- Address
- Ratings
- Amenities
- Distance information

These markers are used for both AI-generated venue recommendations and destination points.

---

## MapRoute

Represents a calculated navigation route.

Each route stores:

- Complete coordinate path
- Distance
- Estimated duration
- Highlight state

This separation allows routing information to evolve independently from marker rendering.

---

## MapView

Controls the camera state of the map.

It contains:

- Center coordinates
- Zoom level
- Animation preference

Updating a `MapView` automatically recenters or animates the map.

---

# Tile Layer

The application currently uses the standard OpenStreetMap tile server.

```tsx
<TileLayer
  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
/>
```

OpenStreetMap attribution is preserved to comply with licensing requirements.

---

# Dark Map Theme

Instead of switching to a dedicated dark tile provider, WorkSphere applies CSS filters to the Leaflet tile pane.

Current adjustments include:

- Brightness
- Contrast
- Color inversion
- Hue rotation
- Saturation

This approach keeps the original OpenStreetMap tiles while producing a visual style that matches the application's dark interface.

---

# Marker System

WorkSphere renders three different marker types.

## User Marker

The user's location is displayed using a custom Leaflet `divIcon`.

If the authenticated Clerk account contains a profile image, that image becomes the marker.

Otherwise a default circular marker is displayed.

---

## Venue Marker

Workspace recommendations use a custom circular marker featuring:

- Purple / blue gradient
- White border
- Soft glow
- Drop shadow

The design keeps recommended venues visually distinct without overwhelming the map.

---

## Destination Marker

Destination markers use a custom pin-shaped icon.

The marker includes:

- Gradient styling
- Rotated pin layout
- Center label
- Shadow effect

This makes navigation targets easy to distinguish from normal venue markers.

---

# Marker Rendering Pipeline

Before rendering, every marker passes through a validation step.

The component verifies:

- Coordinate existence
- Numeric latitude
- Numeric longitude
- Invalid (`NaN`) values

Only valid markers are rendered.

This prevents runtime rendering errors caused by malformed location data.

---

# Automatic View Management

Two helper components control the viewport.

## MapController

Updates the current map position whenever a new `MapView` is received.

Depending on the requested state it either:

- Animates using `flyTo`
- Immediately updates using `setView`

---

## AutoCenter

Automatically adjusts the visible map bounds.

Behavior includes:

- Including all visible markers
- Including the user's current location
- Falling back to the user's location if no venues exist

This ensures important locations remain visible without requiring manual zoom adjustments.

---

# Popups

Every rendered marker includes a popup.

Venue popups display:

- Venue name
- Category
- Address (when available)

Route popups display:

- Distance
- Estimated travel time

The popup interface is styled to match the application's dark theme.

---

# Route Generation

Navigation routes are implemented in:

```
src/lib/routing.ts
```

The application defaults to the public **OSRM** server. For high-volume testing or offline development, you can set up a local OSRM instance. Refer to the [OSRM Local Routing Guide](file:///c:/Users/ADMIN/OneDrive/Desktop/ECSoC/WorkSphere/docs/LOCAL_ROUTING.md) for setup details.

Supported routing profiles:

- walking
- driving
- cycling

Routes are requested using the required OSRM coordinate order:

```
longitude,latitude
```

Example:

```
/route/v1/walking/lng1,lat1;lng2,lat2
```

After receiving the response, GeoJSON coordinates are converted into the application's internal:

```ts
{
  lat,
  lng
}
```

structure before being rendered on the map.

---

# Route Rendering

Routes are displayed using Leaflet `Polyline`.

Each rendered route supports:

- Green highlighted path
- Rounded joins
- Distance popup
- Estimated travel duration

Rendering is skipped automatically if insufficient path coordinates are available.

---

# Alternative Routing Provider

The project also contains an optional integration for **OpenRouteService**.

Unlike OSRM, OpenRouteService requires:

- API key
- Authorization header
- POST request

This provides an alternative routing backend for deployments requiring dedicated routing services.

---

# Best Practices

When modifying the mapping layer:

- Preserve OpenStreetMap attribution.
- Validate coordinates before rendering.
- Keep routing logic inside `src/lib/routing.ts`.
- Keep shared interfaces inside `src/types/map.ts`.
- Reuse existing marker styles whenever possible.
- Prefer React Leaflet components over direct Leaflet DOM manipulation.

---

# Future Enhancements

Potential future improvements include:

- Marker clustering
- Multiple alternative routes
- Offline tile caching
- Route caching
- Additional map providers
- Traffic overlays
- Basemap switching

These items are possible enhancements and are **not currently implemented**.

---

# Summary

The mapping system is intentionally separated into three responsibilities:

| Layer | Responsibility |
|-------|----------------|
| `Map.tsx` | Rendering map, markers, popups and routes |
| `routing.ts` | Route generation through OSRM/OpenRouteService |
| `types/map.ts` | Shared map data models |

This separation keeps the mapping stack modular, maintainable, and easier to extend as new mapping features are introduced.