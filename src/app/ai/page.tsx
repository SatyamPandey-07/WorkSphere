"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { EnhancedChatbot } from "@/components/EnhancedChatbot";
import { VenueRatingDialog } from "@/components/VenueRatingDialog";
import { ChatErrorBoundary, MapErrorBoundary } from "@/components/ErrorBoundary";
import { VenueListSkeleton } from "@/components/ui/skeleton";
import { MapMarker, MapRoute, MapView } from "@/types/map";
import { Loader2, Map as MapIcon, MessageCircle, WifiOff } from "lucide-react";
import { OfflineIndicator } from "@/hooks/usePWA";
import { useRealTimeUpdates } from "@/hooks/useRealTime";
import { saveVenueOffline, getAllVenuesOffline, OfflineVenue } from "@/lib/offlineStorage";

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
  const [isOnline, setIsOnline] = useState(true);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  
  // Mobile view state - show map or chat
  const [mobileView, setMobileView] = useState<"map" | "chat">("chat");

  // Real-time updates for venue changes
  const venueIds = markers.map(m => m.id);
  const { updates: realTimeUpdates, isConnected } = useRealTimeUpdates({
    venueIds,
    enabled: venueIds.length > 0 && isOnline,
  });

  // Handle real-time updates
  useEffect(() => {
    if (realTimeUpdates.length > 0) {
      const latestUpdate = realTimeUpdates[realTimeUpdates.length - 1];
      console.log("[RealTime] Venue update received:", latestUpdate);
      // Could refresh venue data or show notification here
    }
  }, [realTimeUpdates]);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Save venues to offline storage when markers update
  useEffect(() => {
    if (markers.length > 0 && isOnline) {
      markers.forEach(async (marker) => {
        try {
          await saveVenueOffline({
            id: marker.id,
            name: marker.name,
            latitude: marker.position.lat,
            longitude: marker.position.lng,
            category: marker.category,
            address: marker.address,
          });
        } catch (err) {
          console.error("[Offline] Failed to save venue:", err);
        }
      });
    }
  }, [markers, isOnline]);

  // Load offline venues when offline
  const loadOfflineVenues = useCallback(async () => {
    if (!isOnline) {
      try {
        const offlineVenues = await getAllVenuesOffline();
        if (offlineVenues.length > 0) {
          const offlineMarkers: MapMarker[] = offlineVenues.map((v: OfflineVenue) => ({
            id: v.id,
            name: v.name,
            position: { lat: v.latitude, lng: v.longitude },
            category: v.category || v.type || "cafe",
            address: v.address || v.location,
            amenities: { wifi: false, outlets: false, quiet: false },
          }));
          setMarkers(offlineMarkers);
        }
      } catch (err) {
        console.error("[Offline] Failed to load venues:", err);
      }
    }
  }, [isOnline]);

  useEffect(() => {
    loadOfflineVenues();
  }, [loadOfflineVenues]);

  // Get user location on mount with API fallback
  useEffect(() => {
    const getLocation = async () => {
      setIsLoadingLocation(true);
      
      // Try browser geolocation first
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
            setIsLoadingLocation(false);
          },
          async (error) => {
            console.error("Geolocation error:", error);
            // Fallback to IP-based location API
            try {
              const response = await fetch("/api/location");
              if (response.ok) {
                const data = await response.json();
                setLocation({ latitude: data.lat, longitude: data.lng });
                console.log(`[Location] Using ${data.source}: ${data.city}, ${data.region}`);
              } else {
                throw new Error("Location API failed");
              }
            } catch (apiError) {
              console.error("Location API error:", apiError);
              // Ultimate fallback to San Francisco
              setLocation({ latitude: 37.7749, longitude: -122.4194 });
            }
            setIsLoadingLocation(false);
          },
          { timeout: 5000, enableHighAccuracy: false }
        );
      } else {
        // No geolocation support - use API fallback
        try {
          const response = await fetch("/api/location");
          if (response.ok) {
            const data = await response.json();
            setLocation({ latitude: data.lat, longitude: data.lng });
          } else {
            setLocation({ latitude: 37.7749, longitude: -122.4194 });
          }
        } catch {
          setLocation({ latitude: 37.7749, longitude: -122.4194 });
        }
        setIsLoadingLocation(false);
      }
    };

    getLocation();
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

  if (!location || isLoadingLocation) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-50 dark:bg-black">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-zinc-600 dark:text-zinc-400">Getting your location...</p>
          {!isOnline && (
            <p className="text-amber-500 text-sm mt-2 flex items-center justify-center gap-1">
              <WifiOff className="w-4 h-4" />
              You're offline - loading saved venues
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-zinc-50 dark:bg-black overflow-hidden">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-white text-center py-1 text-sm flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4" />
          You're offline - showing saved venues
        </div>
      )}

      {/* Real-time connection status (debug) */}
      {isConnected && venueIds.length > 0 && (
        <div className="hidden" data-realtime="connected" />
      )}

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
        <MapErrorBoundary>
          <Map
            location={location}
            markers={markers}
            routes={routes}
            mapView={mapView}
          />
        </MapErrorBoundary>
      </div>

      {/* Divider - Desktop only */}
      <div className="hidden md:block w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Chat Section - Hidden on mobile when map is active */}
      <div className={`
        ${mobileView === "chat" ? "flex" : "hidden"} 
        md:flex flex-1 md:flex-[3] flex-col min-h-0
      `}>
        <ChatErrorBoundary>
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
        </ChatErrorBoundary>
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
