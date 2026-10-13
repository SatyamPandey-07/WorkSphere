"use client";

import React, { memo } from "react";
import L from "leaflet";
import type { MapMarker } from "@/types/map";
import { AccessibleMarker } from "@/components/ui/MapMarker";
import { getVenueShape, type HighContrastShape } from "@/lib/mapAccessibility";
import type { SeatAvailability, SeatStatus } from "@/hooks/useSeatAvailability";

export const SEAT_RING_COLORS: Record<SeatStatus, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

// Cached icon instances
let cachedVenueIcon: L.DivIcon | null = null;
let cachedDestinationIcon: L.DivIcon | null = null;
let cachedHighContrastCircleIcon: L.DivIcon | null = null;
let cachedHighContrastSquareIcon: L.DivIcon | null = null;
let cachedHighContrastDiamondIcon: L.DivIcon | null = null;

// Initialize global Leaflet icon default URLs safely on client-side
if (typeof window !== "undefined" && L?.Icon?.Default) {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "/leaflet/marker-icon-2x.png",
    iconUrl: "/leaflet/marker-icon.png",
    shadowUrl: "/leaflet/marker-shadow.png",
  });
}

/**
 * Creates or retrieves the standard venue marker icon.
 */
export function getVenueIcon(): L.DivIcon {
  if (typeof window === "undefined" || !L?.divIcon) {
    return {} as L.DivIcon;
  }
  if (!cachedVenueIcon) {
    cachedVenueIcon = L.divIcon({
      className: "venue-marker",
      html: `<div class="venue-dot"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12],
    });
  }
  return cachedVenueIcon;
}

/**
 * Creates or retrieves the destination marker icon.
 */
export function getDestinationIcon(): L.DivIcon {
  if (typeof window === "undefined" || !L?.divIcon) {
    return {} as L.DivIcon;
  }
  if (!cachedDestinationIcon) {
    cachedDestinationIcon = L.divIcon({
      className: "destination-marker",
      html: `<div class="destination-pin"><span>D</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  }
  return cachedDestinationIcon;
}

/**
 * Factory for high-contrast shape icons (circle, square, diamond).
 */
export function createHighContrastIcon(shape: HighContrastShape): L.DivIcon {
  if (typeof window === "undefined" || !L?.divIcon) {
    return {} as L.DivIcon;
  }

  if (shape === "square") {
    return L.divIcon({
      className: "venue-marker high-contrast-marker hc-marker-square interactive-map-pin",
      html: `<div class="hc-marker-wrapper hc-shape-square" data-shape="square" role="img" aria-label="Coworking marker (square)"><div class="hc-marker-inner hc-square-inner"><svg class="hc-glyph" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1" /></svg></div></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  }

  if (shape === "diamond") {
    return L.divIcon({
      className: "venue-marker high-contrast-marker hc-marker-diamond interactive-map-pin",
      html: `<div class="hc-marker-wrapper hc-shape-diamond" data-shape="diamond" role="img" aria-label="Library marker (diamond)"><div class="hc-marker-inner hc-diamond-inner"><svg class="hc-glyph" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="12,3 21,12 12,21 3,12" /></svg></div></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  }

  return L.divIcon({
    className: "venue-marker high-contrast-marker hc-marker-circle interactive-map-pin",
    html: `<div class="hc-marker-wrapper hc-shape-circle" data-shape="circle" role="img" aria-label="Cafe marker (circle)"><div class="hc-marker-inner hc-circle-inner"><svg class="hc-glyph" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg></div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

/**
 * Returns cached or newly instantiated high-contrast typed L.DivIcon for the given shape.
 */
export function getHighContrastIcon(shape: HighContrastShape): L.DivIcon {
  if (typeof window === "undefined" || !L?.divIcon) {
    return getVenueIcon();
  }

  if (shape === "square") {
    if (!cachedHighContrastSquareIcon) {
      cachedHighContrastSquareIcon = createHighContrastIcon("square");
    }
    return cachedHighContrastSquareIcon;
  }

  if (shape === "diamond") {
    if (!cachedHighContrastDiamondIcon) {
      cachedHighContrastDiamondIcon = createHighContrastIcon("diamond");
    }
    return cachedHighContrastDiamondIcon;
  }

  if (!cachedHighContrastCircleIcon) {
    cachedHighContrastCircleIcon = createHighContrastIcon("circle");
  }
  return cachedHighContrastCircleIcon;
}

export interface UserLocationIconOptions {
  /** Enable 360° rotating radar sweep line around the user position (#6183) */
  enableRadarSweep?: boolean;
  /** Radar search radius diameter in pixels. Default: 160 */
  radarRadius?: number;
  /** Duration of 1 full 360° revolution in seconds. Default: 4 */
  durationSeconds?: number;
  /** Force reduced motion mode (switches from rotating sweep to static radius ring) */
  reducedMotion?: boolean;
}

/**
 * Returns user location marker icon with optional rotating radar sweep effect (#6183).
 */
export function getUserLocationIcon(
  iconUrl?: string | null,
  options?: UserLocationIconOptions,
): L.DivIcon {
  if (typeof window === "undefined" || !L?.divIcon) {
    return getVenueIcon();
  }

  const baseDotHtml =
    iconUrl && iconUrl !== "default"
      ? `<div class="image-marker" style="background-image: url(${iconUrl})" width="40" height="40"></div>`
      : `<div class="default-dot-marker" width="20" height="20"></div>`;

  if (options?.enableRadarSweep === false) {
    return L.divIcon({
      className: "custom-user-marker",
      html: baseDotHtml,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  const radius = options?.radarRadius ?? 160;
  const duration = options?.durationSeconds ?? 4;
  const isReduced = Boolean(options?.reducedMotion);

  const sweepOrStatic = isReduced
    ? `<div class="radar-static-ring" style="position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(0, 255, 136, 0.8); box-shadow: 0 0 12px rgba(0, 255, 136, 0.35);"></div>`
    : `<div class="radar-sweep-beam animate-radar-sweep" style="animation-duration: ${duration}s;"></div>`;

  const pingAura = !isReduced
    ? `<div class="radar-ping-aura"></div>`
    : "";

  const html = `
    <div class="radar-sweep-marker-wrapper" style="width: ${radius}px; height: ${radius}px;" data-reduced-motion="${isReduced}">
      <div class="radar-range-rings" aria-hidden="true">
        <div class="radar-ring radar-ring-outer"></div>
        <div class="radar-ring radar-ring-mid"></div>
        <div class="radar-ring radar-ring-inner"></div>
        <div class="radar-crosshair radar-crosshair-h"></div>
        <div class="radar-crosshair radar-crosshair-v"></div>
      </div>
      ${sweepOrStatic}
      <div class="radar-center-beacon">
        ${baseDotHtml}
        ${pingAura}
      </div>
    </div>
  `;

  return L.divIcon({
    className: "custom-user-marker",
    html,
    iconSize: [radius, radius],
    iconAnchor: [radius / 2, radius / 2],
  });
}

/**
 * Convenience helper to determine marker icon according to options.
 */
export function getMarkerIcon(options: {
  isDestination?: boolean;
  isHighContrast?: boolean;
  category?: string;
  shape?: HighContrastShape;
}): L.DivIcon {
  if (options.isDestination) {
    return getDestinationIcon();
  }
  if (options.isHighContrast) {
    const shape =
      options.shape || (options.category ? getVenueShape(options.category) : "circle");
    return getHighContrastIcon(shape);
  }
  return getVenueIcon();
}

export type SpiderfiedMarker = MapMarker & {
  renderedLat?: number;
  renderedLng?: number;
};

export interface MapMarkerFactoryProps {
  markers: SpiderfiedMarker[];
  selectedMarkerId?: string | null;
  onSelectMarker?: (id: string) => void;
  isHighContrast?: boolean;
  getAvailability?: (venueId: string) => SeatAvailability | null;
  checkIn?: (venueId: string) => void;
  checkOut?: () => void;
  checkedInVenueId?: string | null;
  isSeatSocketConnected?: boolean;
  routingQueue?: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }>;
  onAddToRoutingQueue?: (venue: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }) => void;
}

/**
 * React Component that renders Leaflet map markers with accessibility,
 * real-time seat availability indicators, and itinerary timeline hooks.
 */
export const MapMarkerFactory = memo(function MapMarkerFactory({
  markers,
  selectedMarkerId,
  onSelectMarker,
  isHighContrast = false,
  getAvailability,
  checkIn,
  checkOut,
  checkedInVenueId,
  isSeatSocketConnected = false,
  routingQueue = [],
  onAddToRoutingQueue,
}: MapMarkerFactoryProps) {
  return (
    <>
      {markers.map((marker) => {
        const isDest = marker.id.includes("dest");
        const seat = !isDest && getAvailability ? getAvailability(marker.id) : null;
        const isCheckedInHere = !isDest && checkedInVenueId === marker.id;
        const telemetry = !isDest && seat
          ? {
              seatCount: seat.count,
              seatCapacity: seat.capacity,
              isCheckedIn: isCheckedInHere,
              isConnected: isSeatSocketConnected,
            }
          : undefined;

        const positionLat = marker.renderedLat ?? marker.position.lat;
        const positionLng = marker.renderedLng ?? marker.position.lng;

        const markerIcon = isDest
          ? getDestinationIcon()
          : isHighContrast
            ? getHighContrastIcon(getVenueShape(marker.category))
            : getVenueIcon();

        return (
          <AccessibleMarker
            key={marker.id}
            position={[positionLat, positionLng]}
            icon={markerIcon}
            name={marker.name}
            category={marker.category}
            rating={marker.score}
            score={marker.score}
            isDestination={isDest}
            isHighContrast={isHighContrast}
            telemetryData={telemetry}
            zIndexOffset={selectedMarkerId === marker.id ? 1000 : 0}
            onClick={() => onSelectMarker?.(marker.id)}
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
              {!isDest &&
                seat &&
                (() => {
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
                      {checkIn && checkOut && (
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
                      )}
                    </div>
                  );
                })()}
            </div>
            {onAddToRoutingQueue && (
              <button
                onClick={() => {
                  if (!routingQueue.some((v) => v.id === marker.id)) {
                    onAddToRoutingQueue({
                      id: marker.id,
                      name: marker.name,
                      latitude: Number(marker.position.lat),
                      longitude: Number(marker.position.lng),
                    });
                  }
                }}
                className="mt-2 w-full rounded bg-zinc-800 py-1 text-[10px] font-medium text-zinc-200 hover:accent-bg hover:text-white transition-colors"
              >
                ➕ Add to Workday Timeline
              </button>
            )}
          </AccessibleMarker>
        );
      })}
    </>
  );
});

export { RadarSweepLayer } from "./RadarSweepLayer";
export type { RadarSweepLayerProps, RadarVenueTarget } from "./RadarSweepLayer";

export default MapMarkerFactory;
