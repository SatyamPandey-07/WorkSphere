"use client";

import { useUser, useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  LayersControl,
  LayerGroup,
  CircleMarker,
  ScaleControl,
} from "react-leaflet";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapMarker, MapRoute, MapView } from "@/types/map";
import { AccessibleMarker } from "@/components/ui/MapMarker";
import { WebGLHeatmapLayer } from "./WebGLHeatmapLayer";
import {
  useSeatAvailability,
  type SeatStatus,
} from "@/hooks/useSeatAvailability";
import usePartySocket from "@/hooks/usePartySocketReconnect";

function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number,
): T {
  let inThrottle = false;
  return function (this: any, ...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  } as unknown as T;
}

// Seat-availability ring colours (#703): green = plenty of room, yellow =
// filling up, red = at/over capacity.
const SEAT_RING_COLORS: Record<SeatStatus, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

// Import Leaflet Heatmap Plugin safely only on client-side and not in Jest tests
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("leaflet.heat");
}

// Custom venue marker for dark theme - purple/blue dot - client-safe setup
let venueIcon: any;
let destinationIcon: any;

if (typeof window !== "undefined") {
  venueIcon = L.divIcon({
    className: "venue-marker",
    html: `<div class="venue-dot"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });

  // Destination marker - like the reference image
  destinationIcon = L.divIcon({
    className: "destination-marker",
    html: `<div class="destination-pin"><span>D</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });

  // Also fix the global default:
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "/leaflet/marker-icon-2x.png",
    iconUrl: "/leaflet/marker-icon.png",
    shadowUrl: "/leaflet/marker-shadow.png",
  });
}

function MapController({ mapView }: { mapView: MapView | null }) {
  const map = useMap();
  useEffect(() => {
    if (mapView && mapView.center && mapView.zoom) {
      if (mapView.animate) {
        map.flyTo([mapView.center.lat, mapView.center.lng], mapView.zoom);
      } else {
        map.setView([mapView.center.lat, mapView.center.lng], mapView.zoom);
      }
    }
  }, [mapView, map]);

  return null;
}

function AutoCenter({
  markers,
  userLocation,
}: {
  markers: MapMarker[];
  userLocation: [number, number];
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const bounds = L.latLngBounds([
      userLocation,
      ...markers.map(
        (m) => [m.position.lat, m.position.lng] as [number, number],
      ),
    ]);

    if (markers.length > 0) {
      map.flyToBounds(bounds, { padding: [100, 100] });
    } else {
      map.setView(userLocation, 13);
    }
  }, [markers, userLocation, map]);

  return null;
}

// Tracks the map's settled zoom level so spiderfied marker offsets can be
// recalculated relative to it. The `zoomend` handler is debounced so that
// rapid zoom actions (e.g. zoom out then quickly double-click to zoom in)
// don't trigger a recalculation on every intermediate animation frame -
// only once the zoom transition has actually settled, avoiding the stale
// pre-zoom offsets that caused clustered markers to render on top of each
// other mid-transition.
function ZoomWatcher({
  onZoomSettled,
  onZoomStart,
  delay = 150,
}: {
  onZoomSettled: (zoom: number) => void;
  onZoomStart?: () => void;
  delay?: number;
}) {
  const map = useMap();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const handleZoomStart = () => {
      clearTimeout(timer);
      onZoomStart?.();
    };

    const handleZoomEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onZoomSettled(map.getZoom()), delay);
    };

    map.on("zoomstart", handleZoomStart);
    map.on("zoomend", handleZoomEnd);
    handleZoomEnd(); // capture the initial zoom too

    return () => {
      clearTimeout(timer);
      map.off("zoomstart", handleZoomStart);
      map.off("zoomend", handleZoomEnd);
    };
  }, [map, onZoomSettled, onZoomStart, delay]);

  return null;
}

import { createLayerComponent } from "@react-leaflet/core";

const CROWD_GRADIENT = {
  0.3: "#1e3a8a", // Deep Blue (Quiet)
  0.55: "#3b82f6", // Bright Blue (Moderate)
  0.8: "#8b5cf6", // Velvet Purple (Busy)
  1.0: "#d946ef", // Neon Pink/Fuchsia (High Activity levels)
};

const createHeatLayer = (props: any, context: any) => {
  const layer = (L as any).heatLayer(props.points, {
    radius: 30,
    blur: 18,
    maxZoom: 16,
    gradient: props.gradient || CROWD_GRADIENT,
  });
  return { instance: layer, context };
};

