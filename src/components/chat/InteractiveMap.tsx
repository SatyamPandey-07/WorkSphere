"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  calculateDistanceMeters,
  GEOFENCE_RADIUS_METERS,
  isOutsideGeofence,
  type Coordinates,
} from "@/lib/geo/geofence";
import {
  Map as MapIcon,
  Sun,
  Moon,
  Plus,
  Minus,
  RotateCcw,
} from "lucide-react";

// Fix for default leaflet icons in React
if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

/**
 * Detects whether the current device is a touch-only mobile device without a fine pointer.
 */
export function isTouchOnlyDevice(): boolean {
  if (typeof window === "undefined") return false;
  const matchMedia =
    typeof window.matchMedia === "function"
      ? window.matchMedia.bind(window)
      : null;
  if (!matchMedia) return false;
  const hasCoarse = matchMedia("(pointer: coarse)")?.matches ?? false;
  const hasFine = matchMedia("(pointer: fine)")?.matches ?? false;
  if (hasCoarse && !hasFine) return true;
  const hasTouch =
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0);
  return hasTouch && !hasFine;
}

export interface InteractiveMapMarker {
  lat: number | string;
  lng: number | string;
  name?: string;
  title?: string;
  category?: string;
  score?: number | string;
  rating?: number | string;
  [key: string]: any;
}

export interface InteractiveMapProps {
  markers?: InteractiveMapMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  activeBooking?: {
    id?: string;
    status?: string;
    venue?: {
      latitude?: number | string | null;
      longitude?: number | string | null;
      name?: string | null;
    } | null;
  } | null;
}

