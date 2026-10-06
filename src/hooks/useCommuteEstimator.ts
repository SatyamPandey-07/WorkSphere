"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  type CommuteMode,
  type CommuteEstimate,
  calculateAllCommuteEstimates,
  COMMUTE_MODES,
} from "@/lib/commute/carbonEstimator";

export interface UseCommuteEstimatorOptions {
  venueLatitude: number;
  venueLongitude: number;
  venueName?: string;
  initialMode?: CommuteMode;
  initialOrigin?: { latitude: number; longitude: number } | null;
}

export interface UseCommuteEstimatorReturn {
  activeMode: CommuteMode;
  setActiveMode: (mode: CommuteMode) => void;
  activeEstimate: CommuteEstimate | null;
  allEstimates: Record<CommuteMode, CommuteEstimate> | null;
  userCoords: { latitude: number; longitude: number } | null;
  isLoadingLocation: boolean;
  locationError: string | null;
  requestCurrentLocation: () => Promise<void>;
  workDaysPerWeek: number;
  setWorkDaysPerWeek: (days: number) => void;
  showWeeklyProjection: boolean;
  setShowWeeklyProjection: (show: boolean) => void;
}

const STORAGE_KEY_MODE = "worksphere:preferred_commute_mode";

export function useCommuteEstimator({
  venueLatitude,
  venueLongitude,
  venueName,
  initialMode = "transit",
  initialOrigin = null,
}: UseCommuteEstimatorOptions): UseCommuteEstimatorReturn {
  const [activeMode, setActiveModeState] = useState<CommuteMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY_MODE) as CommuteMode | null;
      if (saved && saved in COMMUTE_MODES) return saved;
    }
    return initialMode;
  });

  const [userCoords, setUserCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(initialOrigin);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [workDaysPerWeek, setWorkDaysPerWeek] = useState(5);
  const [showWeeklyProjection, setShowWeeklyProjection] = useState(false);

  const setActiveMode = useCallback((mode: CommuteMode) => {
    setActiveModeState(mode);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_MODE, mode);
      } catch {}
    }
  }, []);

  const requestCurrentLocation = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }

    setIsLoadingLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setIsLoadingLocation(false);
      },
      (err) => {
        setLocationError(`Location access error: ${err.message}`);
        setIsLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [venueLatitude, venueLongitude]);

  // Request location on mount if no initialOrigin provided
  useEffect(() => {
    if (!userCoords) {
      void requestCurrentLocation();
    }
  }, [userCoords, requestCurrentLocation]);

  // Compute all estimates
  const allEstimates = useMemo(() => {
    const origin = userCoords ?? {
      latitude: venueLatitude + 0.03,
      longitude: venueLongitude + 0.03,
    };

    return calculateAllCommuteEstimates(
      origin.latitude,
      origin.longitude,
      venueLatitude,
      venueLongitude,
      workDaysPerWeek,
    );
  }, [userCoords, venueLatitude, venueLongitude, workDaysPerWeek]);

  const activeEstimate = allEstimates ? allEstimates[activeMode] : null;

  return {
    activeMode,
    setActiveMode,
    activeEstimate,
    allEstimates,
    userCoords,
    isLoadingLocation,
    locationError,
    requestCurrentLocation,
    workDaysPerWeek,
    setWorkDaysPerWeek,
    showWeeklyProjection,
    setShowWeeklyProjection,
  };
}