const updateHeatLayer = (instance: any, props: any, prevProps: any) => {
  if (props.points !== prevProps.points) {
    instance.setLatLngs(props.points);
  }
  if (props.gradient !== prevProps.gradient) {
    instance.setOptions({ gradient: props.gradient || CROWD_GRADIENT });
  }
};

const HeatmapOverlay = createLayerComponent(createHeatLayer, updateHeatLayer);
function ResizeWatcher({ delay = 150 }: { delay?: number }) {
  const map = useMap();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const handleResize = () => {
      clearTimeout(timer);
      const centerBeforeResize = map.getCenter();

      timer = setTimeout(() => {
        map.invalidateSize();
        map.setView(centerBeforeResize, map.getZoom(), { animate: false });
      }, delay);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [map, delay]);

  return null;
}
function MapEvents({
  onMouseMove,
}: {
  onMouseMove: (latlng: L.LatLng) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const handleMouseMove = ({ latlng }: L.LeafletMouseEvent) => {
      onMouseMove(latlng);
    };
    map.on("mousemove", handleMouseMove);
    return () => {
      map.off("mousemove", handleMouseMove);
    };
  }, [map, onMouseMove]);
  return null;
}

const createCursorIcon = (avatarUrl: string, name: string) => {
  if (typeof window === "undefined") return null;
  let html: string;
  if (avatarUrl && avatarUrl !== "default" && avatarUrl.startsWith("http")) {
    html = `
      <div class="map-cursor-container">
        <div class="map-cursor-avatar" style="background-image: url(${avatarUrl})"></div>
        <div class="map-cursor-label">${name}</div>
      </div>
    `;
  } else {
    html = `
      <div class="map-cursor-container">
        <div class="map-cursor-avatar-default"></div>
        <div class="map-cursor-label">${name}</div>
      </div>
    `;
  }
  return L.divIcon({
    className: "map-presence-marker",
    html,
    iconSize: [32, 48],
    iconAnchor: [16, 16],
  });
};

import { attachWebGLContextRecovery } from "@/lib/webgl/contextManager";

function WebGLContextWatcher() {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof map.getContainer !== "function") return;
    const container = map.getContainer();
    if (!container) return;
    const cleanups: Array<() => void> = [];

    const setupCanvases = () => {
      const canvases = container.querySelectorAll("canvas");
      canvases.forEach((canvas) => {
        const cleanup = attachWebGLContextRecovery(
          canvas as HTMLCanvasElement,
          () => {
            map.invalidateSize();
          },
        );
        cleanups.push(cleanup);
      });
    };

    setupCanvases();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setupCanvases();
        map.invalidateSize();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cleanups.forEach((c) => c());
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [map]);

  return null;
}

