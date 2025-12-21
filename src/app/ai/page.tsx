"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { EnhancedChatbot } from "@/components/EnhancedChatbot";
import { VenueRatingDialog } from "@/components/VenueRatingDialog";
import { MapMarker, MapRoute, MapView } from "@/types/map";
import { Loader2, Map as MapIcon, MessageCircle } from "lucide-react";
import { OfflineIndicator } from "@/hooks/usePWA";

// Dynamically import Map to avoid SSR issues with Leaflet
const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  ),
});

export default function AppPage() {
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [routes, setRoutes] = useState<MapRoute[]>([]);
  const [mapView, setMapView] = useState<MapView | null>(null);
  const [ratingDialog, setRatingDialog] = useState<{
    isOpen: boolean;
    venue: MapMarker | null;
  }>({ isOpen: false, venue: null });
  
  // Mobile view state - show map or chat
  const [mobileView, setMobileView] = useState<"map" | "chat">("chat");

  // Get user location on mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting location:", error);
          // Default to San Francisco
          setLocation({ latitude: 37.7749, longitude: -122.4194 });
        }
      );
    } else {
      // Fallback location
      setLocation({ latitude: 37.7749, longitude: -122.4194 });
    }
  }, []);

  // Map update interface
  interface MapUpdateData {
    type: string;
    markers?: Array<{
      id: string;
      lat: number;
      lng: number;
      name: string;
      category: string;
      address?: string;
      wifi?: boolean;
    }>;
    route?: {
      from: { lat: number; lng: number };
      to: { lat: number; lng: number };
    };
    data?: {
      markers?: MapMarker[];
      routes?: MapRoute[];
      center?: { lat: number; lng: number };
      zoom?: number;
      animate?: boolean;
    };
  }

  // Handle map updates from chat
  const handleMapUpdate = (update: MapUpdateData) => {
    console.log("Map update:", update);

    switch (update.type) {
      case "markers":
        if (update.markers) {
          const newMarkers: MapMarker[] = update.markers.map((m: { id: string; name: string; lat: number; lng: number; category: string; address?: string; wifi?: boolean }) => ({
            id: m.id,
            name: m.name,
            position: { lat: m.lat, lng: m.lng },
            category: m.category,
            address: m.address,
            amenities: {
              wifi: m.wifi || false,
              outlets: false,
              quiet: false,
            },
          }));
          setMarkers(newMarkers);
          
          // Auto-center map on new markers
          if (newMarkers.length > 0 && location) {
            setMapView({
              center: { lat: location.latitude, lng: location.longitude },
              zoom: 14,
              animate: true,
            });
          }
        }
        break;

      case "UPDATE_MARKERS":
        if (update.data?.markers) {
          setMarkers(update.data.markers);
        }
        break;

      case "UPDATE_ROUTES":
        if (update.data?.routes) {
          setRoutes(update.data.routes);
        }
        break;

      case "SET_MAP_VIEW":
        if (update.data?.center && update.data?.zoom) {
          setMapView({
            center: update.data.center,
            zoom: update.data.zoom,
            animate: update.data.animate !== false,
          });
        }
        break;

      case "route":
        // Handle directions request from chatbot
        if (update.route && location) {
          // Create a simple straight-line route (no routing API)
          const newRoute: MapRoute = {
            id: `route-${Date.now()}`,
            path: [
              { lat: update.route.from.lat, lng: update.route.from.lng },
              { lat: update.route.to.lat, lng: update.route.to.lng },
            ],
            isHighlighted: true,
          };
          setRoutes([newRoute]);
          // Center map between user and destination
          setMapView({
            center: {
              lat: (update.route.from.lat + update.route.to.lat) / 2,
              lng: (update.route.from.lng + update.route.to.lng) / 2,
            },
            zoom: 14,
            animate: true,
          });
        }
        break;
    }
  };

  // Handle venue rating submission
  const handleRatingSubmit = async (rating: { wifiQuality: number; hasOutlets: boolean; noiseLevel: "quiet" | "moderate" | "loud"; comment?: string }) => {
    if (!ratingDialog.venue) return;

    try {
      const response = await fetch(`/api/venues/${ratingDialog.venue.id}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rating),
      });

      if (!response.ok) {
        throw new Error("Failed to submit rating");
      }

      console.log("Rating submitted successfully");
    } catch (error) {
      console.error("Error submitting rating:", error);
      alert("Failed to submit rating. Please try again.");
    }
  };

  if (!location) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-50 dark:bg-black">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-zinc-600 dark:text-zinc-400">Getting your location...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-zinc-50 dark:bg-black overflow-hidden">
      {/* Mobile Navigation Toggle */}
      <div className="md:hidden flex border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setMobileView("chat")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            mobileView === "chat"
              ? "text-blue-600 bg-blue-50 dark:bg-blue-950 border-b-2 border-blue-600"
              : "text-zinc-600 dark:text-zinc-400"
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          Chat
        </button>
        <button
          onClick={() => setMobileView("map")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            mobileView === "map"
              ? "text-blue-600 bg-blue-50 dark:bg-blue-950 border-b-2 border-blue-600"
              : "text-zinc-600 dark:text-zinc-400"
          }`}
        >
          <MapIcon className="w-4 h-4" />
          Map
          {markers.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">
              {markers.length}
            </span>
          )}
        </button>
      </div>

      {/* Map Section - Hidden on mobile when chat is active */}
      <div className={`
        ${mobileView === "map" ? "flex" : "hidden"} 
        md:flex flex-1 md:flex-[7] relative
      `}>
        <Map
          location={location}
          markers={markers}
          routes={routes}
          mapView={mapView}
        />
      </div>

      {/* Divider - Desktop only */}
      <div className="hidden md:block w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Chat Section - Hidden on mobile when map is active */}
      <div className={`
        ${mobileView === "chat" ? "flex" : "hidden"} 
        md:flex flex-1 md:flex-[3] flex-col min-h-0
      `}>
        <EnhancedChatbot
          onMapUpdate={(update) => {
            handleMapUpdate(update as MapUpdateData);
            // Auto-switch to map on mobile when markers are added
            if (update.type === "markers" && update.markers && update.markers.length > 0) {
              // Small delay so user sees the results loading
              setTimeout(() => setMobileView("map"), 500);
            }
          }}
          userLocation={
            location ? { lat: location.latitude, lng: location.longitude } : undefined
          }
        />
      </div>

      {/* Rating Dialog */}
      <VenueRatingDialog
        venueName={ratingDialog.venue?.name || ""}
        venueId={ratingDialog.venue?.id || ""}
        isOpen={ratingDialog.isOpen}
        onClose={() => setRatingDialog({ isOpen: false, venue: null })}
        onSubmit={handleRatingSubmit}
      />

      {/* Offline Indicator */}
      <OfflineIndicator />
    </div>
  );
}
