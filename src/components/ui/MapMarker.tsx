"use client";

import { Marker, Popup } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import { useCallback, useEffect, useRef, memo } from "react";

interface AccessibleMarkerProps {
  position: [number, number];
  icon: L.DivIcon | L.Icon;
  name: string;
  category?: string;
  isDestination?: boolean;
  children?: React.ReactNode;
  telemetryData?: {
    seatCount?: number;
    seatCapacity?: number;
    isCheckedIn?: boolean;
    isConnected?: boolean;
  };
}

export const AccessibleMarker = memo(
  function AccessibleMarker({
    position,
    icon,
    name,
    category,
    isDestination,
    children,
  }: AccessibleMarkerProps) {
    const markerRef = useRef<LeafletMarker | null>(null);

    const handleKeyDown = useCallback((e: L.LeafletKeyboardEvent) => {
      if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") {
        e.originalEvent.preventDefault();
        e.target.openPopup();
      }
      if (e.originalEvent.key === "Escape") {
        e.target.closePopup();
      }
    }, []);

    const handleAdd = useCallback(
      (e: any) => {
        const el = e.target.getElement();
        if (!el) return;
        const label = isDestination
          ? `Destination: ${name}`
          : `Venue: ${name}${category ? `, ${category}` : ""}`;
        el.setAttribute("aria-label", label);
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
      },
      [name, category, isDestination],
    );

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
        eventHandlers={{
          keydown: handleKeyDown,
          add: handleAdd,
          popupopen: handlePopupOpen,
          popupclose: handlePopupClose,
        }}
      >
        <Popup
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
      prevProps.isDestination !== nextProps.isDestination
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