const Map = ({
  location,
  markers,
  routes,
  mapView,
  roomId,
}: {
  location: { latitude: number; longitude: number };
  markers: MapMarker[];
  routes: MapRoute[];
  mapView: MapView | null;
  roomId?: string | null;
}) => {
  const clerkUser = useUser();
  const { theme } = useTheme();
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    getToken()
      .then(setToken)
      .catch(() => setToken(null));
  }, [getToken]);

  interface MapCursor {
    lat: number;
    lng: number;
    name: string;
    avatar: string;
  }

  const [mapCursors, setMapCursors] = useState<Record<string, MapCursor>>({});
  const cursorLastSeen = useRef<Record<string, number>>({});

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMapCursors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [userId, lastSeen] of Object.entries(
          cursorLastSeen.current,
        )) {
          if (now - lastSeen > 3000) {
            delete next[userId];
            delete cursorLastSeen.current[userId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const socket = usePartySocket({
    host: "127.0.0.1:1999",
    room: isMounted && roomId ? roomId : "placeholder",
    startClosed: !isMounted,
    query: token ? { token } : undefined,
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "map-cursor") {
          const userId = data.userId || data.name;
          cursorLastSeen.current[userId] = Date.now();
          setMapCursors((prev) => ({
            ...prev,
            [userId]: {
              lat: data.lat,
              lng: data.lng,
              name: data.name,
              avatar: data.avatar,
            },
          }));
        } else if (data.type === "map-cursor-offline") {
          const userId = data.userId || data.name;
          delete cursorLastSeen.current[userId];
          setMapCursors((prev) => {
            if (!(userId in prev)) return prev;
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      } catch {
        // Ignore
      }
    },
  });

  const userRef = useRef(clerkUser);
  useEffect(() => {
    userRef.current = clerkUser;
  }, [clerkUser]);

  const throttledBroadcastRef = useRef<((latlng: L.LatLng) => void) | null>(
    null,
  );

  useEffect(() => {
    throttledBroadcastRef.current = throttle((latlng: L.LatLng) => {
      if (socket && socket.readyState === 1) {
        const user = userRef.current.user;
        socket.send(
          JSON.stringify({
            type: "map-cursor",
            lat: latlng.lat,
            lng: latlng.lng,
            name: user?.firstName || "Anonymous",
            avatar: user?.imageUrl || "default",
            userId: user?.id || "anonymous",
          }),
        );
      }
    }, 50);
  }, [socket]);

  const throttledBroadcast = useCallback((latlng: L.LatLng) => {
    if (throttledBroadcastRef.current) {
      throttledBroadcastRef.current(latlng);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (socket && socket.readyState === 1) {
        const user = userRef.current.user;
        try {
          socket.send(
            JSON.stringify({
              type: "map-cursor-offline",
              name: user?.firstName || "Anonymous",
              userId: user?.id || "anonymous",
            }),
          );
        } catch {
          // ignore
        }
      }
    };
  }, [socket]);
  const { latitude, longitude } = location;
  const routingPanelRef = useRef<HTMLDivElement>(null);
  // Forecast selector state
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDay()); // 0=Sun
  const [selectedHour, setSelectedHour] = useState<number>(
    new Date().getHours(),
  );

  // Real-time seat availability (#703) — PartyKit presence layer that
  // powers the green/yellow/red rings and the popup check-in button.
  const {
    getAvailability,
    checkIn,
    checkOut,
    checkedInVenueId,
    isConnected: isSeatSocketConnected,
  } = useSeatAvailability();

  // Prevent touch/mouse/scroll event propagation on overlays from bubbling to Leaflet Map
  useEffect(() => {
    const el = routingPanelRef.current;
    if (!el) return;

    if (L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }

    // Stop touch and pointer events from propagating to prevent map dragging/panning
    const stopPropagation = (e: Event) => {
      e.stopPropagation();
    };

    const events = [
      "touchstart",
      "touchmove",
      "touchend",
      "pointerdown",
      "pointermove",
      "pointerup",
      "mousedown",
      "mousemove",
      "mouseup",
    ];

    events.forEach((event) => {
      el.addEventListener(event, stopPropagation, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        el.removeEventListener(event, stopPropagation);
      });
    };
  }, []);

  // Settled zoom level (debounced via ZoomWatcher), used to keep spiderfied
  // marker offsets at a consistent on-screen pixel separation regardless of
  // how far the user has zoomed in/out.
  const [settledZoom, setSettledZoom] = useState<number>(13);
  const [isZooming, setIsZooming] = useState(false);
  const handleZoomSettled = useCallback((zoom: number) => {
    setSettledZoom(zoom);
    setIsZooming(false);
  }, []);

  // Collapse spiderfied markers to their center positions during zoom
  // transitions so overlapping offsets don't render mid-animation,
  // then respiderfy after the zoom settles (handled via handleZoomSettled).
  const handleZoomStart = useCallback(() => {
    setIsZooming(true);
  }, []);

  // =========================================================================
  // MULTI-STOP ROUTING OPTIMIZER STATE PARAMETERS
  // =========================================================================
  const [routingQueue, setRoutingQueue] = useState<any[]>([]);
  const [optimizedRoute, setOptimizedRoute] = useState<any>(null);
  const [travelProfile, setTravelProfile] = useState<
    "walking" | "cycling" | "driving"
  >("walking");

  // OSRM Multi-Stop coordinate solver engine
  const calculateOptimizedRoute = async (venuesList = routingQueue) => {
    if (venuesList.length < 2) {
      setOptimizedRoute(null);
      return;
    }

    // Guard: remove consecutive duplicate stops (same lat/lng) —
    // sending identical consecutive coordinates to OSRM can trigger
    // a crash/error response.
    const dedupedList = venuesList.filter((venue, idx) => {
      if (idx === 0) return true;
      const prev = venuesList[idx - 1];
      return !(
        venue.latitude === prev.latitude && venue.longitude === prev.longitude
      );
    });

    if (dedupedList.length < 2) {
      setOptimizedRoute(null);
      return;
    }

    // Validate coordinates before sending to OSRM — low accuracy or invalid
    // coordinates (0,0 or out of range) cause routing failures.
    const isValidCoord = (v: any) => {
      const lat = Number(v.latitude);
      const lng = Number(v.longitude);
      return (
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180 &&
        !(lat === 0 && lng === 0)
      );
    };
    const validList = dedupedList.filter(isValidCoord);
    if (validList.length < 2) {
      console.warn("[OSRM] Not enough valid coordinates for routing");
      setOptimizedRoute(null);
      return;
    }

    const coordinatesString = validList
      .map((venue) => `${venue.longitude},${venue.latitude}`)
      .join(";");

    const osrmProfile =
      travelProfile === "walking"
        ? "foot"
        : travelProfile === "cycling"
          ? "bicycle"
          : "driving";
    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${coordinatesString}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.code === "Ok") {
        setOptimizedRoute({
          coordinates: data.routes[0].geometry.coordinates.map(
            (coord: [number, number]) => [coord[1], coord[0]],
          ),
          duration: data.routes[0].duration,
          distance: data.routes[0].distance,
          legs: data.routes[0].legs,
        });
      }
    } catch (error) {
      console.error("OSRM Multi-Stop routing resolution failed:", error);
    }
  };

  // Track heatmap states
  const [heatmapPoints, setHeatmapPoints] = useState<any[]>([]);

  // Noise-level heatmap states (Issue #135)
  const [noiseHeatmapPoints, setNoiseHeatmapPoints] = useState<any[]>([]);

  // Green (<45dB) -> Yellow (45-65dB) -> Red (>65dB), banded rather than
  // blended so the zones read as distinct quiet/moderate/loud regions.
  const NOISE_GRADIENT = {
    0.0: "#22c55e",
    0.357: "#22c55e",
    0.358: "#eab308",
    0.643: "#eab308",
    0.644: "#ef4444",
    1.0: "#ef4444",
  };

  // Async load data context when layer UI toggles active
  // Fetch heatmap points for selected day and hour (forecast)
  useEffect(() => {
    // Debounce fetch to avoid rapid requests when sliding time
    const timer = setTimeout(() => {
      const url = `/api/map/forecast-heatmap?day=${selectedDay}&hour=${selectedHour}`;
      fetch(url)
        .then((res) => res.json())
        .then((resData) => {
          if (resData.success) {
            setHeatmapPoints(resData.data);
          }
        })
        .catch((err) =>
          console.error("Could not populate forecast heatmap", err),
        );
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedDay, selectedHour]);

  useEffect(() => {
    fetch("/api/map/noise-heatmap")
      .then((res) => res.json())
      .then((resData) => {
        if (resData.success) {
          setNoiseHeatmapPoints(resData.data);
        }
      })
      .catch((err) =>
        console.error("Could not populate noise heatmap context", err),
      );
  }, []);

  // Compute WebGL GPU Heatmap Telemetry Points (combining forecast telemetry & markers)
  const webglTelemetryPoints = useMemo(() => {
    if (heatmapPoints && heatmapPoints.length > 0) {
      return heatmapPoints.map((pt: any) => ({
        lat: Number(pt[0]),
        lng: Number(pt[1]),
        intensity: pt[2] != null ? Number(pt[2]) : 0.75,
        radius: 32,
      }));
    }
    // Fallback: map venue markers to telemetry point data
    return markers
      .filter((m) => m.position?.lat != null && m.position?.lng != null)
      .map((m) => ({
        lat: Number(m.position.lat),
        lng: Number(m.position.lng),
        intensity: 0.85,
        radius: 36,
      }));
  }, [heatmapPoints, markers]);

  // Group and spiderfy overlapping markers
  const spiderfiedMarkers = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    markers.forEach((m) => {
      if (
        m &&
        m.position &&
        m.position.lat != null &&
        m.position.lng != null &&
        !isNaN(Number(m.position.lat)) &&
        !isNaN(Number(m.position.lng))
      ) {
        const key = `${Number(m.position.lat).toFixed(6)},${Number(m.position.lng).toFixed(6)}`;
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(m);
      }
    });

    const result: any[] = [];
    Object.keys(groups).forEach((key) => {
      const groupItems = groups[key];
      const n = groupItems.length;
      if (n === 1 || isZooming) {
        result.push({
          ...groupItems[0],
          renderedLat: Number(groupItems[0].position.lat),
          renderedLng: Number(groupItems[0].position.lng),
        });
      } else {
        const centerLat = Number(groupItems[0].position.lat);
        const centerLng = Number(groupItems[0].position.lng);

        // Keep a consistent ~24px on-screen separation between spiderfied
        // markers at any zoom level, instead of a fixed degree offset that
        // only looked right at the default zoom and collapsed to
        // sub-pixel distances once the user zoomed out (Web Mercator
        // meters-per-pixel formula).
        const metersPerPixel =
          (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) /
          Math.pow(2, settledZoom);
        const targetPixelSeparation = 24 + 2 * n; // spread out a bit more if many markers share the location
        const radius = (metersPerPixel * targetPixelSeparation) / 111320; // meters -> degrees latitude

        groupItems.forEach((item, index) => {
          const angle = (2 * Math.PI * index) / n;
          const offsetLat = centerLat + radius * Math.cos(angle);
          const offsetLng = centerLng + radius * Math.sin(angle);
          result.push({
            ...item,
            renderedLat: offsetLat,
            renderedLng: offsetLng,
          });
        });
      }
    });
    return result;
  }, [markers, settledZoom, isZooming]);

  // Derive iconUrl directly from clerkUser state
  const iconUrl = useMemo(() => {
    if (clerkUser.isLoaded && clerkUser.user?.hasImage) {
      return clerkUser.user.imageUrl;
    } else if (clerkUser.isLoaded) {
      return "default";
    }
    return null;
  }, [clerkUser.isLoaded, clerkUser.user]);

  // Derive customIcon from iconUrl
  const customIcon = useMemo(() => {
    let html: string;

    if (iconUrl && iconUrl !== "default") {
      html = `<div class="image-marker" style="background-image: url(${iconUrl})"></div>`;
    } else {
      html = `<div class="default-dot-marker"></div>`;
    }

    return L.divIcon({
      className: "custom-user-marker",
      html: html,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }, [iconUrl]);

  const center: [number, number] = [latitude, longitude];
  const tileUrl =
    theme === "light"
      ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      : theme === "cyberpunk"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* Webkit/iOS Safari hardware acceleration fixes to prevent overlapping/jitter during zoom animations */
        .leaflet-marker-icon, .leaflet-pane {
          will-change: transform;
        }
        .custom-user-marker {
          /* This container itself doesn't need styles */
        }
        .image-marker {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background-size: cover;
          background-position: center;
          border: 3px solid #3b82f6; /* Blue border for dark theme */
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5), 0 2px 8px rgba(0, 0, 0, 0.5);
          will-change: transform;
        }
        .default-dot-marker {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background-color: #3b82f6;
          border: 3px solid white;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5), 0 2px 8px rgba(0, 0, 0, 0.5);
          /* Offset for iconAnchor */
          transform: translate(10px, 10px);
          will-change: transform;
        }

        /* Fix for Next.js/Leaflet width/height bug */
        .leaflet-container {
          width: 100%;
          height: 100%;
          border-radius: 12px;
        }
        
        /* UPDATED: Target map tiles specifically so they don't hide the heatmap canvas */
        .leaflet-layer {
          filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7);
        }

        /* NEW: Keeps the glowing canvas layer clean and visible */
        .leaflet-heatmap-layer {
          z-index: 400 !important;
          mix-blend-mode: screen;
          filter: none !important; /* Forces the browser to keep full color saturation */
        }

        /* WebGL GPU Heatmap Canvas Overlay (#818) */
        .leaflet-webgl-heatmap-layer {
          z-index: 401 !important;
          mix-blend-mode: screen;
          filter: none !important;
          pointer-events: none;
        }
        
        /* GPU-accelerated pulsing keyframes */
        @keyframes markerPulse {
          0% {
            transform: scale(0.8);
            opacity: 0.5;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }

        /* Venue marker - circular dot */
        .venue-dot {
          position: relative;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          border: 3px solid white;
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
          transform: translate(2px, 2px);
          will-change: transform;
        }
        
        /* Pulse ring around venue markers */
        .venue-dot::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          background: rgba(139, 92, 246, 0.4);
          animation: markerPulse 2.5s cubic-bezier(0.24, 0, 0.38, 1) infinite;
          will-change: transform, opacity;
          z-index: -1;
        }

        /* Destination pin marker */
        .destination-pin {
          position: relative;
          width: 32px;
          height: 32px;
          border-radius: 50% 50% 50% 0;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          transform: rotate(-45deg);
          border: 2px solid white;
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.6), 0 4px 8px rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
        /* Animated User Cursors Presence styles */
        .map-presence-marker {
          transition: transform 0.08s linear;
          will-change: transform;
          z-index: 1000 !important;
        }
        .map-cursor-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
        }
        .map-cursor-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background-size: cover;
          background-position: center;
          border: 2px solid #ef4444; /* Vibrant Red border for presence indicators */
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.5), 0 1px 4px rgba(0, 0, 0, 0.3);
        }
        .map-cursor-avatar-default {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background-color: #ef4444;
          border: 2px solid white;
          box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
        }
        .map-cursor-label {
          background-color: rgba(239, 68, 68, 0.9);
          color: white;
          font-size: 9px;
          font-weight: bold;
          padding: 1px 6px;
          border-radius: 4px;
          margin-top: 2px;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          pointer-events: none;
        }

        /* Disable animation on reduced motion/low performance mode */
        @media (prefers-reduced-motion: reduce) {
          .venue-dot::after {
            animation: none !important;
            display: none !important;
          }
        }
        .destination-pin span {
          transform: rotate(45deg);
          color: white;
          font-weight: bold;
          font-size: 14px;
        }
        
        /* Leaflet popup styling for dark theme */
        .leaflet-popup-content-wrapper {
          background: rgba(30, 30, 30, 0.95);
          color: white;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }
        .leaflet-popup-tip {
          background: rgba(30, 30, 30, 0.95);
        }
        .leaflet-popup-content {
          margin: 12px 16px;
        }
        
        /* Focus-visible ring for keyboard-navigated markers */
        .venue-marker:focus-visible,
        .destination-marker:focus-visible,
        .custom-user-marker:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
          border-radius: 50%;
        }

        /* Floating toggle position above canvas layers */
        .map-noise-toggle {
          position: absolute;
          top: 68px;
          right: 20px;
          z-index: 1000;
        }
        .map-forecast-controls {
          position: absolute;
          top: 120px;
          right: 20px;
          z-index: 1000;
          background: rgba(24,24,27,0.9);
          padding: 8px 12px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: #f4f4f5;
        }
        .map-forecast-controls select,
        .map-forecast-controls input[type="range"] {
          width: 120px;
        }
  .leaflet-control-scale {
  background: transparent;
}

