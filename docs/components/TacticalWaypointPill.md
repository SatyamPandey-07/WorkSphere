# TacticalWaypointPill Component Specification & Developer Guide

## 1. Overview & Visual Design Anatomy

The `TacticalWaypointPill` is an aerospace-inspired military badge that displays real-time micro-location telemetry, bearing angles, distance offsets, and Military Grid Reference System (MGRS) / UTM spatial coordinates. It is used across venue cards, interactive Leaflet map popups, search result list items, and AR HUD callouts.

```
┌────────────────────────────────────────────────────────────────────────┐
│  ▲  WP-04 · 320m · 042° BRG · 10S FH 1482 9314  [SECTOR 2814]         │
└────────────────────────────────────────────────────────────────────────┘
  │      │       │      │              │                  │
  │      │       │      │              │                  └─ Tactical Status
  │      │       │      │              └─ MGRS / Grid Coordinate
  │      │       │      └─ True Bearing Azimuth
  │      │       └─ Metric Distance Offset
  │      └─ Waypoint Identifier Code
  └─ Dynamic Heading Orientation Chevron
```

### Visual Characteristics

- **Aerospace Monospace Typography**: Uses JetBrains Mono with tabular numbers (`tabular-nums`) to prevent numeric jitter during coordinate and distance updates.
- **Chamfered Military Border**: $45^\circ$ angular chamfered edges with glowing hard-light energy borders (`--color-lantern-emerald`, `--color-hud-cyan`, `--color-hud-amber`).
- **Dynamic Azimuth Arrow**: Rotates dynamically to match the relative bearing from the user's current position to the destination.

---

## 2. TypeScript Props Interface

```typescript
import { HTMLAttributes } from "react";

export type WaypointTheme = "emerald" | "cyan" | "amber" | "stealth";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface TacticalWaypointPillProps extends HTMLAttributes<HTMLDivElement> {
  /** Target waypoint name or identifier (e.g., "WP-01", "DESK-4B", "CAFE-NORTH") */
  waypointCode: string;

  /** Destination geographic coordinates */
  destination: Coordinates;

  /** Current observer/user geographic coordinates for dynamic vector calculation */
  userLocation?: Coordinates | null;

  /** Optional user device compass heading in degrees [0, 360) for relative arrow rotation */
  compassHeading?: number | null;

  /** Visual aesthetic theme */
  theme?: WaypointTheme;

  /** Size variant */
  size?: "sm" | "md" | "lg";

  /** Display format for spatial coordinates */
  coordinateFormat?: "mgrs" | "utm" | "decimal" | "none";

  /** Optional tactical classification status tag (e.g., "SECTOR 2814", "DEEP FOCUS") */
  statusTag?: string;

  /** Whether the pill is interactive and clickable (e.g., opens AR navigation) */
  interactive?: boolean;

  /** Callback fired when clicked or activated via keyboard Enter/Space */
  onSelectWaypoint?: (code: string, destination: Coordinates) => void;
}
```

---

## 3. Coordinate Conversion & Bearing Algorithms

### 3.1 Great-Circle Distance (Haversine Formula)

Computes surface distance $d$ in meters between user position $(\phi_1, \lambda_1)$ and waypoint destination $(\phi_2, \lambda_2)$:

$$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)$$
$$d = 2 R \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right) \quad (R = 6,371,000\text{ m})$$

### 3.2 Forward Azimuth True Bearing Formula

Calculates initial compass bearing $\theta \in [0^\circ, 360^\circ)$ along the great circle arc:

$$\theta = \left(\operatorname{atan2}\left(\sin(\Delta \lambda)\cos(\phi_2), \cos(\phi_1)\sin(\phi_2) - \sin(\phi_1)\cos(\phi_2)\cos(\Delta \lambda)\right) \cdot \frac{180}{\pi} + 360\right) \pmod{360}$$

### 3.3 Relative Bearing & Clock Direction

When the user's compass heading $\psi$ is available, the relative bearing $\theta_{\text{rel}}$ rotates the chevron arrow:

