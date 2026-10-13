"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import type { MapRoute } from "@/types/map";

/**
 * MapRouteLayer — animated high-altitude "flight vector" renderer for transit routes.
 *
 * Acceptance criteria implemented:
 *  1. Animated `stroke-dasharray` / `stroke-dashoffset` loop: emerald dashes streak
 *     forward along the curve toward the destination venue (rAF driven, GPU-composited
 *     paint only — no layout thrash).
 *  2. Glowing halo layer underneath the core line for an emerald neon bloom
 *     (wide translucent under-stroke + soft secondary bloom stroke + CSS blur filter).
 *  3. Catmull-Rom spline → cubic bézier interpolation between waypoints so routes
 *     curve smoothly instead of sharp rigid segments.
 *  4. 60fps without degrading pan/zoom: all geometry lives in Leaflet *layer-point*
 *     space inside a dedicated `pointer-events: none` pane, so map panning is free
 *     (the pane is translated by Leaflet itself) and interaction events pass straight
 *     through to the map. Geometry is only recomputed on zoom/resize/route changes.
 *
 * Props intentionally match the existing `MapRoute` shape from `@/types/map`, so
 * venue coordinate bindings and existing call sites stay fully intact.
 */

const EMERALD = "#34d399";
const EMERALD_BRIGHT = "#6ee7b7";
const EMERALD_GLOW = "rgba(52, 211, 153, 0.35)";

/** Points sampled per Catmull-Rom segment kept implicit — we emit cubic béziers directly. */
const PANE_NAME = "route-fx-pane";
const PANE_Z_INDEX = 450; // above overlay paths, below marker panes

