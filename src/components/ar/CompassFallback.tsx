"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { CompassKalmanFilter } from "@/lib/spatial/compassFilter";
import {
  calculateBearing,
  calculateRelativeBearing,
  formatDistance,
  getCompassDirection,
  getRelativeDirectionDescription,
} from "@/lib/geo";
import { calculateHaversineDistance } from "@/lib/utils";
import {
  Navigation,
  Compass,
  MapPin,
  AlertCircle,
  RotateCw,
  LocateFixed,
  X,
} from "lucide-react";

interface CompassFallbackProps {
  destinationLat?: number | null;
  destinationLng?: number | null;
  destinationName?: string | null;
  onRetryAR?: () => void;
  onClose?: () => void;
  trapFocus?: boolean;
  kalmanQ?: number;
  kalmanR?: number;
}

interface UserCoordinates {
  lat: number;
  lng: number;
  accuracy?: number;
}

export default function CompassFallback({
  destinationLat,
  destinationLng,
  destinationName,
  onRetryAR,
  onClose,
  trapFocus = true,
  kalmanQ = 0.05,
  kalmanR = 0.5,
}: CompassFallbackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, {
    isActive: trapFocus,
    onEscape: onClose,
  });

  const { heading, error: orientationError, isSupported, permissionState, requestPermission } =
    useDeviceOrientation();

  const [filteredHeading, setFilteredHeading] = useState<number | null>(null);
  const kalmanFilterRef = useRef<CompassKalmanFilter | null>(null);

  if (!kalmanFilterRef.current) {
    kalmanFilterRef.current = new CompassKalmanFilter({ q: kalmanQ, r: kalmanR });
  }

  useEffect(() => {
    kalmanFilterRef.current?.setParameters({ q: kalmanQ, r: kalmanR });
  }, [kalmanQ, kalmanR]);

  useEffect(() => {
    if (heading !== null && !isNaN(heading)) {
      const smoothed = kalmanFilterRef.current?.update(heading);
      if (smoothed !== null && smoothed !== undefined) {
        setFilteredHeading(Math.round(smoothed * 10) / 10);
      }
    } else {
      setFilteredHeading(null);
    }
  }, [heading]);

  const activeHeading = filteredHeading !== null ? filteredHeading : heading;

  const [userLocation, setUserLocation] = useState<UserCoordinates | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState<boolean>(true);
  const [mode, setMode] = useState<"venue" | "north">("venue");

  const hasDestination =
    typeof destinationLat === "number" &&
    typeof destinationLng === "number" &&
    !isNaN(destinationLat) &&
    !isNaN(destinationLng);

  // Watch user location for real-time bearing calculation
  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGeoError("Geolocation is not supported by your browser.");
      setGeoLoading(false);
      return;
    }

    setGeoLoading(true);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGeoError(null);
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(err.message || "Failed to retrieve your current location.");
        setGeoLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      },
    );

    return () => {
      if (typeof window !== "undefined" && "geolocation" in navigator && watchId !== undefined) {
        navigator.geolocation?.clearWatch?.(watchId);
      }
    };
  }, []);

  // Calculate distance, bearing, and relative bearing
  const distanceKm =
    hasDestination && userLocation
      ? calculateHaversineDistance(
          userLocation.lat,
          userLocation.lng,
          destinationLat!,
          destinationLng!,
        )
      : null;

  const targetBearing =
    hasDestination && userLocation
      ? calculateBearing(
          userLocation.lat,
          userLocation.lng,
          destinationLat!,
          destinationLng!,
        )
      : null;

  const relativeBearing =
    targetBearing !== null && activeHeading !== null
      ? calculateRelativeBearing(targetBearing, activeHeading)
      : null;

  const isGuidingToVenue = mode === "venue" && relativeBearing !== null;
  const arrowRotation = isGuidingToVenue
    ? relativeBearing
    : activeHeading !== null
      ? -activeHeading
      : 0;

  const turnGuidance = getRelativeDirectionDescription(relativeBearing);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={
        hasDestination
          ? `Compass navigation for ${destinationName || "Venue"}`
          : "Compass navigation"
      }
      tabIndex={-1}
      className="flex flex-col items-center justify-between w-full h-full min-h-[460px] bg-slate-900 rounded-xl p-6 text-white relative overflow-hidden select-none border border-slate-800 shadow-2xl focus:outline-none"
    >
      {/* Top Banner */}
      <div className="w-full flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
            WebXR Unavailable
          </span>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
            2D Compass Fallback
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onRetryAR && (
            <button
              type="button"
              onClick={onRetryAR}
              className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry AR</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close compass navigation"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col items-center gap-6 my-auto z-10 w-full max-w-sm">
        <div className="text-center">
          <h3 className="text-xl font-bold mb-1">
            {hasDestination ? (destinationName || "Venue Navigation") : "Compass Heading"}
          </h3>
          <p className="text-slate-400 text-xs max-w-xs mx-auto">
            {hasDestination
              ? "Follow the directional arrow overlay to reach your destination."
              : "Orientation sensors active. Real-time compass heading."}
          </p>
        </div>

        {/* iOS Permission Prompt */}
        {permissionState === "prompt" && (
          <div className="w-full bg-blue-950/60 border border-blue-500/40 rounded-xl p-4 text-center flex flex-col items-center gap-3">
            <Compass className="w-8 h-8 text-blue-400 animate-bounce" />
            <div>
              <p className="text-sm font-semibold text-blue-200">
                Enable Compass Orientation
              </p>
              <p className="text-xs text-blue-300/80 mt-1">
                iOS Safari requires permission to use device orientation sensors for directional guidance.
              </p>
            </div>
            <button
              onClick={requestPermission}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-5 py-2.5 rounded-lg transition-colors shadow-lg shadow-blue-600/30 cursor-pointer"
            >
              Allow Sensor Access
            </button>
          </div>
        )}

        {/* Error Notifications */}
        {!isSupported && (
          <div className="w-full bg-red-950/40 text-red-300 p-3 rounded-lg border border-red-500/30 flex items-center gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>Device orientation sensors are not supported on this device.</span>
          </div>
        )}

        {permissionState === "denied" && (
          <div className="w-full bg-amber-950/40 text-amber-200 p-3 rounded-lg border border-amber-500/30 flex items-center gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Orientation permission denied. Enable Motion & Orientation Access in iOS Settings → Safari.</span>
          </div>
        )}

        {orientationError && (
          <div className="w-full bg-red-950/40 text-red-300 p-3 rounded-lg border border-red-500/30 flex items-center gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{orientationError}</span>
          </div>
        )}

        {/* Compass & 2D Directional Arrow Dial */}
        <div className="relative w-64 h-64 flex items-center justify-center">
          {/* Compass Base Ring (Cardinal Points rotate with -activeHeading) */}
          <div
            className="absolute inset-0 rounded-full border-4 border-slate-700/80 bg-slate-800/90 shadow-[0_0_40px_rgba(0,0,0,0.6)] backdrop-blur-sm transition-transform duration-200 ease-out flex items-center justify-center"
            style={{
              transform: `rotate(${activeHeading !== null ? -activeHeading : 0}deg)`,
            }}
          >
            {/* Cardinal Markers */}
            <span className="absolute top-2.5 font-extrabold text-sm text-red-500">N</span>
            <span className="absolute bottom-2.5 font-bold text-sm text-slate-400">S</span>
            <span className="absolute right-3 font-bold text-sm text-slate-400">E</span>
            <span className="absolute left-3 font-bold text-sm text-slate-400">W</span>

            {/* Minor Tick Marks */}
            <div className="absolute inset-2 rounded-full border border-dashed border-slate-600/40 pointer-events-none" />
          </div>

          {/* 2D Directional Arrow Overlay */}
          <div
            className="absolute w-full h-full transition-transform duration-200 ease-out flex items-center justify-center pointer-events-none"
            style={{
              transform: `rotate(${arrowRotation}deg)`,
            }}
          >
            <div className="relative w-12 h-52 flex flex-col items-center">
              <Navigation
                className={`w-12 h-12 transform -translate-y-3 transition-colors ${
                  isGuidingToVenue
                    ? "text-emerald-400 fill-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                    : "text-blue-500 fill-blue-500 drop-shadow-[0_0_10px_rgba(59,130,246,0.6)]"
                }`}
              />
              <div
                className={`w-1 h-24 ${
                  isGuidingToVenue
                    ? "bg-gradient-to-b from-emerald-400 to-transparent"
                    : "bg-gradient-to-b from-blue-500 to-transparent"
                }`}
              />
            </div>
          </div>

          {/* Center Pin */}
          <div className="absolute w-5 h-5 bg-slate-300 rounded-full border-2 border-slate-900 shadow-md flex items-center justify-center z-20">
            <div className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
          </div>
        </div>

        {/* Guidance and Distance Status Panel */}
        <div className="w-full flex flex-col items-center gap-2">
          {hasDestination && (
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-emerald-300">
                {geoLoading ? "Acquiring GPS location..." : turnGuidance || "Pointing to destination"}
              </span>
              {distanceKm !== null && (
                <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {formatDistance(distanceKm)}
                </span>
              )}
            </div>
          )}

          {geoError && (
            <div className="text-[11px] text-amber-400 flex items-center gap-1">
              <LocateFixed className="w-3 h-3" />
              <span>{geoError}</span>
            </div>
          )}

          {/* Heading Readout */}
          <div className="flex items-center gap-3 font-mono text-xs text-slate-400">
            <span className="bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700/60">
              Heading: <strong className="text-white">{activeHeading !== null ? `${Math.round(activeHeading)}°` : "---°"}</strong>{" "}
              {getCompassDirection(activeHeading)}
            </span>

            {targetBearing !== null && (
              <span className="bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700/60">
                Bearing: <strong className="text-white">{Math.round(targetBearing)}°</strong>
              </span>
            )}
          </div>
        </div>

        {/* View Mode Selector (when destination available) */}
        {hasDestination && (
          <div className="flex items-center gap-1 bg-slate-800/60 p-1 rounded-lg border border-slate-700/60 text-xs">
            <button
              onClick={() => setMode("venue")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                mode === "venue"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Destination Arrow
            </button>
            <button
              onClick={() => setMode("north")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                mode === "north"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Compass North
            </button>
          </div>
        )}
      </div>

      {/* Decorative Grid Background */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.15) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
}