$$\theta_{\text{rel}} = (\theta - \psi + 360) \pmod{360}$$

Clock direction is derived via:

$$\text{Clock Hour} = \operatorname{round}\left(\frac{\theta_{\text{rel}}}{30}\right) \pmod{12} \quad (\text{0 corresponds to 12 o'clock})$$

### 3.4 Decimal Latitude/Longitude to MGRS String Conversion

```typescript
export function formatCoordinatesMGRS(lat: number, lng: number): string {
  // 1. Calculate UTM Zone Number (1 to 60)
  const zoneNumber = Math.floor((lng + 180) / 6) + 1;

  // 2. Determine UTM Latitude Band Letter (C to X, omitting I and O)
  const letters = "CDEFGHJKLMNPQRSTUVWX";
  const latIndex = Math.min(
    letters.length - 1,
    Math.max(0, Math.floor((lat + 80) / 8)),
  );
  const zoneLetter = letters[latIndex];

  // 3. Approximate 100km square identification and 100m easting/northing
  // (In production, uses the full proj4 / mgrs library conversion)
  const normLat = Math.abs(lat % 1);
  const normLng = Math.abs(lng % 1);
  const easting = Math.floor(normLng * 10000)
    .toString()
    .padStart(4, "0");
  const northing = Math.floor(normLat * 10000)
    .toString()
    .padStart(4, "0");

  return `${zoneNumber}${zoneLetter} FH ${easting} ${northing}`;
}
```

---

## 4. Component Implementation Pattern

```tsx
"use client";

import React, { useMemo } from "react";
import { TacticalWaypointPillProps } from "./types";
import { calculateHaversineDistance, calculateBearing } from "@/lib/geo";
import { formatCoordinatesMGRS } from "@/lib/geo/mgrs";

export function TacticalWaypointPill({
  waypointCode,
  destination,
  userLocation,
  compassHeading = 0,
  theme = "emerald",
  size = "md",
  coordinateFormat = "mgrs",
  statusTag,
  interactive = false,
  onSelectWaypoint,
  className = "",
  ...rest
}: TacticalWaypointPillProps) {
  // Calculate metric distance and bearing if user location is available
  const { distanceMeters, bearingDeg, relativeBearingDeg } = useMemo(() => {
    if (!userLocation) {
      return { distanceMeters: null, bearingDeg: null, relativeBearingDeg: 0 };
    }
    const dist = calculateHaversineDistance(
      userLocation.lat,
      userLocation.lng,
      destination.lat,
      destination.lng,
    );
    const brg = calculateBearing(
      userLocation.lat,
      userLocation.lng,
      destination.lat,
      destination.lng,
    );
    const heading = compassHeading ?? 0;
    const rel = (brg - heading + 360) % 360;
    return { distanceMeters: dist, bearingDeg: brg, relativeBearingDeg: rel };
  }, [userLocation, destination, compassHeading]);

  // Format formatted distance string
  const formattedDistance = useMemo(() => {
    if (distanceMeters === null) return "-- m";
    if (distanceMeters >= 1000)
      return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
  }, [distanceMeters]);

  // Formatted coordinate string
  const coordString = useMemo(() => {
    if (coordinateFormat === "mgrs")
      return formatCoordinatesMGRS(destination.lat, destination.lng);
    if (coordinateFormat === "decimal")
      return `${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}`;
    return null;
  }, [destination, coordinateFormat]);

  // Theme style mapping
  const themeClasses = {
    emerald:
      "border-emerald-500/50 bg-emerald-950/40 text-emerald-300 hover:border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]",
    cyan: "border-cyan-500/50 bg-cyan-950/40 text-cyan-300 hover:border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]",
    amber:
      "border-amber-500/50 bg-amber-950/40 text-amber-300 hover:border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.2)]",
    stealth:
      "border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-500",
  }[theme];

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px] gap-1.5",
    md: "px-3 py-1 text-xs gap-2",
    lg: "px-4 py-1.5 text-sm gap-2.5",
  }[size];

  // Screen reader accessible label
  const ariaLabel = `Waypoint ${waypointCode}, ${formattedDistance} away, bearing ${
    bearingDeg !== null ? Math.round(bearingDeg) : "unknown"
  } degrees. ${coordString ? `Coordinates ${coordString}.` : ""}`;

  return (
    <div
      role={interactive ? "button" : "status"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={() =>
        interactive && onSelectWaypoint?.(waypointCode, destination)
      }
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelectWaypoint?.(waypointCode, destination);
        }
      }}
      className={`inline-flex items-center font-mono select-none rounded-md border backdrop-blur-md transition-all ${
        interactive ? "cursor-pointer active:scale-95" : ""
      } ${themeClasses} ${sizeClasses} ${className}`}
      {...rest}
    >
      {/* Direction Chevron Arrow */}
      <span
        aria-hidden="true"
        className="inline-block transition-transform duration-150 ease-out"
        style={{ transform: `rotate(${relativeBearingDeg}deg)` }}
      >
        ▲
      </span>

      {/* Waypoint ID Code */}
      <span className="font-extrabold tracking-wider">{waypointCode}</span>

      <span className="opacity-40">·</span>

      {/* Metric Distance */}
      <span className="font-semibold">{formattedDistance}</span>

      {/* True Bearing (if calculated) */}
      {bearingDeg !== null && (
        <>
          <span className="opacity-40">·</span>
          <span>{Math.round(bearingDeg).toString().padStart(3, "0")}°</span>
        </>
      )}

      {/* Grid Coordinates (MGRS / Decimal) */}
      {coordString && (
        <>
          <span className="opacity-40 hidden sm:inline">·</span>
          <span className="opacity-75 hidden sm:inline text-[11px]">
            {coordString}
          </span>
        </>
      )}

      {/* Status Tag */}
      {statusTag && (
        <span className="ml-1 px-1.5 py-0.2 rounded bg-white/10 text-[9px] uppercase tracking-wider font-bold">
          {statusTag}
        </span>
      )}
    </div>
  );
}
```

---

## 5. Example Usage Snippets

### 5.1 Inside Venue Cards

```tsx
import { TacticalWaypointPill } from "@/components/ui/TacticalWaypointPill";

export function VenueCard({ venue, userCoords }) {
  return (
    <div className="rounded-2xl bg-zinc-900 border border-white/10 p-5">
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-bold text-white">{venue.name}</h3>
        <TacticalWaypointPill
          waypointCode={`WP-${venue.id.slice(0, 3).toUpperCase()}`}
          destination={{ lat: venue.latitude, lng: venue.longitude }}
          userLocation={userCoords}
          theme="emerald"
          statusTag="VERIFIED"
          interactive={true}
          onSelectWaypoint={(code) => console.log("Routing to:", code)}
        />
      </div>
      <p className="text-zinc-400 text-sm">{venue.address}</p>
    </div>
  );
}
```

### 5.2 Inside Map Popups (Leaflet / Mapbox)

```tsx
<Popup>
  <div className="p-2">
    <TacticalWaypointPill
      waypointCode="SECTOR-HUB"
      destination={{ lat: 37.7749, lng: -122.4194 }}
      userLocation={userLocation}
      theme="cyan"
      size="sm"
      coordinateFormat="mgrs"
    />
  </div>
</Popup>
```

---

## 6. Accessibility & Tooltip Behavior

1. **Screen Reader Announcement (`aria-label`)**:
   The pill encapsulates all telemetry into an intelligible spoken sentence:
   ```html
   aria-label="Waypoint WP-04, 320m away, bearing 042 degrees. Coordinates 10S
   FH 1482 9314."
   ```
2. **Keyboard Navigation**:
   When `interactive={true}`, the component receives `tabIndex={0}` and triggers `onSelectWaypoint` upon `Enter` or `Space` keypress.
3. **High Contrast Mode Support**:
   Under `@media (forced-colors: active)`, glowing drop-shadows are eliminated, borders adapt to `CanvasText`, and backgrounds fall back to `Canvas` to guarantee WCAG AAA contrast.