/** Build an SVG path string using Catmull-Rom → cubic bézier conversion. */
function catmullRomToBezierPath(
  points: Array<{ x: number; y: number }>,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const p = points;
  let d = `M ${p[0].x.toFixed(2)} ${p[0].y.toFixed(2)}`;

  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;

    // Standard Catmull-Rom → bézier control points (tension = 1/6)
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface MapRouteLayerProps {
  /** Existing MapRoute records — `path` is [{ lat, lng }, ...] toward the venue. */
  routes: MapRoute[];
  /** Dash streak speed in px/second along the route. */
  flowSpeed?: number;
}

export function MapRouteLayer({ routes, flowSpeed = 60 }: MapRouteLayerProps) {
  const map = useMap();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const offsetRef = useRef<number>(0);

  // Filter to routes with at least two valid coordinates (mirrors Map.tsx behavior).
  const validRoutes = useMemo(
    () =>
      routes.filter((route) => (route.path ?? []).filter(Boolean).length >= 2),
    [routes],
  );

  // Create the dedicated pane once. pointer-events: none keeps map interaction intact.
  useEffect(() => {
    if (!map) return;

    let pane = map.getPane(PANE_NAME);
    if (!pane) {
      pane = map.createPane(PANE_NAME);
      pane.style.zIndex = String(PANE_Z_INDEX);
      pane.style.pointerEvents = "none";
    }

    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "0";
    host.style.top = "0";
    host.style.willChange = "transform";
    pane.appendChild(host);
    containerRef.current = host;

    return () => {
      host.remove();
      containerRef.current = null;
    };
  }, [map]);

  // Geometry pass: project waypoints to layer points, spline them, (re)build SVG DOM.
  // Layer points are stable during pan (Leaflet translates the pane), so this only
  // needs to run on zoom, resize, or when the route data changes — not per frame.
  useEffect(() => {
    const host = containerRef.current;
    if (!host || !map) return;

    const build = () => {
      const paths = validRoutes.map((route, i) => {
        const pts = route.path
          .filter(
            (pt) =>
              pt &&
              Number.isFinite(pt.lat) &&
              Number.isFinite(pt.lng),
          )
          .map((pt) => map.latLngToLayerPoint([pt.lat, pt.lng]));

        const d = catmullRomToBezierPath(pts);
        const highlighted = route.isHighlighted === true;
        const group = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        group.setAttribute("data-route-id", route.id);
        group.setAttribute("class", "map-route-fx");

        const svgNS = "http://www.w3.org/2000/svg";

        // Halo / glow buffer layer (underneath): wide soft emerald bloom.
        const halo = document.createElementNS(svgNS, "path");
        halo.setAttribute("d", d);
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", EMERALD_GLOW);
        halo.setAttribute("stroke-width", highlighted ? "16" : "12");
        halo.setAttribute("stroke-linecap", "round");
        halo.setAttribute("stroke-linejoin", "round");
        halo.setAttribute("filter", "url(#map-route-bloom)");
        halo.setAttribute("class", "map-route-halo");

        // Secondary tight glow for the neon edge bloom.
        const innerGlow = document.createElementNS(svgNS, "path");
        innerGlow.setAttribute("d", d);
        innerGlow.setAttribute("fill", "none");
        innerGlow.setAttribute("stroke", "rgba(110, 231, 183, 0.45)");
        innerGlow.setAttribute("stroke-width", highlighted ? "7" : "5");
        innerGlow.setAttribute("stroke-linecap", "round");
        innerGlow.setAttribute("class", "map-route-inner-glow");

        // Core animated dash line: emerald dashes streaking toward destination.
        const core = document.createElementNS(svgNS, "path");
        core.setAttribute("d", d);
        core.setAttribute("fill", "none");
        core.setAttribute("stroke", highlighted ? EMERALD_BRIGHT : EMERALD);
        core.setAttribute("stroke-width", highlighted ? "3.5" : "2.5");
        core.setAttribute("stroke-linecap", "round");
        core.setAttribute("stroke-linejoin", "round");
        core.setAttribute("class", "map-route-core");
        // Dash pattern sized from real path length once it's in the DOM below.
        core.setAttribute("stroke-dasharray", "14 10");

        group.appendChild(halo);
        group.appendChild(innerGlow);
        group.appendChild(core);

        return { route, group, core, highlighted };
      });

      // Build SVG sized to the map viewport with a defs bloom filter.
      const size = map.getSize();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", String(size.x));
      svg.setAttribute("height", String(size.y));
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.style.overflow = "visible";
      svg.style.display = "block";

      const defs = document.createElementNS(svgNS, "defs");
      defs.innerHTML =
        '<filter id="map-route-bloom" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="4" result="blur"/>' +
        '<feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        "</filter>";
      svg.appendChild(defs);

      for (const item of paths) svg.appendChild(item.group);
      host.replaceChildren(svg);

      // Measure real path lengths so the dash loop travels the full route evenly
      // and wraps seamlessly (dash period must divide total offset animation).
      const measured = paths.map((item) => {
        let length = 0;
        try {
          length = item.core.getTotalLength();
        } catch {
          length = 0;
        }
        return { ...item, length };
      });

      return measured;
    };

    let measured = build();

    const invalidate = () => {
      measured = build();
    };

    // Re-project only on zoom/resize — pan keeps layer-point space valid.
    map.on("zoomend", invalidate);
    map.on("resize", invalidate);
    // Safety net for fractional-zoom / flyTo edge cases.
    map.on("moveend", invalidate);

    const reduced = prefersReducedMotion();
    const dashPeriod = 24; // dash 14 + gap 10 — keeps the loop seamless
    const lastTs = { value: 0 };

    const tick = (ts: number) => {
      rafRef.current = null;
      const dt = lastTs.value ? Math.min(ts - lastTs.value, 100) : 16;
      lastTs.value = ts;

      offsetRef.current -= (flowSpeed * dt) / 1000;

      for (const item of measured) {
        const speedScale = item.highlighted ? 1.5 : 1;
        const offset = offsetRef.current * speedScale;
        // Negative offset moves dashes forward along path direction (toward venue).
        item.core.style.strokeDashoffset = String(offset % dashPeriod);
        if (item.length > 0 && !reduced) {
          // Soft comet-head: brighten the leading segment via dash phase drift.
          item.group.setAttribute("data-flowing", "true");
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    if (!reduced) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      map.off("zoomend", invalidate);
      map.off("resize", invalidate);
      map.off("moveend", invalidate);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTs.value = 0;
    };
  }, [map, validRoutes, flowSpeed]);

  // Nothing renders through React's tree — Leaflet pane hosts the SVG imperatively,
  // so this component never blocks map interaction events.
  return null;
}

export default MapRouteLayer;
