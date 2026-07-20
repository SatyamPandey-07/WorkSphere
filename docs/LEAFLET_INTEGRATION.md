\# Leaflet.js Integration Patterns



This document explains how Leaflet is integrated into WorkSphere's Next.js app: how it avoids server-side rendering (SSR) issues, how custom markers are created, and how to safely add Leaflet plugins.



\## 1. Why Leaflet Needs Special Handling in Next.js



Leaflet reads from the `window` and `document` objects at import time (for things like `L.Icon.Default`, DOM manipulation, etc.). Since Next.js renders components on the server first, importing Leaflet (or any component that uses it) directly at the top of a server-rendered page will crash with a `window is not defined` error.



WorkSphere avoids this with two techniques used together:

1\. A \*\*dynamic import with `ssr: false`\*\* for the component that renders the map.

2\. \*\*Client-only guards\*\* (`typeof window !== "undefined"`) inside the map component itself, for any Leaflet API that touches the DOM at module-load time.



\## 2. SSR Avoidance Pattern (Dynamic Import)



The map component (`src/components/Map.tsx`) is never imported directly in a page. Instead, it's loaded via `next/dynamic` with `ssr: false`, so Next.js only renders it in the browser.



\*\*Pattern used in `src/app/ai/page.tsx`:\*\*



```tsx

import dynamic from "next/dynamic";

import { Loader2 } from "lucide-react";



// Dynamically import Map to avoid SSR issues with Leaflet

const Map = dynamic(() => import("@/components/Map"), {

&#x20; ssr: false,

&#x20; loading: () => (

&#x20;   <div

&#x20;     className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900"

&#x20;     role="status"

&#x20;     aria-live="polite"

&#x20;     aria-label="Loading interactive map"

&#x20;   >

&#x20;     <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />

&#x20;   </div>

&#x20; ),

});

```



\*\*Key points:\*\*

\- `ssr: false` is what actually prevents the component from being rendered on the server — this is the critical flag for any Leaflet-based component.

\- Always provide a `loading` fallback so the page doesn't show a blank space while the map bundle loads on the client.

\- Pair the dynamic import with an error boundary (WorkSphere uses `MapErrorBoundary` around the `<Map />` usage) so a Leaflet runtime error doesn't crash the whole page.



\*\*Rule of thumb:\*\* any file that does `import L from "leaflet"` or `import { MapContainer } from "react-leaflet"` must only ever be reached through a `dynamic(..., { ssr: false })` import — never imported directly into a Server Component or a page that renders on first load without this wrapper.



\## 3. Custom `DivIcon` Creation



Leaflet's default marker icons are raster images that are awkward to theme. WorkSphere instead builds markers from HTML/CSS using `L.divIcon`, which renders arbitrary HTML as the marker.



\*\*Pattern used in `src/components/Map.tsx`:\*\*



```tsx

import L from "leaflet";

import "leaflet/dist/leaflet.css";



let venueIcon: any;

let destinationIcon: any;



// Guard: only construct icons in the browser, never during SSR

if (typeof window !== "undefined") {

&#x20; venueIcon = L.divIcon({

&#x20;   className: "venue-marker",

&#x20;   html: `<div class="venue-dot"></div>`,

&#x20;   iconSize: \[24, 24],

&#x20;   iconAnchor: \[12, 12],

&#x20;   popupAnchor: \[0, -12],

&#x20; });



&#x20; destinationIcon = L.divIcon({

&#x20;   className: "destination-marker",

&#x20;   html: `<div class="destination-pin"><span>D</span></div>`,

&#x20;   iconSize: \[32, 32],

&#x20;   iconAnchor: \[16, 32],

&#x20;   popupAnchor: \[0, -32],

&#x20; });



&#x20; // Fix Next.js/webpack breaking Leaflet's default icon path resolution

&#x20; delete (L.Icon.Default.prototype as any).\_getIconUrl;

&#x20; L.Icon.Default.mergeOptions({

&#x20;   iconRetinaUrl: "/leaflet/marker-icon-2x.png",

&#x20;   iconUrl: "/leaflet/marker-icon.png",

&#x20;   shadowUrl: "/leaflet/marker-shadow.png",

&#x20; });

}

```



\*\*Key points:\*\*

\- The `typeof window !== "undefined"` guard is required even though this file is already client-only (via the dynamic import) — it protects against build-time/module-evaluation edge cases and keeps the icon construction colocated with the rest of the client-only setup.