.leaflet-control-scale-line {
  border: 1px solid #3f3f46;
  background: rgba(24, 24, 27, 0.9);
  color: #f4f4f5;
}
      `,
        }}
      />

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {spiderfiedMarkers.length > 0
          ? `${spiderfiedMarkers.length} venue${spiderfiedMarkers.length === 1 ? "" : "s"} on map. Use Tab to navigate markers, Enter to open details.`
          : "No venues on map"}
      </div>
      <MapContainer
        center={center}
        zoom={13}
        maxZoom={18}
        preferCanvas={true}
        style={{
          width: "95%",
          height: "95%",
          borderRadius: "12px",
          position: "relative",
        }}
      >
        <ScaleControl position="bottomleft" metric={true} imperial={false} />
        {/* Forecast selector UI */}
        <div className="map-forecast-controls">
          <label htmlFor="day-select">Day</label>
          <select
            id="day-select"
            value={selectedDay}
            onChange={(e) => setSelectedDay(parseInt(e.target.value))}
          >
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
            <option value={2}>Tuesday</option>
            <option value={3}>Wednesday</option>
            <option value={4}>Thursday</option>
            <option value={5}>Friday</option>
            <option value={6}>Saturday</option>
          </select>
          <label htmlFor="hour-range">Hour</label>
          <input
            id="hour-range"
            type="range"
            min={0}
            max={23}
            value={selectedHour}
            onChange={(e) => setSelectedHour(parseInt(e.target.value))}
          />
          <span>{selectedHour}:00</span>
        </div>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url={tileUrl}
              className="map-tiles-dark"
              maxZoom={18}
              maxNativeZoom={18}
              keepBuffer={4}
              updateWhenIdle={true}
            />
          </LayersControl.BaseLayer>

          <LayersControl.Overlay checked name="GPU WebGL Heatmap (60 FPS)">
            <LayerGroup>
              <WebGLHeatmapLayer
                points={webglTelemetryPoints}
                opacity={0.85}
                blur={1.0}
              />
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay name="Live Crowd Heatmap">
            <HeatmapOverlay points={heatmapPoints} />
          </LayersControl.Overlay>

          <LayersControl.Overlay name="Noise Levels">
            <HeatmapOverlay
              points={noiseHeatmapPoints}
              gradient={NOISE_GRADIENT}
            />
          </LayersControl.Overlay>

          <LayersControl.Overlay name="Seat Availability">
            <LayerGroup>
              {spiderfiedMarkers
                .filter((marker) => !marker.id.includes("dest"))
                .map((marker) => {
                  const seat = getAvailability(marker.id);
                  return (
                    <CircleMarker
                      key={`seat-ring-${marker.id}`}
                      center={[marker.renderedLat, marker.renderedLng]}
                      radius={16}
                      pathOptions={{
                        color: SEAT_RING_COLORS[seat.status],
                        weight: 3,
                        opacity: 0.9,
                        fillOpacity: 0,
                      }}
                    />
                  );
                })}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>

        <MapController mapView={mapView} />
        <AutoCenter markers={markers} userLocation={center} />
        <ZoomWatcher
          onZoomSettled={handleZoomSettled}
          onZoomStart={handleZoomStart}
        />
        <ResizeWatcher />
        <WebGLContextWatcher />

        {customIcon && (
          <AccessibleMarker
            position={center}
            icon={customIcon}
            name="Your location"
          >
            <div className="text-sm text-white">You are here!</div>
          </AccessibleMarker>
        )}
        <MapEvents onMouseMove={throttledBroadcast} />
        {Object.entries(mapCursors).map(([userId, cursor]) => {
          const presenceIcon = createCursorIcon(cursor.avatar, cursor.name);
          if (!presenceIcon) return null;
          return (
            <Marker
              key={`presence-${userId}`}
              position={[cursor.lat, cursor.lng]}
              icon={presenceIcon}
              interactive={false}
            />
          );
        })}
        {spiderfiedMarkers.map((marker) => (
          <AccessibleMarker
            key={marker.id}
            position={[marker.renderedLat, marker.renderedLng]}
            icon={marker.id.includes("dest") ? destinationIcon : venueIcon}
            name={marker.name}
            category={marker.category}
            isDestination={marker.id.includes("dest")}
          >
            <div className="text-sm">
              <div className="font-semibold text-white">{marker.name}</div>
              {marker.category && (
                <div className="text-zinc-400">{marker.category}</div>
              )}
              {marker.address && (
                <div className="text-zinc-500 text-xs mt-1">
                  {marker.address}
                </div>
              )}
              {!marker.id.includes("dest") &&
                (() => {
                  const seat = getAvailability(marker.id);
                  const isCheckedInHere = checkedInVenueId === marker.id;
                  const seatTextColor =
                    seat.status === "red"
                      ? "text-red-400"
                      : seat.status === "yellow"
                        ? "text-yellow-400"
                        : "text-green-400";
                  return (
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-800 pt-2">
                      <span
                        className={`text-[10px] font-medium ${seatTextColor}`}
                      >
                        {isSeatSocketConnected
                          ? `${seat.count}/${seat.capacity} checked in`
                          : "Connecting…"}
                      </span>
                      <button
                        onClick={() =>
                          isCheckedInHere ? checkOut() : checkIn(marker.id)
                        }
                        className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                          isCheckedInHere
                            ? "accent-bg text-white hover:opacity-90"
                            : "bg-zinc-800 text-zinc-200 hover:accent-bg hover:text-white"
                        }`}
                      >
                        {isCheckedInHere ? "Check out" : "Check in here"}
                      </button>
                    </div>
                  );
                })()}
            </div>
            <button
              onClick={() => {
                // Prevent duplicates in queue chain matrix
                if (!routingQueue.some((v) => v.id === marker.id)) {
                  const updated = [
                    ...routingQueue,
                    {
                      id: marker.id,
                      name: marker.name,
                      latitude: Number(marker.position.lat),
                      longitude: Number(marker.position.lng),
                    },
                  ];
                  setRoutingQueue(updated);
                  calculateOptimizedRoute(updated);
                }
              }}
              className="mt-2 w-full rounded bg-zinc-800 py-1 text-[10px] font-medium text-zinc-200 hover:accent-bg hover:text-white transition-colors"
            >
              ➕ Add to Workday Timeline
            </button>
          </AccessibleMarker>
        ))}

        {/* Render OSRM Optimized Multi-Stop Routing Layer Geometry */}
        {optimizedRoute &&
          optimizedRoute.coordinates &&
          optimizedRoute.coordinates.length > 1 && (
            <Polyline
              positions={optimizedRoute.coordinates}
              pathOptions={{
                color: "#3b82f6", // Electric Blue for Multi-Stop Leg paths
                weight: 6,
                opacity: 0.9,
                lineCap: "round",
                lineJoin: "round",
                dashArray: travelProfile === "walking" ? "5, 10" : undefined, // Dotted path line if walking
              }}
            >
              <Popup
                autoPanPaddingTopLeft={[20, 90]}
                autoPanPaddingBottomRight={[20, 20]}
              >
                <div className="text-sm text-white">
                  <div className="font-bold text-blue-400">
                    Optimized Hybrid Schedule
                  </div>
                  <div>
                    Total Distance:{" "}
                    {(optimizedRoute.distance / 1000).toFixed(2)} km
                  </div>
                  <div>
                    Est. Travel Time: {Math.round(optimizedRoute.duration / 60)}{" "}
                    mins
                  </div>
                </div>
              </Popup>
            </Polyline>
          )}

        {routes.map((route) => {
          const validPositions = (route.path || [])
            .filter(
              (p) =>
                p &&
                p.lat != null &&
                p.lng != null &&
                !isNaN(Number(p.lat)) &&
                !isNaN(Number(p.lng)),
            )
            .map((p) => [Number(p.lat), Number(p.lng)] as [number, number]);

          if (validPositions.length < 2) return null;

          return (
            <Polyline
              key={route.id}
              positions={validPositions}
              pathOptions={{
                color: "#22c55e",
                weight: 6,
                opacity: 0.9,
                lineCap: "round",
                lineJoin: "round",
              }}
            >
              {route.distance && (
                <Popup>
                  <div className="text-sm">
                    Distance: {(route.distance / 1000).toFixed(1)} km
                    {route.duration && (
                      <div>Time: {Math.round(route.duration / 60)} min</div>
                    )}
                  </div>
                </Popup>
              )}
            </Polyline>
          );
        })}
        {/* MULTI-STOP ROUTING OPTIMIZER CONTROL INTERFACE OVERLAY */}
        <div
          ref={routingPanelRef}
          className="absolute bottom-6 left-6 z-[1000] w-80 rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 text-white shadow-2xl backdrop-blur-md"
        >
          <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
            <h3 className="font-semibold text-sm tracking-wide text-zinc-200">
              📍 ROUTING OPTIMIZER
            </h3>
            {routingQueue.length > 0 && (
              <button
                onClick={() => {
                  setRoutingQueue([]);
                  setOptimizedRoute(null);
                }}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear Queue
              </button>
            )}
          </div>

          {/* Travel Mode Selectors */}
          <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-zinc-900 p-1 text-xs">
            {(["walking", "cycling", "driving"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setTravelProfile(mode)}
                className={`rounded-md py-1.5 font-medium cursor-pointer uppercase transition-all ${
                  travelProfile === mode
                    ? "accent-bg text-white shadow"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {mode === "walking"
                  ? "🚶‍♂️ Walk"
                  : mode === "cycling"
                    ? "🚴‍♂️ Bike"
                    : "🚗 Drive"}
              </button>
            ))}
          </div>

          {/* Queue Timeline Slots */}
          {routingQueue.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Click markers or venue listings to chain multiple destinations
              into your hybrid workday route!
            </div>
          ) : (
            <div className="space-y-2">
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {routingQueue.map((venue, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg bg-zinc-900 p-2 text-xs border border-zinc-800"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-950 text-[10px] font-bold text-blue-400 border border-blue-800/50">
                        {idx + 1}
                      </span>
                      <span className="truncate font-medium text-zinc-300">
                        {venue.name}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const updated = routingQueue.filter(
                          (_, i) => i !== idx,
                        );
                        setRoutingQueue(updated);
                        calculateOptimizedRoute(updated);
                      }}
                      className="ml-2 text-zinc-500 hover:text-zinc-300 text-sm"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Optimize Trigger Action Button */}
              {routingQueue.length >= 2 && (
                <button
                  onClick={() => calculateOptimizedRoute()}
                  className="mt-3 w-full rounded-lg py-2 text-xs font-semibold text-white shadow-lg transition-all active:scale-[0.98]"
                  style={{
                    background: `linear-gradient(to right, var(--primary-accent), color-mix(in srgb, var(--primary-accent) 80%, #4f46e5))`,
                  }}
                >
                  🚀 Calculate Combined Travel Timeline
                </button>
              )}
            </div>
          )}

          {/* Dynamic Journey Metric Matrix */}
          {optimizedRoute && (
            <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400 space-y-1">
              <div className="flex justify-between">
                <span>Total Distance:</span>
                <span className="font-semibold text-zinc-200">
                  {(optimizedRoute.distance / 1000).toFixed(2)} km
                </span>
              </div>
              <div className="flex justify-between">
                <span>Est. Transit Time:</span>
                <span className="font-semibold text-zinc-200">
                  {Math.round(optimizedRoute.duration / 60)} mins
                </span>
              </div>
            </div>
          )}
        </div>
      </MapContainer>
    </>
  );
};

export default Map;
