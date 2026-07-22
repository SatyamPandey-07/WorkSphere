# Leaflet Map Custom Marker Layout and Cluster Styling Guide

This guide defines the standards for implementing, styling, and optimizing Leaflet map markers and marker clusters in the WorkSphere application. Following these guidelines ensures consistent visuals, high performance, and full accessibility across both desktop and mobile platforms.

---

## 1. Introduction

WorkSphere heavily utilizes interactive maps to display offices, coworking spaces, events, and user locations. By default, Leaflet uses generic, non-scalable raster marker icons that do not align with the modern WorkSphere design system.

### Custom Marker Layouts and UX
Custom markers significantly improve user experience by:
- **Visual Context**: Instantly communicating the category of a location (e.g., using a person's avatar, a building SVG, or a destination pin).
- **Branding**: Styling marker shapes and colors dynamically based on light/dark mode, status, or selection state.
- **Interactivity**: Supporting hover, tap, and entry transitions that make the map feel alive.
- **Clarity**: Consolidating multiple nearby markers into clean, themed clusters to prevent screen clutter.

---

## 2. Marker Types

WorkSphere supports five main marker categories depending on the location context:

### Default Markers
- **Description**: Standard Leaflet PNG markers.
- **Usage**: Used only as a fallback or for simple external links.
- **Pros/Cons**: Simple, but difficult to theme and breaks under webpack/Next.js path resolution without specific asset configuration fixes.

### DivIcon Markers
- **Description**: HTML-based markers created via `L.divIcon()`.
- **Usage**: Primary method for rendering themed elements using Tailwind CSS or custom CSS.
- **Pros/Cons**: Fully customizable, supports standard DOM elements, interactive, but slightly higher memory usage than raw Canvas rendering.

### Image-Based Markers
- **Description**: Markers displaying raster images or profile pictures (avatars).
- **Usage**: Representing users, team members, or specific venues with photo previews.
- **Pros/Cons**: Great for personalization, but requires proper error fallback (e.g., placeholder icon if image fails to load) and sizing constraints.

### SVG Markers
- **Description**: Inline or external vector graphics rendered inside a `DivIcon`.
- **Usage**: Crisp icons for standard locations (e.g., office buildings, parking spots, food options).
- **Pros/Cons**: High DPI/Retina friendly, fully scalable, dynamically styleable via CSS/JS (e.g., changing fill colors based on availability).

### Animated Markers
- **Description**: Markers with CSS transitions or keyframe animations (e.g., pulsing beacons).
- **Usage**: Indicating the user's live position or highlighting a searched destination.
- **Pros/Cons**: Highly eye-catching, but can cause GPU/CPU strain if too many elements are animated concurrently.

---

## 3. Creating Custom Markers

When building custom markers, use `L.icon()` for image-based markers or `L.divIcon()` for HTML/CSS/SVG markers.

### Using `L.icon()`
Use this when you want to load a static image file as the marker icon.

```ts
import L from "leaflet";

export const officeIcon = L.icon({
  iconUrl: "/images/markers/office-pin.png",
  iconRetinaUrl: "/images/markers/office-pin-2x.png", // Retina support
  iconSize: [38, 48], // Size of the icon
  iconAnchor: [19, 48], // Point of the icon which corresponds to marker's location
  popupAnchor: [0, -50], // Point from which the popup should open relative to the iconAnchor
  shadowUrl: "/images/markers/marker-shadow.png",
  shadowSize: [50, 64],
  shadowAnchor: [15, 64],
});
```

### Using `L.divIcon()`
Use this when you want to render HTML markup, allowing you to use CSS styling, Tailwind, and custom SVGs.

```ts
import L from "leaflet";

export const createCustomDivIcon = (label: string, isActive: boolean) => {
  return L.divIcon({
    className: `custom-div-icon ${isActive ? "is-active" : ""}`,
    html: `
      <div class="marker-container">
        <div class="marker-pin">
          <svg class="marker-svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
        </div>
        <span class="marker-label">${label}</span>
      </div>
    `,
    iconSize: [40, 48],
    iconAnchor: [20, 48],
    popupAnchor: [0, -44],
  });
};
```

---

## 4. Marker Styling

To ensure markers look premium and align perfectly on the map, configure their layout dimensions and CSS classes correctly.

### Sizing and Anchor Points
Always define `iconSize` and `iconAnchor` when creating custom icons.
- **`iconSize`**: `[width, height]` in pixels.
- **`iconAnchor`**: The offset point that pins exactly to the coordinate. For center-aligned circular markers, use `[width / 2, height / 2]`. For bottom-pointed pins, use `[width / 2, height]`.
- **`popupAnchor`**: The point where the popup arrow attaches, relative to the `iconAnchor`. Usually centered horizontally (`0`) and positioned slightly above the top of the marker (negative Y offset, e.g., `-height`).

### Retina / High-DPI Support
- For image-based markers, always specify `iconRetinaUrl` with a double-resolution asset.
- For vector-based markers (SVGs in `L.divIcon()`), high-DPI scaling is handled automatically by the browser, preserving sharpness.

### Hover and Active States
Markers should respond to hover and active selections with smooth transitions.

```css
/* Custom CSS styling for DivIcon markers */
.custom-div-icon {
  background: transparent;
  border: none;
}

.marker-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Hover Effect */
.marker-container:hover {
  transform: scale(1.15) translateY(-2px);
  z-index: 1000 !important; /* Ensure hovered marker is on top */
}

/* Active/Selected Marker State */
.custom-div-icon.is-active .marker-pin {
  background-color: var(--primary-selected, #2563eb);
  color: #ffffff;
  border-color: #ffffff;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.4);
}

.custom-div-icon.is-active .marker-container {
  transform: scale(1.2) translateY(-4px);
}
```

---

## 5. Cluster Styling

When rendering hundreds of markers on a map, group them into clusters using the `leaflet.markercluster` plugin.

### MarkerClusterGroup Overview
A cluster consolidates multiple markers within a specific pixel distance (grid size) into a single bubble. When clicked, the map zooms into the cluster bounds or spiderfies overlapping markers.

### Custom Cluster Icons
By default, the markercluster plugin uses standard green/orange/yellow bubbles. WorkSphere overrides this using the `iconCreateFunction` to generate themed, accessible HTML clusters.

```ts
import L from "leaflet";

export const createClusterIcon = (cluster: any) => {
  const count = cluster.getChildCount();
  let sizeClass = "cluster-small";
  
  if (count >= 50) {
    sizeClass = "cluster-large";
  } else if (count >= 10) {
    sizeClass = "cluster-medium";
  }

  return L.divIcon({
    html: `
      <div class="custom-cluster ${sizeClass}">
        <span class="cluster-badge">${count}</span>
      </div>
    `,
    className: "custom-cluster-icon",
    iconSize: [40, 40],
  });
};
```

### Cluster Size and Color Scaling
To visually represent density, scale the sizes and colors of clusters based on the count:

| Cluster Class | Group Count | Dimensions | Color System |
| :--- | :--- | :--- | :--- |
| `cluster-small` | < 10 markers | 36px × 36px | Light blue / slate border (`#3b82f6`) |
| `cluster-medium` | 10 – 49 markers | 44px × 44px | Deep indigo / teal border (`#4f46e5`) |
| `cluster-large` | 50+ markers | 52px × 52px | Magenta / warning border (`#d946ef`) |

```css
/* Cluster CSS Styles */
.custom-cluster-icon {
  background: transparent;
  border: none;
}

.custom-cluster {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-weight: 700;
  color: #ffffff;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
  transition: all 0.2s ease-in-out;
}

.cluster-small {
  width: 36px;
  height: 36px;
  background-color: rgba(59, 130, 246, 0.85); /* Blue */
  border: 3px solid rgba(255, 255, 255, 0.8);
}

.cluster-medium {
  width: 44px;
  height: 44px;
  background-color: rgba(79, 70, 229, 0.9); /* Indigo */
  border: 3px solid rgba(255, 255, 255, 0.8);
}

.cluster-large {
  width: 52px;
  height: 52px;
  background-color: rgba(217, 70, 239, 0.95); /* Magenta */
  border: 4px solid rgba(255, 255, 255, 0.8);
}

.custom-cluster:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.25);
}
```

### Zoom and Spiderfy Behavior
- Configure the cluster group with `showCoverageOnHover: false` to avoid messy polygon drawings on hover.
- Set `spiderfyOnMaxZoom: true` to fan out markers that share exact coordinates when zoomed in fully.

---

## 6. Mobile & iOS Considerations

Mobile devices require specific handling due to touch input constraints and varying screen sizes.

### Touch-Friendly Tap Targets
- **Size**: Touch targets should be at least **44px × 44px** to conform to Apple's iOS Human Interface Guidelines and Google Material Design standards.
- **Spacing**: Ensure markers are not cramped. Adjust the `maxClusterRadius` (default: 80px) on mobile device viewports to aggregate markers earlier, making it easier for users to tap individual clusters without mis-tapping nearby points.

### Popup Positioning
- Always use `autoPan: true` on popups so Leaflet automatically shifts the map view when a popup is opened near the edge.
- Implement bottom-sheet sheets for mobile rather than inline popups for better readability and thumb reach.
- Use `autoPanPadding: [50, 50]` to keep the popup safely away from mobile viewport boundaries.

### iOS and Safari Rendering Tweaks
- Safari can suffer from hardware-accelerated rendering issues, causing flickering or invisible layers. Add `-webkit-transform: translate3d(0,0,0);` or `backface-visibility: hidden;` to your CSS for markers.
- Touch responsiveness can be improved by adding `tap: false` to the map configuration inside Leaflet to prevent conflicts between Leaflet's custom tap listener and native browser tap triggers.

---

## 7. Performance Best Practices

To prevent map interactions from lagging (dropping frames), follow these optimization strategies:

### Lazy Loading
Only import Leaflet and the marker cluster plugin on the client-side.
- See [Leaflet.js Integration Patterns](file:///c:/Users/HP/Downloads/WorkSphere-main%20%283%29/WorkSphere-main/docs/LEAFLET_INTEGRATION.md) for loading patterns using `next/dynamic` and `require()`.

### Avoid Re-creating Icon Instances
Creating fresh instances of `L.divIcon` on every render triggers garbage collection overhead.
- Memoize your marker icons using `useMemo` so that icons are only re-created when their configuration properties (e.g., status or photo URLs) change.

```tsx
const customIcon = useMemo(() => {
  return L.divIcon({
    className: "avatar-marker",
    html: `<img src="${avatarUrl || '/placeholder.png'}" />`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}, [avatarUrl]);
```

### Map Bounds Filtering (Virtualization)
- For massive datasets (1,000+ points), do not render all markers at once.
- Fetch and render only the markers that fall inside the current map viewport using the map's current bounding box (`map.getBounds()`). Listen to the `moveend` event to update this viewport list.

---

## 8. Accessibility (a11y)

All maps and markers inside WorkSphere must remain fully accessible.

### Keyboard Navigation
Leaflet markers are keyboard focusable by default if `keyboard: true` is configured on the marker.
- Always verify that users can tab through markers on the map.
- Open popups on pressing the `Enter` or `Space` key when a marker is focused.

### ARIA Attributes and Labels
- Provide an `alt` or `title` property to markers when using image-based markers.
- For custom `L.divIcon()`, include `role="button"` and `aria-label` inside the HTML template string:

```ts
const accessibleIcon = L.divIcon({
  html: `<div role="button" aria-label="Venue location: ${venueName}" tabindex="0"></div>`,
});
```

### Color Contrast
Ensure that color classifications (e.g., active vs. inactive markers, cluster density colors) have a contrast ratio of at least 3:1 against their backgrounds (e.g., the map tile style). Do not rely solely on color; incorporate text counters or geometric icons (e.g., different shaped pins) to convey state.

---

## 9. Troubleshooting

Common issues and solutions when working with custom markers and clusters in WorkSphere:

### 1. Misaligned Markers / Jumping on Zoom
* **Symptom**: Marker shifts away from its true coordinate when zooming the map.
* **Solution**: Your `iconAnchor` is configured incorrectly. Ensure that `iconAnchor` is set to the exact pixel coordinate of the pin's base tip relative to the icon dimensions. If your icon size is `[30, 40]`, the anchor should be `[15, 40]` (center bottom).

### 2. Popups Overlapping the Marker
* **Symptom**: Map popups appear inside the marker pin or obstruct the location label.
* **Solution**: Adjust the `popupAnchor`. This value is relative to the `iconAnchor`. A value of `[0, -height]` will attach the bottom of the popup arrow to the top edge of your marker.

### 3. Missing Default Marker Images in Next.js
* **Symptom**: 404 errors for default marker images (`marker-icon.png`, `marker-shadow.png`).
* **Solution**: Next.js webpack configuration breaks Leaflet's automatic asset resolver. Copy the Leaflet asset files to the public directory and override default prototype values at startup:
  ```ts
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "/leaflet/marker-icon-2x.png",
    iconUrl: "/leaflet/marker-icon.png",
    shadowUrl: "/leaflet/marker-shadow.png",
  });
  ```

### 4. Cluster CSS Styling Not Applying
* **Symptom**: Cluster elements appear as bullet points, overlap as simple text, or lack backgrounds.
* **Solution**: Ensure you import the default `leaflet.markercluster` styles at the top of your Map component:
  ```ts
  import "leaflet.markercluster/dist/MarkerCluster.css";
  import "leaflet.markercluster/dist/MarkerCluster.Default.css";
  ```

### 5. Markers Flicker on Zoom in Safari
* **Symptom**: Leaflet layer elements flicker or vanish temporarily during zoom transitions.
* **Solution**: Force GPU composition in your custom marker CSS:
  ```css
  .leaflet-marker-icon {
    backface-visibility: hidden;
    transform: translate3d(0, 0, 0);
  }
  ```

---

## 10. Summary

### Recommended Practices
- **Always** specify `iconSize`, `iconAnchor`, and `popupAnchor` together.
- **Prefer** SVG-based vectors inside `L.divIcon()` for sharp rendering at all zoom levels.
- **Use** `leaflet.markercluster` for density management.
- **Memoize** dynamic icons to prevent re-creation on every state change.
- **Provide** distinct touch-friendly targets (>44px) for mobile devices.
- **Ensure** keyboard tabbing (`tabindex="0"`) and ARIA labels are present on custom markers.

### Common Mistakes to Avoid
- Animating non-composite CSS layout attributes (like `width`, `height`, `left`).
- Creating standard `L.divIcon` objects directly in the rendering path of a React component without `useMemo`.
- Ignoring `prefers-reduced-motion` for active pulsing animations.
- Setting `tap: true` in Safari mobile map settings, leading to double click event bugs.
