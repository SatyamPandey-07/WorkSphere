"use client";

import { useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapMarker, MapRoute, MapView } from "@/types/map";

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
        (m) => [m.position.lat, m.position.lng] as [number, number]
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
  delay = 150,
}: {
  onZoomSettled: (zoom: number) => void;
  delay?: number;
}) {
  const map = useMap();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const scheduleUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onZoomSettled(map.getZoom()), delay);
    };

    map.on("zoomend", scheduleUpdate);
    scheduleUpdate(); // capture the initial zoom too

    return () => {
      clearTimeout(timer);
      map.off("zoomend", scheduleUpdate);
    };
  }, [map, onZoomSettled, delay]);

  return null;
}

// Subcomponent to handle rendering the Leaflet heatmap layer seamlessly
function HeatmapOverlay({ points, visible }: { points: any[]; visible: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !visible || points.length === 0) return;

    // Glowing purple/blue gradient zones as outlined in issue parameters
    const gradient = {
      0.3: "#1e3a8a", // Deep Blue (Quiet)
      0.55: "#3b82f6", // Bright Blue (Moderate)
      0.8: "#8b5cf6",  // Velvet Purple (Busy)
      1.0: "#d946ef",  // Neon Pink/Fuchsia (High Activity levels)
    };

    const heatLayer = (L as any).heatLayer(points, {
      radius: 30,
      blur: 18,
      maxZoom: 16,
      gradient: gradient,
    });

    heatLayer.addTo(map);

    return () => {
      if (map && heatLayer) {
        map.removeLayer(heatLayer);
      }
    };
  }, [map, points, visible]);

  return null;
}

