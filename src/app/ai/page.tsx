"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
const VenueRatingDialog = dynamic(
  () =>
    import("@/components/VenueRatingDialog").then(
      (mod) => mod.VenueRatingDialog,
    ),
  { ssr: false },
);
import {
  ChatErrorBoundary,
  MapErrorBoundary,
} from "@/components/ErrorBoundary";
import { MapMarker, MapRoute, MapView } from "@/types/map";
import {
  Loader2,
  Map as MapIcon,
  MessageCircle,
  WifiOff,
  X,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { OfflineIndicator, PWABanner, OfflineSyncNotice } from "@/hooks/usePWA";
import { useRealTimeUpdates } from "@/hooks/useRealTime";
import {
  saveVenueOffline,
  getAllVenuesOffline,
  withLeaderLock,
  OfflineVenue,
} from "@/lib/offlineStorage";
import { VenueDetailDialog } from "@/components/chat/VenueDetailDialog";
import { Venue } from "@/components/chat/ChatMessages";
import { PartyKitPresenceWrapper } from "@/components/chat/PartyKitPresenceWrapper";

// Dynamically import EnhancedChatbot to isolate WASM loading / client effects during streaming SSR and prevent hydration mismatches
const EnhancedChatbot = dynamic(
  () =>
    import("@/components/EnhancedChatbot").then((mod) => mod.EnhancedChatbot),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex flex-1 h-full w-full items-center justify-center bg-white dark:bg-zinc-900"
        role="status"
        aria-live="polite"
        aria-label="Loading chat assistant"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-blue-600"
          aria-hidden="true"
        />
        <span className="sr-only">Loading chat assistant...</span>
      </div>
    ),
  },
);
// Dynamically import OnboardingTour to prevent hydration issues with react-joyride
const OnboardingTour = dynamic(
  () => import("@/components/OnboardingTour").then((mod) => mod.OnboardingTour),
  { ssr: false },
);

// Dynamically import Map to avoid SSR issues with Leaflet
const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900"
      role="status"
      aria-live="polite"
      aria-label="Loading interactive map"
    >
      <Loader2
        className="h-8 w-8 animate-spin accent-text"
        aria-hidden="true"
      />
      <span className="sr-only">Loading interactive map...</span>
    </div>
  ),
});