export function InteractiveMap({
  markers = [],
  center: propCenter,
  zoom = 13,
  className = "",
  activeBooking: activeBookingProp,
}: InteractiveMapProps) {
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [timeWindowHour, setTimeWindowHour] = useState(12);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [isTouchOnly, setIsTouchOnly] = useState(false);
  const [activeBooking, setActiveBooking] = useState<
    InteractiveMapProps["activeBooking"]
  >(activeBookingProp ?? null);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    setActiveBooking(activeBookingProp ?? null);
  }, [activeBookingProp]);

  useEffect(() => {
    if (activeBookingProp) return;
    if (typeof window === "undefined" || typeof fetch !== "function") return;

    let cancelled = false;
    void fetch("/api/bookings/history?status=CHECKED_IN&limit=1&sort=desc")
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json();
        const booking = Array.isArray(data?.bookings) ? data.bookings[0] : null;
        return booking?.status === "CHECKED_IN" ? booking : null;
      })
      .then((booking) => {
        if (!cancelled) setActiveBooking(booking);
      })
      .catch(() => {
        if (!cancelled) setActiveBooking(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeBookingProp]);

  useEffect(() => {
    if (!activeBooking || typeof window === "undefined") return;
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser.");
      return;
    }

    setLocationError(null);
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        if (
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180
        ) {
          setUserLocation({ latitude, longitude });
          setLocationError(null);
        }
      },
      (error) => {
        if (error.code === 1) {
          setLocationError("Location permission denied.");
        } else if (error.code === 2) {
          setLocationError("Current location is unavailable.");
        } else {
          setLocationError("Location tracking timed out.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeBooking]);

  const venueCoordinates = useMemo(() => {
    if (activeBooking?.status && activeBooking.status !== "CHECKED_IN") return null;
    const rawLatitude = activeBooking?.venue?.latitude;
    const rawLongitude = activeBooking?.venue?.longitude;
    if (rawLatitude == null || rawLongitude == null) return null;

    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }
    return { latitude, longitude };
  }, [activeBooking]);

  const distanceMeters = useMemo(() => {
    if (!venueCoordinates || !userLocation) return null;
    return calculateDistanceMeters(userLocation, venueCoordinates);
  }, [userLocation, venueCoordinates]);

  const isOutside = useMemo(() => {
    if (!venueCoordinates || !userLocation) return false;
    return isOutsideGeofence(userLocation, venueCoordinates, GEOFENCE_RADIUS_METERS);
  }, [userLocation, venueCoordinates]);

  const userLocationIcon = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const outside = isOutside;
    const color = outside ? "#fb7185" : "#10b981";
    if (typeof (L as any).divIcon !== "function") return undefined;
    return (L as any).divIcon({
      className: "worksphere-user-location-marker",
      html: `<div class="worksphere-location-pulse worksphere-location-pulse--${outside ? "outside" : "inside"}" style="--location-color:${color}"><div></div></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }, [isOutside]);

  // Detect touch-only mobile device on mount to conditionally hide shortcut badges
  useEffect(() => {
    setIsTouchOnly(isTouchOnlyDevice());
  }, []);

  // Update zoom when prop changes
  useEffect(() => {
    setCurrentZoom(zoom);
  }, [zoom]);

  // Validate and sanitize numeric coordinates
  const safeMarkers = useMemo(() => {
    return (markers ?? []).filter(
      (m) =>
        m != null &&
        m.lat != null &&
        m.lng != null &&
        Number.isFinite(Number(m.lat)) &&
        Number.isFinite(Number(m.lng)),
    );
  }, [markers]);

  // Group and spiderfy overlapping markers
  const spiderfiedMarkers = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    safeMarkers.forEach((m) => {
      const numLat = Number(m.lat);
      const numLng = Number(m.lng);
      const key = `${numLat.toFixed(6)},${numLng.toFixed(6)}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push({ ...m, lat: numLat, lng: numLng });
    });

    const result: any[] = [];
    Object.keys(groups).forEach((key) => {
      const groupItems = groups[key];
      const n = groupItems.length;
      if (n === 1) {
        result.push({
          ...groupItems[0],
          renderedLat: groupItems[0].lat,
          renderedLng: groupItems[0].lng,
        });
      } else {
        const centerLat = groupItems[0].lat;
        const centerLng = groupItems[0].lng;
        // Base radius of ~200 meters to visually separate markers at default zoom
        const baseRadius = 0.002;
        // Expand slightly if many markers share the location
        const radius = baseRadius + 0.0002 * n;

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
  }, [safeMarkers]);

  // Determine map centroid defensively
  const computedCenter = useMemo(() => {
    if (
      propCenter &&
      propCenter.lat != null &&
      propCenter.lng != null &&
      Number.isFinite(Number(propCenter.lat)) &&
      Number.isFinite(Number(propCenter.lng))
    ) {
      return { lat: Number(propCenter.lat), lng: Number(propCenter.lng) };
    }
    if (safeMarkers.length > 0) {
      const sumLat = safeMarkers.reduce((sum, m) => sum + Number(m.lat), 0);
      const sumLng = safeMarkers.reduce((sum, m) => sum + Number(m.lng), 0);
      return {
        lat: sumLat / safeMarkers.length,
        lng: sumLng / safeMarkers.length,
      };
    }
    return { lat: 0, lng: 0 };
  }, [propCenter, safeMarkers]);

  const [currentCenter, setCurrentCenter] = useState(computedCenter);

  useEffect(() => {
    setCurrentCenter(computedCenter);
  }, [computedCenter]);

  // Quick Map Navigation Handlers
  const handleZoomIn = useCallback(() => {
    setCurrentZoom((prev) => {
      const next = Math.min(prev + 1, 19);
      try {
        mapRef.current?.setZoom?.(next);
        mapRef.current?.zoomIn?.();
      } catch {
        // no-op in headless/test
      }
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setCurrentZoom((prev) => {
      const next = Math.max(prev - 1, 1);
      try {
        mapRef.current?.setZoom?.(next);
        mapRef.current?.zoomOut?.();
      } catch {
        // no-op in headless/test
      }
      return next;
    });
  }, []);

  const handleResetView = useCallback(() => {
    setCurrentZoom(zoom);
    setCurrentCenter(computedCenter);
    try {
      mapRef.current?.setView?.([computedCenter.lat, computedCenter.lng], zoom);
    } catch {
      // no-op in headless/test
    }
  }, [computedCenter, zoom]);

  const handleToggleHighContrast = useCallback(() => {
    setIsHighContrast((prev) => !prev);
  }, []);

  // Bind global keydown listeners for quick map navigation actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when user is typing in form inputs, textareas, or contenteditables
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isInput =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable);

      if (isInput) return;

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        handleToggleHighContrast();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleResetView();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleToggleHighContrast, handleResetView]);

  // Memoized event handlers for interactive markers
  const markerEventHandlers = useMemo(
    () => ({
      keydown: (e: any) => {
        if (e.originalEvent?.key === "Enter" || e.originalEvent?.key === " ") {
          e.originalEvent?.preventDefault?.();
          e.target?.openPopup?.();
        }
      },
      add: (e: any) => {
        const el = e.target?.getElement?.();
        if (el) {
          const name = e.target?.options?.title || "Map marker";
          el.setAttribute("aria-label", name);
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
        }
      },
    }),
    [],
  );

  // Dynamic Tile Layer URL depending on High Contrast mode
  const cartoKey =
    typeof process !== "undefined"
      ? process.env?.NEXT_PUBLIC_CARTO_KEY
      : undefined;

  const tileLayerUrl = cartoKey
    ? isHighContrast
      ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`
      : `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`
    : isHighContrast
      ? "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  // Fallback empty view
  if (safeMarkers.length === 0 && !propCenter) {
    return (
      <div
        data-testid="interactive-map-empty"
        className="w-full p-6 text-center text-xs text-zinc-500 border border-zinc-200 dark:border-zinc-800 rounded-2xl"
      >
        No markers provided
      </div>
    );
  }

  return (
    <div
      data-testid="interactive-map"
      className={`w-full h-80 mt-4 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden relative z-0 ${className}`}
    >
      <style>{`
        .worksphere-location-pulse {
          --location-color: #10b981;
          width: 18px;
          height: 18px;
          border: 3px solid #fff;
          border-radius: 9999px;
          background: var(--location-color);
          box-shadow: 0 0 12px var(--location-color), 0 0 24px color-mix(in srgb, var(--location-color) 55%, transparent);
          position: relative;
        }
        .worksphere-location-pulse::after {
          content: "";
          position: absolute;
          inset: -8px;
          border-radius: 9999px;
          border: 2px solid var(--location-color);
          animation: worksphere-location-pulse 1.8s ease-out infinite;
        }
        @keyframes worksphere-location-pulse {
          0% { transform: scale(.45); opacity: .85; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .worksphere-location-pulse::after { animation: none; }
        }
      `}</style>

      {/* Map Overlay Controls - Non-overlapping Responsive Stack */}
      <div className="absolute top-2 left-2 z-[400] flex flex-col sm:flex-row items-start sm:items-center gap-2 max-w-[calc(100%-1rem)]">
        {/* Map Header Badge */}
        <div
          data-testid="map-header"
          className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 shrink-0"
        >
          <MapIcon className="w-3.5 h-3.5 text-blue-500" />
          Interactive Map
        </div>

        {/* High Contrast Toggle Button with Monospace Keyboard Badge */}
        <button
          type="button"
          onClick={handleToggleHighContrast}
          aria-label="Toggle high contrast map display mode"
          aria-pressed={isHighContrast}
          data-testid="map-high-contrast-btn"
          className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 text-zinc-800 dark:text-zinc-200 shadow-sm backdrop-blur-md hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-all flex items-center gap-1.5 cursor-pointer"
        >
          {isHighContrast ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              Standard Contrast
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              High Contrast
            </>
          )}

          {!isTouchOnly && (
            <kbd
              data-testid="kbd-high-contrast"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              H
            </kbd>
          )}
        </button>

        {/* Time Window Slider Container */}
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300 shadow-sm backdrop-blur-md max-w-full overflow-x-auto">
          <span className="shrink-0 font-medium text-zinc-500 dark:text-zinc-400">
            Time:
          </span>
          <input
            type="range"
            min={0}
            max={24}
            value={timeWindowHour}
            onChange={(e) => setTimeWindowHour(Number(e.target.value))}
            aria-label="Time window hour slider"
            className="h-1.5 w-20 sm:w-28 accent-emerald-500 bg-zinc-200 dark:bg-zinc-700 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          />
          <span className="shrink-0 font-mono text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] min-w-[45px]">
            {`${String(timeWindowHour).padStart(2, "0")}:00`}
          </span>
        </div>
      </div>

      {venueCoordinates && (
        <div
          data-testid="geofence-status"
          className={`absolute bottom-20 right-4 z-[400] max-w-[calc(100%-2rem)] rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur-md ${
            isOutside
              ? "border-rose-400/40 bg-rose-950/90 text-rose-100"
              : "border-emerald-400/40 bg-emerald-950/90 text-emerald-100"
          }`}
        >
          <div className="font-bold">
            {!userLocation
              ? "Locating checkout position"
              : isOutside
                ? "Outside checkout boundary"
                : "Inside checkout boundary"}
          </div>
          <div className="mt-0.5 font-mono text-[11px]">
            {distanceMeters == null
              ? "Locating..."
              : `${distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(2)} km` : `${Math.round(distanceMeters)} m`} away`}
            {" · "}
            {GEOFENCE_RADIUS_METERS >= 1000
              ? `${GEOFENCE_RADIUS_METERS / 1000} km`
              : `${GEOFENCE_RADIUS_METERS} m`}{" "}
            radius
          </div>
          {locationError && (
            <div className="mt-1 max-w-64 text-[10px] text-amber-200">
              {locationError}
            </div>
          )}
        </div>
      )}

      {/* Quick Map Action Navigation Controls with Keyboard Badges */}
      <div
        data-testid="map-navigation-controls"
        className="absolute bottom-8 right-4 z-[400] sm:bottom-4 flex items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-md"
      >
        {/* Zoom In Button */}
        <button
          type="button"
          onClick={handleZoomIn}
          data-testid="map-zoom-in-btn"
          aria-label="Zoom in"
          title="Zoom In (+)"
          className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-blue-500" />
          {!isTouchOnly && (
            <kbd
              data-testid="kbd-zoom-in"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              +
            </kbd>
          )}
        </button>

        {/* Zoom Out Button */}
        <button
          type="button"
          onClick={handleZoomOut}
          data-testid="map-zoom-out-btn"
          aria-label="Zoom out"
          title="Zoom Out (-)"
          className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5 text-blue-500" />
          {!isTouchOnly && (
            <kbd
              data-testid="kbd-zoom-out"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              -
            </kbd>
          )}
        </button>

        {/* Reset View Button */}
        <button
          type="button"
          onClick={handleResetView}
          data-testid="map-reset-view-btn"
          aria-label="Reset map view"
          title="Reset View (R)"
          className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
          {!isTouchOnly && (
            <kbd
              data-testid="kbd-reset-view"
              className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded font-mono text-zinc-400"
            >
              R
            </kbd>
          )}
        </button>
      </div>

      <MapContainer
        ref={mapRef}
        center={currentCenter}
        zoom={currentZoom}
        style={{ height: "100%", width: "100%", zIndex: 0 }}
      >
        <TileLayer
          url={tileLayerUrl}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {venueCoordinates && (
          <Circle
            center={[venueCoordinates.latitude, venueCoordinates.longitude]}
            radius={GEOFENCE_RADIUS_METERS}
            pathOptions={
              isOutside
                ? {
                    stroke: true,
                    color: "#fb7185",
                    weight: 2,
                    dashArray: "6, 8",
                    fillColor: "#fb7185",
                    fillOpacity: 0.14,
                  }
                : {
                    stroke: true,
                    color: "#10b981",
                    weight: 2,
                    dashArray: "6, 8",
                    fillColor: "#10b981",
                    fillOpacity: 0.12,
                  }
            }
          />
        )}
        {venueCoordinates && userLocation && (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={userLocationIcon}
            title={isOutside ? "Outside checkout boundary" : "Inside checkout boundary"}
            alt={isOutside ? "Outside checkout boundary" : "Inside checkout boundary"}
            keyboard={true}
          >
            <Popup>
              <div data-testid="user-location-popup" className="text-xs font-semibold">
                {isOutside ? "Outside checkout boundary" : "Inside checkout boundary"}
              </div>
              {distanceMeters != null && (
                <div className="text-xs">
                  {distanceMeters >= 1000
                    ? `${(distanceMeters / 1000).toFixed(2)} km`
                    : `${Math.round(distanceMeters)} m`} from venue
                </div>
              )}
            </Popup>
          </Marker>
        )}
        {spiderfiedMarkers.map((marker, idx) => {
          const venueName = marker.name || marker.title || "Location";
          const ratingVal = marker.score ?? marker.rating;
          const parts = [`Venue: ${venueName}`];
          if (marker.category) {
            parts.push(
              `Category: ${String(marker.category).replace("_", " ")}`,
            );
          }
          if (ratingVal != null && !isNaN(Number(ratingVal))) {
            parts.push(`Rating: ${ratingVal}`);
          }
          const markerAriaLabel = parts.join(", ");

          return (
            <Marker
              key={idx}
              position={[marker.renderedLat, marker.renderedLng]}
              title={markerAriaLabel}
              alt={venueName}
              keyboard={true}
              eventHandlers={{
                ...markerEventHandlers,
                add: (e: any) => {
                  const el = e.target?.getElement?.();
                  if (el) {
                    el.setAttribute("aria-label", markerAriaLabel);
                    el.setAttribute("role", "button");
                    el.setAttribute("tabindex", "0");
                    el.classList.add("interactive-map-pin");
                  }
                },
              }}
            >
              <Popup
                autoPanPadding={[20, 20]}
                autoPanPaddingTopLeft={[20, 90]}
                autoPanPaddingBottomRight={[20, 20]}
              >
                <div
                  data-testid="marker-popup-name"
                  className="font-bold text-sm"
                >
                  {venueName}
                </div>
                {marker.category && (
                  <div className="text-xs text-gray-500 capitalize">
                    {String(marker.category).replace("_", " ")}
                  </div>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default InteractiveMap;
