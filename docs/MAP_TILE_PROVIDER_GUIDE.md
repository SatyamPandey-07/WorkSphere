# Map Tile Provider & Fallback Troubleshooting Guide

WorkSphere supports interactive spatial map rendering via standard raster tile layers and vector basemaps. This guide details tile provider API configurations, automatic fallback order, rate-limiting constraints, and Content Security Policy (CSP) setup.

---

## 1. Map Provider Architecture & Fallback Lifecycle

WorkSphere attempts to load map layers in a prioritized order to ensure uninterrupted spatial features across different deployment environments:

1. **Mapbox Vector Tiles (Primary Default):** Loaded when `NEXT_PUBLIC_MAPBOX_TOKEN` is present. Offers vector rendering and customized map styles.
2. **CARTO Raster Basemaps (Secondary Fallback):** Activated if Mapbox token is missing or fails. Uses CartoDB raster tiles (`positron`, `dark_all`).
3. **OpenStreetMap (OSM Standard Raster - Final Fallback):** Activated when neither Mapbox nor CARTO credentials are set, or during network fallback events.
---

## 2. Environment Variable Configuration

To configure custom map tile providers, add the corresponding environment variables in your `.env.local` file:

```env
# Primary Mapbox Token (Vector tiles)
NEXT_PUBLIC_MAPBOX_TOKEN="pk.eyJ1IjoieW91ci11c2VybmFtZSIsImEiOiJjbH..."

# Optional CARTO API Key (High-traffic raster basemaps)
NEXT_PUBLIC_CARTO_KEY="your_carto_api_key_here"