function AppPage() {
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [routes, setRoutes] = useState<MapRoute[]>([]);
  const [mapView, setMapView] = useState<MapView | null>(null);
  const [ratingDialog, setRatingDialog] = useState<{
    isOpen: boolean;
    venue: MapMarker | null;
  }>({ isOpen: false, venue: null });
  const [selectedVenue, setSelectedVenue] = useState<MapMarker | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const [toast, setToast] = useState<{
    message: string;
    type: "error" | "warning" | "success";
  } | null>(null);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const searchParams = useSearchParams();
  const sessionId = searchParams?.get("session") || null;

  // Sidebar toggle state
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Mobile view state - show map or chat
  const [mobileView, setMobileView] = useState<"map" | "chat">("chat");
  const [routeProfile, setRouteProfile] = useState<
    "walking" | "cycling" | "driving"
  >("walking");

  // Stable venueIds reference — must be memoised or a new array every render
  // causes the SSE connection to be torn down and recreated on every render.
  const venueIds = useMemo(() => markers.map((m) => m.id), [markers]);
  const { updates: realTimeUpdates, isConnected } = useRealTimeUpdates({
    venueIds,
    enabled: venueIds.length > 0 && isOnline,
  });

  // Handle real-time updates (skip heartbeat / connected messages)
  useEffect(() => {
    if (realTimeUpdates.length > 0) {
      const latestUpdate = realTimeUpdates[realTimeUpdates.length - 1];
      if (
        latestUpdate.type === "rating" ||
        latestUpdate.type === "availability" ||
        latestUpdate.type === "new_review"
      ) {
        console.log("[RealTime] Venue update received:", latestUpdate);
      }
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

  // Save venues to offline storage when markers update.
  // Uses leader-election (#1072) so only ONE tab across all open windows
  // persists venues — the IndexedDB data is shared per-origin.
  useEffect(() => {
    if (markers.length > 0 && isOnline) {
      withLeaderLock("worksphere-venue-cache-leader", async () => {
        await Promise.all(
          markers.map(async (marker) => {
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
          }),
        );
      });
    }
  }, [markers, isOnline]);

  // Load offline venues when offline
  const loadOfflineVenues = useCallback(async () => {
    if (!isOnline) {
      try {
        const offlineVenues = await getAllVenuesOffline();
        if (offlineVenues.length > 0) {
          const offlineMarkers: MapMarker[] = offlineVenues.map(
            (v: OfflineVenue) => ({
              id: v.id,
              name: v.name,
              position: { lat: v.latitude, lng: v.longitude },
              category: v.category || v.type || "cafe",
              address: v.address || v.location,
              amenities: { wifi: false, outlets: false, quiet: false },
            }),
          );
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
        try {
          const fallbackToIp = async () => {
            try {
              const response = await fetch("/api/location");
              if (response.ok) {
                const data = await response.json();
                setLocation({ latitude: data.lat, longitude: data.lng });
                console.log(
                  `[Location] Using ${data.source}: ${data.city}, ${data.region}`,
                );
              } else {
                throw new Error("Location API failed");
              }
            } catch (apiError) {
              console.error("Location API error:", apiError);
              // Ultimate fallback to San Francisco
              setLocation({ latitude: 37.7749, longitude: -122.4194 });
            }
            setIsLoadingLocation(false);
          };

          navigator.geolocation.getCurrentPosition(
            async (position) => {
              if (
                position.coords.accuracy !== undefined &&
                position.coords.accuracy > 50
              ) {
                console.warn(
                  `GPS accuracy too low on mount (${position.coords.accuracy}m). Falling back to IP location.`,
                );
                await fallbackToIp();
                return;
              }
              setLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              });
              setIsLoadingLocation(false);
            },
            async (error) => {
              console.warn("Geolocation error:", error);
              await fallbackToIp();
            },
            { timeout: 5000, enableHighAccuracy: false },
          );
        } catch (err) {
          console.warn("Geolocation synchronous error on mount:", err);
          // Fallback to IP-based location API
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
          const newMarkers: MapMarker[] = update.markers.map(
            (m: {
              id: string;
              name: string;
              lat: number;
              lng: number;
              category: string;
              address?: string;
              wifi?: boolean;
            }) => ({
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
            }),
          );
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
          setLocation({
            latitude: update.data.center.lat,
            longitude: update.data.center.lng,
          });
        }
        break;

      case "route":
        if (update.route) {
          const toLoc = update.route.to;

          const executeRoute = async (fromLoc: {
            lat: number;
            lng: number;
          }) => {
            if (
              !fromLoc ||
              typeof fromLoc.lat !== "number" ||
              typeof fromLoc.lng !== "number" ||
              !toLoc ||
              typeof toLoc.lat !== "number" ||
              typeof toLoc.lng !== "number" ||
              isNaN(fromLoc.lat) ||
              isNaN(fromLoc.lng) ||
              isNaN(toLoc.lat) ||
              isNaN(toLoc.lng)
            ) {
              console.error(
                "OSRM routing execution error: Invalid coordinates provided",
                { fromLoc, toLoc },
              );
              setToast({
                message:
                  "Could not calculate route due to invalid location coordinates.",
                type: "error",
              });
              return;
            }

            try {
              const { getRoute } = await import("@/lib/routing");
              const routeData = await getRoute(fromLoc, toLoc, routeProfile);

              const newRoute: MapRoute = {
                id: `route-${Date.now()}`,
                path: routeData?.path || [
                  { lat: fromLoc.lat, lng: fromLoc.lng },
                  { lat: toLoc.lat, lng: toLoc.lng },
                ],
                distance: routeData?.distance,
                duration: routeData?.duration,
                isHighlighted: true,
              };
              setRoutes([newRoute]);

              // Center map between starting location and destination
              setMapView({
                center: {
                  lat: (fromLoc.lat + toLoc.lat) / 2,
                  lng: (fromLoc.lng + toLoc.lng) / 2,
                },
                zoom: 14,
                animate: true,
              });
            } catch (error) {
              console.error("OSRM routing execution error:", error);
            }
          };

          // Try browser geolocation first to check permissions/availability on demand
          if ("geolocation" in navigator) {
            try {
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  if (
                    position.coords.accuracy !== undefined &&
                    position.coords.accuracy > 50
                  ) {
                    console.warn(
                      `GPS accuracy too low during directions request (${position.coords.accuracy}m). Falling back.`,
                    );
                    setToast({
                      message: `GPS accuracy too low (${Math.round(position.coords.accuracy)}m). Fallback: using map viewport center.`,
                      type: "warning",
                    });

                    // Fallback to center of current map viewport, or location state, or default SF
                    let fallbackLoc = { lat: 37.7749, lng: -122.4194 }; // Default SF
                    if (
                      mapView?.center &&
                      typeof mapView.center.lat === "number"
                    ) {
                      fallbackLoc = mapView.center;
                    } else if (
                      mapView?.center &&
                      "latitude" in mapView.center &&
                      typeof (mapView.center as any).latitude === "number"
                    ) {
                      fallbackLoc = {
                        lat: (mapView.center as any).latitude,
                        lng: (mapView.center as any).longitude,
                      };
                    } else if (
                      location &&
                      typeof location.latitude === "number"
                    ) {
                      fallbackLoc = {
                        lat: location.latitude,
                        lng: location.longitude,
                      };
                    }
                    executeRoute(fallbackLoc);
                    return;
                  }

                  const preciseLoc = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                  };
                  setLocation({
                    latitude: preciseLoc.lat,
                    longitude: preciseLoc.lng,
                  });
                  executeRoute(preciseLoc);
                },
                (error) => {
                  console.warn(
                    "Geolocation failed or blocked during directions request:",
                    error,
                  );

                  // Catch geolocation permission errors and display the toast
                  setToast({
                    message:
                      "Location access denied. Fallback: using map viewport center.",
                    type: "warning",
                  });

                  // Fallback to center of current map viewport, or location state, or default SF
                  let fallbackLoc = { lat: 37.7749, lng: -122.4194 }; // Default SF

                  if (
                    mapView?.center &&
                    typeof mapView.center.lat === "number"
                  ) {
                    fallbackLoc = mapView.center;
                  } else if (
                    mapView?.center &&
                    "latitude" in mapView.center &&
                    typeof (mapView.center as any).latitude === "number"
                  ) {
                    // Catch AI sending latitude instead of lat
                    fallbackLoc = {
                      lat: (mapView.center as any).latitude,
                      lng: (mapView.center as any).longitude,
                    };
                  } else if (
                    location &&
                    typeof location.latitude === "number"
                  ) {
                    fallbackLoc = {
                      lat: location.latitude,
                      lng: location.longitude,
                    };
                  }

                  executeRoute(fallbackLoc);
                },
                { timeout: 5000, enableHighAccuracy: false },
              );
            } catch (err) {
              console.warn(
                "Geolocation synchronous error during directions request:",
                err,
              );
              setToast({
                message:
                  "Location access blocked. Fallback: using map viewport center.",
                type: "warning",
              });
              let fallbackLoc = { lat: 37.7749, lng: -122.4194 }; // Default SF

              if (mapView?.center && typeof mapView.center.lat === "number") {
                fallbackLoc = mapView.center;
              } else if (
                mapView?.center &&
                "latitude" in mapView.center &&
                typeof (mapView.center as any).latitude === "number"
              ) {
                fallbackLoc = {
                  lat: (mapView.center as any).latitude,
                  lng: (mapView.center as any).longitude,
                };
              } else if (location && typeof location.latitude === "number") {
                fallbackLoc = {
                  lat: location.latitude,
                  lng: location.longitude,
                };
              }

              executeRoute(fallbackLoc);
            }
          } else {
            // Fallback for browsers without geolocation support
            let fallbackLoc = { lat: 37.7749, lng: -122.4194 }; // Default SF

            if (mapView?.center && typeof mapView.center.lat === "number") {
              fallbackLoc = mapView.center;
            } else if (
              mapView?.center &&
              "latitude" in mapView.center &&
              typeof (mapView.center as any).latitude === "number"
            ) {
              fallbackLoc = {
                lat: (mapView.center as any).latitude,
                lng: (mapView.center as any).longitude,
              };
            } else if (location && typeof location.latitude === "number") {
              fallbackLoc = { lat: location.latitude, lng: location.longitude };
            }

            executeRoute(fallbackLoc);
          }
        }
        break;
    }
  };

  // Handle venue rating submission
  const handleRatingSubmit = async (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    comment?: string;
    hasErgonomic: boolean;
    outletDensity: "every_table" | "some_tables" | "wall_seats" | "none";
    wifiSpeed?: number;
    downloadSpeed?: number;
    uploadSpeed?: number;
    latency?: number;
    crowdLevel?: string;
    petsAllowedIndoors?: boolean;
    patioOnly?: boolean;
    waterBowlsProvided?: boolean;
    dogFriendly?: boolean;
    catsAllowed?: boolean;
  }) => {
    if (!ratingDialog.venue) return;

    const prevMarkers = [...markers];

    // Optimistic UI update before server response finishes
    setMarkers((prev) =>
      prev.map((m) =>
        m.id === ratingDialog.venue!.id
          ? {
              ...m,
              score: rating.wifiQuality,
              rating: rating.wifiQuality,
              wifiQuality: rating.wifiQuality,
              hasOutlets: rating.hasOutlets,
              noiseLevel: rating.noiseLevel,
            }
          : m,
      ),
    );

    try {
      const response = await fetch(
        `/api/venues/${ratingDialog.venue.id}/rate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...rating,
            downloadSpeed: rating.downloadSpeed,
            uploadSpeed: rating.uploadSpeed,
            latency: rating.latency,
            crowdLevel: rating.crowdLevel,
            venue: {
              placeId: ratingDialog.venue.id,
              name: ratingDialog.venue.name,
              lat: ratingDialog.venue.position.lat,
              lng: ratingDialog.venue.position.lng,
              category: ratingDialog.venue.category,
              address: ratingDialog.venue.address,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to submit rating");
      }

      console.log("Rating submitted successfully");
      alert("Rating submitted! Thank you for helping the community.");
    } catch (error) {
      setMarkers(prevMarkers);
      console.error("Error submitting rating:", error);
      alert("Failed to submit rating. Please try again.");
    }
  };

  if (!location || isLoadingLocation) {
    return (
      <div
        className="flex items-center justify-center h-screen bg-gradient-to-br from-zinc-50 via-blue-50/30 to-zinc-50 dark:from-black dark:via-blue-950/10 dark:to-black"
        style={{
          backgroundImage:
            "linear-gradient(135deg, #fafafa 0%, rgba(219, 234, 254, 0.3) 50%, #fafafa 100%)",
        }}
      >
        <div className="text-center p-8 max-w-md">
          <div className="relative mx-auto mb-6 w-20 h-20">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 animate-pulse flex items-center justify-center">
              <Loader2 className="w-10 h-10 animate-spin text-white" />
            </div>
            <div className="absolute inset-0 w-20 h-20 rounded-full accent-bg-20 animate-ping" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
            Finding Your Location
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            We're pinpointing your location to find the best workspaces
            nearby...
          </p>
          {!isOnline && (
            <div className="mt-4 px-4 py-3 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm flex items-center justify-center gap-2">
              <WifiOff className="w-4 h-4" />
              You're offline - loading saved venues
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-zinc-50 dark:bg-black overflow-hidden">
      <OnboardingTour />
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-center py-2 text-sm flex items-center justify-center gap-2 shadow-lg">
          <WifiOff className="w-4 h-4 animate-pulse" />
          <span className="font-medium">You're offline</span>
          <span className="opacity-80">— showing saved venues</span>
        </div>
      )}

      {/* Real-time connection status (debug) wrapped in client-only isolation */}
      <PartyKitPresenceWrapper>
        {isConnected && venueIds.length > 0 && (
          <div className="hidden" data-realtime="connected" />
        )}
      </PartyKitPresenceWrapper>

      {/* Mobile Navigation Toggle */}
      <div className="lg:hidden flex border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <button
          onClick={() => setMobileView("chat")}
          className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold transition-all ${
            mobileView === "chat"
              ? "accent-text accent-bg-10 accent-bg-dark-20 border-b-2 accent-border"
              : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          <MessageCircle className="w-5 h-5" />
          Chat
        </button>
        <button
          onClick={() => setMobileView("map")}
          className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold transition-all ${
            mobileView === "map"
              ? "accent-text accent-bg-10 accent-bg-dark-20 border-b-2 accent-border"
              : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          <MapIcon className="w-5 h-5" />
          Map
          {markers.length > 0 && (
            <span
              className="px-2 py-0.5 text-xs text-white rounded-full font-bold shadow-sm"
              style={{
                background: `linear-gradient(to right, var(--primary-accent), color-mix(in srgb, var(--primary-accent) 70%, #7c3aed))`,
              }}
            >
              {markers.length}
            </span>
          )}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 lg:flex-row overflow-hidden relative">
        {/* Map Section - Hidden on mobile when chat is active */}
        <div
          className={`
          joyride-map
          ${mobileView === "map" ? "flex" : "hidden"} 
          lg:flex flex-1 lg:flex-[7] relative
        `}
        >
          <MapErrorBoundary>
            <Map
              location={location}
              markers={markers}
              routes={routes}
              mapView={mapView}
              roomId={sessionId}
            />
          </MapErrorBoundary>
        </div>

        {/* Divider - Desktop only */}
        <div className="hidden lg:block w-px bg-gradient-to-b from-zinc-200 via-zinc-300 to-zinc-200 dark:from-zinc-800 dark:via-zinc-700 dark:to-zinc-800 z-10" />

        {/* Chat Section with Framer Motion */}
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <motion.div
              initial={{ maxWidth: 0, opacity: 0 }}
              animate={{ maxWidth: 1200, opacity: 1 }}
              exit={{ maxWidth: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              onUpdate={() => window.dispatchEvent(new Event("resize"))}
              className={`
                joyride-chat
                ${mobileView === "chat" ? "flex" : "hidden"} 
                lg:flex flex-1 lg:flex-[3] flex-col min-h-0 relative
                backdrop-blur-md bg-white/5 border-l border-white/10 dark:bg-black/40
              `}
            >
              {/* Sidebar Toggle Button - Attached to the left edge of the sidebar */}
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 -ml-8 z-50 items-center justify-center w-8 h-16 bg-zinc-900 hover:bg-zinc-800 border border-r-0 border-zinc-700 rounded-l-xl text-white transition-all shadow-lg pl-1"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              {/* Route Profile Toggle Widget */}
              {routes.length > 0 && (
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Route Profile
                    </span>
                    {routes[0].duration && (
                      <span className="text-xs font-medium accent-text accent-text-60">
                        {Math.round(routes[0].duration / 60)} mins •{" "}
                        {(routes[0].distance! / 1000).toFixed(1)} km
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["walking", "cycling", "driving"] as const).map(
                      (profile) => (
                        <button
                          key={profile}
                          onClick={async () => {
                            setRouteProfile(profile);
                            // Re-calculate route with new profile
                            if (routes.length > 0 && location) {
                              const { getRoute } =
                                await import("@/lib/routing");
                              const lastRoute = routes[0];
                              // We need the original destination. For now, we take the last point of the path.
                              const destination =
                                lastRoute.path[lastRoute.path.length - 1];
                              const routeData = await getRoute(
                                {
                                  lat: location.latitude,
                                  lng: location.longitude,
                                },
                                destination,
                                profile,
                              );
                              if (routeData) {
                                setRoutes([
                                  {
                                    ...lastRoute,
                                    path: routeData.path,
                                    distance: routeData.distance,
                                    duration: routeData.duration,
                                  },
                                ]);
                              }
                            }
                          }}
                          className={`flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all ${
                            routeProfile === profile
                              ? "accent-bg text-white shadow-lg shadow-[var(--primary-accent)]/20"
                              : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750"
                          }`}
                        >
                          {profile === "walking"
                            ? "🚶‍♂️"
                            : profile === "cycling"
                              ? "🚴‍♂️"
                              : "🚗"}
                          <span className="capitalize">{profile}</span>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
              <ChatErrorBoundary>
                <EnhancedChatbot
                  roomId={sessionId}

                  onShowToast={(msg) =>
                    setToast({ message: msg, type: "warning" })
                  }

                  onMapUpdate={(update) => {
                    handleMapUpdate(update as MapUpdateData);
                    // Auto-switch to map on mobile when markers are added
                    if (
                      update.type === "markers" &&
                      update.markers &&
                      update.markers.length > 0
                    ) {
                      // Small delay so user sees the results loading
                      setTimeout(() => setMobileView("map"), 500);
                    }
                  }}
                  onOpenDetails={(v) => {
                    // Map the Venue type from chat to the MapMarker type used here
                    setSelectedVenue({
                      id: v.id,
                      name: v.name,
                      position: { lat: v.lat, lng: v.lng },
                      category: v.category || "cafe",
                      address: v.address,
                      amenities: {
                        wifi: v.wifi,
                        outlets: v.hasOutlets,
                        quiet: v.noiseLevel === "quiet",
                        hasErgonomic: v.hasErgonomic,
                        outletDensity: v.outletDensity,
                        wifiSpeed: v.wifiSpeed,
                      },
                      score: v.score,
                    });
                  }}

                  onBook={(v) => {
                    console.log("[Booking] Initiated for:", v.name);
                    // Handled internally by EnhancedChatbot now
                  }}
                  userLocation={
                    location
                      ? { lat: location.latitude, lng: location.longitude }
                      : undefined
                  }
                />
              </ChatErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Open Button (visible only when sidebar is closed) */}
        <AnimatePresence>
          {!isSidebarOpen && (
            <motion.button
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 100, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              onClick={() => setIsSidebarOpen(true)}
              className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 z-50 items-center justify-center w-8 h-16 bg-zinc-900 hover:bg-zinc-800 border border-r-0 border-zinc-700 rounded-l-xl text-white shadow-lg pl-1"
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Venue Detail Dialog - Root level to avoid clipping */}
      <VenueDetailDialog
        venue={
          selectedVenue
            ? ({
                id: selectedVenue.id,
                name: selectedVenue.name,
                lat: selectedVenue.position.lat,
                lng: selectedVenue.position.lng,
                category: selectedVenue.category,
                address: selectedVenue.address,
                ...selectedVenue.amenities,
                score: selectedVenue.score,
              } as Venue)
            : null
        }
        isOpen={!!selectedVenue}
        onClose={() => setSelectedVenue(null)}
        isFavorited={false} // Will be handled by state if needed later
        onGetDirections={(v: Venue) => {
          if (!location) {
            console.warn(
              "[Directions] User location unavailable. Retry when GPS is acquired.",
            );
            return;
          }
          handleMapUpdate({
            type: "route",
            route: {
              from: { lat: location.latitude, lng: location.longitude },
              to: { lat: v.lat, lng: v.lng },
            },
          });
        }}
        onToggleFavorite={() => {}} // Hook into favorite state if needed
        onRate={(v: Venue) => {
          // Convert Venue to MapMarker format and open rating dialog
          setRatingDialog({
            isOpen: true,
            venue: {
              id: v.id,
              name: v.name,
              position: { lat: v.lat, lng: v.lng },
              category: v.category,
              address: v.address,
              amenities: {
                wifi: v.wifi,
                outlets: v.hasOutlets,
                quiet: v.noiseLevel === "quiet",
                wifiSpeed: v.wifiSpeed,
              },
            },
          });
          // Close the venue detail dialog
          setSelectedVenue(null);
        }}
      />

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
      <OfflineSyncNotice />

      {/* PWA Install Banner */}
      <PWABanner />

      {/* Glassmorphic Toast Warning Card */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-2xl bg-zinc-950/80 dark:bg-black/80 backdrop-blur-xl border border-white/10 shadow-2xl text-white animate-in slide-in-from-bottom duration-300">
          <div className="h-2 w-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
          <p className="text-xs font-bold uppercase tracking-wide">
            {toast.message}
          </p>
          <button
            onClick={() => setToast(null)}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors ml-2"
          >
            <X className="w-4 h-4 text-zinc-400 hover:text-white" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-zinc-50">
          <Loader2 className="w-8 h-8 animate-spin accent-text" />
        </div>
      }
    >
      <AppPage />
    </Suspense>
  );
}
