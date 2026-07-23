"use client";

import { Marker, Popup } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import { useCallback, useRef } from "react";

interface AccessibleMarkerProps {
  position: [number, number];
  icon: L.DivIcon | L.Icon;
  name: string;
  category?: string;
  isDestination?: boolean;
  children?: React.ReactNode;
}

export function AccessibleMarker({
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
}