const Map = ({
  location,
  markers,
  routes,
  mapView,
}: {
  location: { latitude: number; longitude: number };
  markers: MapMarker[];
  routes: MapRoute[];
  mapView: MapView | null;
}) => {
  const clerkUser = useUser();
  const { latitude, longitude } = location;

  // Settled zoom level (debounced via ZoomWatcher), used to keep spiderfied
  // marker offsets at a consistent on-screen pixel separation regardless of
  // how far the user has zoomed in/out.
  const [settledZoom, setSettledZoom] = useState<number>(13);
  const handleZoomSettled = useCallback((zoom: number) => {
    setSettledZoom(zoom);
  }, []);

  // =========================================================================
  // MULTI-STOP ROUTING OPTIMIZER STATE PARAMETERS
  // =========================================================================
  const [routingQueue, setRoutingQueue] = useState<any[]>([]);
  const [optimizedRoute, setOptimizedRoute] = useState<any>(null);
  const [travelProfile, setTravelProfile] = useState<"foot" | "bike" | "car">("foot");

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
      return !(venue.latitude === prev.latitude && venue.longitude === prev.longitude);
    });

    if (dedupedList.length < 2) {
      setOptimizedRoute(null);
      return;
    }

    const coordinatesString = dedupedList
      .map(venue => `${venue.longitude},${venue.latitude}`)
      .join(";");

    const osrmProfile = travelProfile === "foot" ? "foot" : travelProfile === "bike" ? "bicycle" : "car";
    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${coordinatesString}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.code === "Ok") {
        setOptimizedRoute({
          coordinates: data.routes[0].geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]]),
          duration: data.routes[0].duration,
          distance: data.routes[0].distance,
          legs: data.routes[0].legs
        });
      }
    } catch (error) {
      console.error("OSRM Multi-Stop routing resolution failed:", error);
    }
  };

  // Track heatmap states
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [heatmapPoints, setHeatmapPoints] = useState<any[]>([]);

  // Async load data context when layer UI toggles active
  useEffect(() => {
    if (showHeatmap) {
      fetch("/api/map/heatmap")
        .then((res) => res.json())
        .then((resData) => {
          if (resData.success) {
            setHeatmapPoints(resData.data);
          }
        })
        .catch((err) => console.error("Could not populate heatmap context", err));
    }
  }, [showHeatmap]);

  // Group and spiderfy overlapping markers
  const spiderfiedMarkers = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    markers.forEach((m) => {
      if (m && m.position && m.position.lat != null && m.position.lng != null && !isNaN(Number(m.position.lat)) && !isNaN(Number(m.position.lng))) {
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
      if (n === 1) {
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
  }, [markers, settledZoom]);


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

  return (
<>
      <style dangerouslySetInnerHTML={{
        __html: `
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
        
        /* Venue marker - circular dot */
        .venue-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          border: 3px solid white;
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
          transform: translate(2px, 2px);
        }
        
        /* Destination pin marker */
        .destination-pin {
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
        
        /* Floating toggle position above canvas layers */
        .map-heatmap-toggle {
          position: absolute;
          top: 20px;
          right: 20px;
          z-index: 1000;
        }
      `}} />

      <MapContainer
        center={center}
        zoom={13}
        style={{
          width: "95%",
          height: "95%",
          borderRadius: "12px",
          position: "relative"
        }}
      >
        <div className="map-heatmap-toggle">
          <button
            type="button"
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg shadow-md border transition-all duration-200 ${
              showHeatmap
                ? "bg-purple-600 text-white border-purple-500 hover:bg-purple-700"
                : "bg-zinc-900 text-zinc-300 border-zinc-700 hover:bg-zinc-800"
            }`}
          >
            {showHeatmap ? "📍 Show Venue Markers" : "🔥 Show Live Crowd Heatmap"}
          </button>
        </div>

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles-dark"
        />
        <MapController mapView={mapView} />
        <AutoCenter markers={markers} userLocation={center} />
        <ZoomWatcher onZoomSettled={handleZoomSettled} />

        {customIcon && (
          <Marker position={center} icon={customIcon}>
            <Popup>You are here!</Popup>
          </Marker>
        )}


        {showHeatmap ? (
          <HeatmapOverlay points={heatmapPoints} visible={showHeatmap} />
        ) : (
          spiderfiedMarkers.map((marker) => (
            <Marker
              key={marker.id}
              position={[marker.renderedLat, marker.renderedLng]}
              icon={marker.id.includes("dest") ? destinationIcon : venueIcon}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold text-white">{marker.name}</div>
                  {marker.category && (
                    <div className="text-zinc-400">{marker.category}</div>
                  )}
                  {marker.address && (
                    <div className="text-zinc-500 text-xs mt-1">{marker.address}</div>
                  )}
                </div>
                <button
                  onClick={() => {
                    // Prevent duplicates in queue chain matrix
                    if (!routingQueue.some(v => v.id === marker.id)) {
                      const updated = [...routingQueue, {
                        id: marker.id,
                        name: marker.name,
                        latitude: Number(marker.position.lat),
                        longitude: Number(marker.position.lng)
                      }];
                      setRoutingQueue(updated);
                      calculateOptimizedRoute(updated);
                    }
                  }}
                  className="mt-2 w-full rounded bg-zinc-800 py-1 text-[10px] font-medium text-zinc-200 hover:bg-blue-600 hover:text-white transition-colors"
                >
                  ➕ Add to Workday Timeline
                </button>
              </Popup>
            </Marker>
          ))
        )}

        {/* Render OSRM Optimized Multi-Stop Routing Layer Geometry */}
        {optimizedRoute && optimizedRoute.coordinates && optimizedRoute.coordinates.length > 1 && (
          <Polyline
            positions={optimizedRoute.coordinates}
            pathOptions={{
              color: "#3b82f6", // Electric Blue for Multi-Stop Leg paths
              weight: 6,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
              dashArray: travelProfile === "foot" ? "5, 10" : undefined // Dotted path line if walking
            }}
          >
            <Popup>
              <div className="text-sm text-white">
                <div className="font-bold text-blue-400">Optimized Hybrid Schedule</div>
                <div>Total Distance: {(optimizedRoute.distance / 1000).toFixed(2)} km</div>
                <div>Est. Travel Time: {Math.round(optimizedRoute.duration / 60)} mins</div>
              </div>
            </Popup>
          </Polyline>
        )}



        {routes.map((route) => {
          const validPositions = (route.path || [])
            .filter((p) => p && p.lat != null && p.lng != null && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng)))
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
        <div className="absolute bottom-6 left-6 z-[1000] w-80 rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 text-white shadow-2xl backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
            <h3 className="font-semibold text-sm tracking-wide text-zinc-200">📍 ROUTING OPTIMIZER</h3>
            {routingQueue.length > 0 && (
              <button
                onClick={() => { setRoutingQueue([]); setOptimizedRoute(null); }}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear Queue
              </button>
            )}
          </div>

          {/* Travel Mode Selectors */}
          <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-zinc-900 p-1 text-xs">
            {(["foot", "bike", "car"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setTravelProfile(mode)}
                className={`rounded-md py-1.5 font-medium uppercase transition-all ${travelProfile === mode
                    ? "bg-blue-600 text-white shadow"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
              >
                {mode === "foot" ? "🚶‍♂️ Walk" : mode === "bike" ? "🚴‍♂️ Bike" : "🚗 Drive"}
              </button>
            ))}
          </div>

          {/* Queue Timeline Slots */}
          {routingQueue.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
              Click markers or venue listings to chain multiple destinations into your hybrid workday route!
            </div>
          ) : (
            <div className="space-y-2">
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {routingQueue.map((venue, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-lg bg-zinc-900 p-2 text-xs border border-zinc-800">
                    <div className="flex items-center gap-2 truncate">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-950 text-[10px] font-bold text-blue-400 border border-blue-800/50">
                        {idx + 1}
                      </span>
                      <span className="truncate font-medium text-zinc-300">{venue.name}</span>
                    </div>
                    <button
                      onClick={() => {
                        const updated = routingQueue.filter((_, i) => i !== idx);
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
                  className="mt-3 w-full rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 py-2 text-xs font-semibold text-white shadow-lg transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98]"
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
                <span className="font-semibold text-zinc-200">{(optimizedRoute.distance / 1000).toFixed(2)} km</span>
              </div>
              <div className="flex justify-between">
                <span>Est. Transit Time:</span>
                <span className="font-semibold text-zinc-200">{Math.round(optimizedRoute.duration / 60)} mins</span>
              </div>
            </div>
          )}
        </div>
      </MapContainer>
    </>
  );
};

export default Map;