\- The actual visual styling of `.venue-dot`, `.destination-pin`, etc. lives in a `<style dangerouslySetInnerHTML>` block inside the `Map` component, scoped to marker class names.

\- The `L.Icon.Default` fix (`delete \_getIconUrl` + `mergeOptions`) is a well-known workaround for a bundler issue where Leaflet's default marker image paths break under Next.js/webpack — copy the three marker PNGs into `/public/leaflet/` and reference them as shown.

\- User-specific icons (e.g. a profile-photo marker) are built dynamically with `useMemo`, swapping the `html` string based on whether a photo URL is available:

&#x20; ```tsx

&#x20; const customIcon = useMemo(() => {

&#x20;   const html = iconUrl \&\& iconUrl !== "default"

&#x20;     ? `<div class="image-marker" style="background-image: url(${iconUrl})"></div>`

&#x20;     : `<div class="default-dot-marker"></div>`;



&#x20;   return L.divIcon({

&#x20;     className: "custom-user-marker",

&#x20;     html,

&#x20;     iconSize: \[40, 40],

&#x20;     iconAnchor: \[20, 20],

&#x20;   });

&#x20; }, \[iconUrl]);

&#x20; ```



\## 4. Adding Leaflet Plugins Safely



Some Leaflet plugins (e.g. `leaflet.heat`) attach themselves to the global `L` object as a side effect of being required, and they also assume `window`/`document` exist. WorkSphere loads these with a guarded `require()` rather than a top-level `import`, so the plugin is never evaluated during SSR or in test environments.



\*\*Pattern used in `src/components/Map.tsx`:\*\*



```tsx

// Import Leaflet Heatmap Plugin safely — only on the client, and not in Jest tests

if (typeof window !== "undefined" \&\& process.env.NODE\_ENV !== "test") {

&#x20; // eslint-disable-next-line @typescript-eslint/no-require-imports

&#x20; require("leaflet.heat");

}

```



\*\*Key points:\*\*

\- `require()` (not `import`) is used deliberately here so the module is only evaluated conditionally, at runtime — a static `import` would always execute at module-load time regardless of the `if` check.

\- The `process.env.NODE\_ENV !== "test"` check additionally prevents the plugin from loading during Jest tests, where there's no real DOM environment.

\- Once loaded, the plugin extends `L` (e.g. `(L as any).heatLayer(...)`) — cast to `any` since most Leaflet plugin type definitions aren't bundled with the plugin itself.

\- Plugin layers should be added/removed inside a `useEffect` that depends on the Leaflet `map` instance (obtained via `useMap()` from `react-leaflet`), and cleaned up in the effect's return function:

&#x20; ```tsx

&#x20; function HeatmapOverlay({ points, visible }: { points: any\[]; visible: boolean }) {

&#x20;   const map = useMap();



&#x20;   useEffect(() => {

&#x20;     if (!map || !visible || points.length === 0) return;



&#x20;     const heatLayer = (L as any).heatLayer(points, {

&#x20;       radius: 30,

&#x20;       blur: 18,

&#x20;       maxZoom: 16,

&#x20;     });

&#x20;     heatLayer.addTo(map);



&#x20;     return () => {

&#x20;       if (map \&\& heatLayer) map.removeLayer(heatLayer);

&#x20;     };

&#x20;   }, \[map, points, visible]);



&#x20;   return null;

&#x20; }

&#x20; ```

\- This pattern (guarded `require`, effect-scoped `addTo`/`removeLayer`) generalizes to any other Leaflet plugin (e.g. marker clustering, draw tools) — the same guard and cleanup approach should be followed for consistency.



\## 5. Checklist for Adding New Leaflet Features



\- \[ ] Never import Leaflet or `react-leaflet` directly into a page/Server Component — always go through a component that is itself loaded via `dynamic(..., { ssr: false })`.

\- \[ ] Wrap any Leaflet-dependent component tree in an error boundary so a runtime failure doesn't take down the whole page.

\- \[ ] Guard any Leaflet API call that runs at module-evaluation time with `typeof window !== "undefined"`.

\- \[ ] Load third-party Leaflet plugins with a guarded `require()`, not a static `import`, and skip loading in test environments.

\- \[ ] Add/remove plugin layers inside a `useEffect` scoped to the `map` instance from `useMap()`, always cleaning up with `map.removeLayer(...)` in the effect's return function.

\- \[ ] Keep marker/plugin-specific CSS scoped to unique class names to avoid clashing with Leaflet's own default styles.

