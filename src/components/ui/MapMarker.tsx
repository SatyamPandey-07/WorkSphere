"use client";

import { Marker, Popup } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import { useCallback, useEffect, useRef, memo } from "react";
import { getVenueShape } from "@/lib/mapAccessibility";

export interface AccessibleMarkerProps {
  position: [number, number];
  icon: L.DivIcon | L.Icon;
  name: string;
  category?: string;
  rating?: number;
  score?: number;
  isDestination?: boolean;
  isHighContrast?: boolean;
  children?: React.ReactNode;
  telemetryData?: {
    seatCount?: number;
    seatCapacity?: number;
    isCheckedIn?: boolean;
    isConnected?: boolean;
  };
  zIndexOffset?: number;
  onClick?: () => void;
}

export const AccessibleMarker = memo(
  function AccessibleMarker({
    position,
    icon,
    name,
    category,
    rating,
    score,
    isDestination,
    isHighContrast = false,
    children,
    telemetryData: _telemetryData,
    zIndexOffset = 0,
    onClick,
  }: AccessibleMarkerProps) {
    console.count(`Rendered marker: ${name}`);
    const markerRef = useRef<LeafletMarker | null>(null);

    // Formats a WCAG 2.1 AA descriptive accessibility label
    const buildAriaLabel = useCallback(() => {
      if (isDestination) {
        return `Destination: ${name}`;
      }
      let label = `Venue: ${name}`;
      if (category) {
        label += `, ${category}`;
      }
      const ratingValue = rating ?? score;
      if (ratingValue != null && !isNaN(Number(ratingValue))) {
        label += `, Rating: ${ratingValue}`;
      }
      return label;
    }, [name, category, rating, score, isDestination]);

    const handleKeyDown = useCallback(
      (e: L.LeafletKeyboardEvent) => {
        const key = e.originalEvent?.key;
        if (key === "Enter" || key === " " || key === "Spacebar") {
          e.originalEvent?.preventDefault();
          if (onClick) onClick();
          e.target.openPopup();
        }
        if (key === "Escape") {
          e.originalEvent?.preventDefault();
          e.target.closePopup();
        }
      },
      [onClick],
    );

    const applyAccessibilityAttributes = useCallback(
      (el: HTMLElement) => {
        const label = buildAriaLabel();
        el.setAttribute("aria-label", label);
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.classList.add("interactive-map-pin");
        if (isHighContrast) {
          el.setAttribute("data-high-contrast", "true");
          const shape = getVenueShape(category);
          el.setAttribute("data-shape", shape);
          el.classList.add("high-contrast-pin", `hc-shape-${shape}`);
        } else {
          el.removeAttribute("data-high-contrast");
          el.removeAttribute("data-shape");
          el.classList.remove(
            "high-contrast-pin",
            "hc-shape-circle",
            "hc-shape-square",
            "hc-shape-diamond",
          );
        }
      },
      [buildAriaLabel, isHighContrast, category],
    );

    const handleAdd = useCallback(
      (e: any) => {
        const el = e.target.getElement();
        if (!el) return;
        applyAccessibilityAttributes(el);
      },
      [applyAccessibilityAttributes],
    );

    // Keep DOM attributes synchronized if props change after mounting
    useEffect(() => {
      const el = markerRef.current?.getElement();
      if (el) {
        applyAccessibilityAttributes(el);
      }
    }, [applyAccessibilityAttributes]);

    const handlePopupOpen = useCallback(
      (e: any) => {
        const popupEl = e.target.getPopup()?.getElement();
        if (popupEl) {
          popupEl.setAttribute("role", "dialog");
          popupEl.setAttribute("aria-modal", "true");
          popupEl.setAttribute("aria-label", name);
        }
      },
      [name],
    );

    const handlePopupClose = useCallback(() => {
      markerRef.current?.getElement()?.focus();
    }, []);

    // Direct Leaflet element updates to prevent map pin flicker
    useEffect(() => {
      const marker = markerRef.current;
      if (!marker) return;
      const currentPos = marker.getLatLng();
      if (currentPos.lat !== position[0] || currentPos.lng !== position[1]) {
        marker.setLatLng(position);
      }
    }, [position]);

    useEffect(() => {
      const marker = markerRef.current;
      if (marker && icon) {
        marker.setIcon(icon);
      }
    }, [icon]);

    return (
      <Marker
        ref={markerRef}
        position={position}
        icon={icon}
        keyboard={true}
        zIndexOffset={zIndexOffset}
        eventHandlers={{
          click: onClick,
          keydown: handleKeyDown,
          add: handleAdd,
          popupopen: handlePopupOpen,
          popupclose: handlePopupClose,
        }}
      >
        <Popup
          autoPanPadding={[20, 20]}
          autoPanPaddingTopLeft={[20, 90]}
          autoPanPaddingBottomRight={[20, 20]}
        >
          {children}
        </Popup>
      </Marker>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison logic to avoid unneeded re-renders
    if (
      prevProps.position[0] !== nextProps.position[0] ||
      prevProps.position[1] !== nextProps.position[1]
    ) {
      return false;
    }

    if (
      prevProps.icon !== nextProps.icon ||
      prevProps.name !== nextProps.name ||
      prevProps.category !== nextProps.category ||
      prevProps.rating !== nextProps.rating ||
      prevProps.score !== nextProps.score ||
      prevProps.isDestination !== nextProps.isDestination ||
      prevProps.isHighContrast !== nextProps.isHighContrast
    ) {
      return false;
    }

    const prevTelemetry = prevProps.telemetryData;
    const nextTelemetry = nextProps.telemetryData;
    if (prevTelemetry !== nextTelemetry) {
      if (!prevTelemetry || !nextTelemetry) return false;
      if (
        prevTelemetry.seatCount !== nextTelemetry.seatCount ||
        prevTelemetry.seatCapacity !== nextTelemetry.seatCapacity ||
        prevTelemetry.isCheckedIn !== nextTelemetry.isCheckedIn ||
        prevTelemetry.isConnected !== nextTelemetry.isConnected
      ) {
        return false;
      }
    }

    return true;
  },
);
