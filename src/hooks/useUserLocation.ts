"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface UserLocation {
  latitude: number;
  longitude: number;
}

export type LocationSource = "gps" | "ip" | "manual" | "default";
export type GeolocationPermissionState = "prompt" | "granted" | "denied";

export interface GeocodedLocation {
  lat: number;
  lng: number;
  displayName: string;
}

export interface UseUserLocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  defaultLocation?: UserLocation;
  autoRequest?: boolean;
}

export const DEFAULT_FALLBACK_LOCATION: UserLocation = {
  latitude: 37.7749,
  longitude: -122.4194,
};

export const MAX_USABLE_ACCURACY_M = 3000;

/**
 * Resolves a city name or postal code to latitude & longitude using OpenStreetMap Nominatim.
 */
export async function geocodePostalOrCity(
  query: string,
): Promise<GeocodedLocation | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      trimmed,
    )}&limit=1&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "WorkSphere-App/1.0 (https://worksphere.app)",
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);

      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        !(lat === 0 && lng === 0)
      ) {
        return {
          lat,
          lng,
          displayName: first.display_name || first.name || trimmed,
        };
      }
    }
  } catch (err) {
    console.error("[Geocoding] Nominatim resolution error:", err);
  }
  return null;
}

export function useUserLocation(options: UseUserLocationOptions = {}) {
  const {
    enableHighAccuracy = false,
    timeout = 6000,
    maximumAge = 60000,
    defaultLocation = DEFAULT_FALLBACK_LOCATION,
    autoRequest = true,
  } = options;

  const [location, setLocation] = useState<UserLocation>(defaultLocation);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [source, setSource] = useState<LocationSource>("default");
  const [permissionState, setPermissionState] =
    useState<GeolocationPermissionState>("prompt");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // Fallback to IP-based location API or default coordinates
  const fallbackToIp = useCallback(async () => {
    try {
      const response = await fetch("/api/location");
      if (response.ok) {
        const data = await response.json();
        if (
          Number.isFinite(data.lat) &&
          Number.isFinite(data.lng) &&
          !(data.lat === 0 && data.lng === 0)
        ) {
          if (!isMountedRef.current) return;
          setLocation({ latitude: data.lat, longitude: data.lng });
          const nameParts = [data.city, data.region || data.country].filter(
            Boolean,
          );
          setLocationName(nameParts.length > 0 ? nameParts.join(", ") : null);
          setSource("ip");
          return;
        }
      }
    } catch (apiErr) {
      console.warn("[Location] IP fallback lookup error:", apiErr);
    }

    if (!isMountedRef.current) return;
    setLocation(defaultLocation);
    setLocationName("San Francisco, CA");
    setSource("default");
  }, [defaultLocation]);

  // Request browser geolocation
  const requestLocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      if (isMountedRef.current) {
        setPermissionState("denied");
        setError("Geolocation is not supported by your browser");
      }
      await fallbackToIp();
      if (isMountedRef.current) setIsLoading(false);
      return;
    }

    // Check Permissions API if supported
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({
          name: "geolocation",
        });
        if (isMountedRef.current) {
          setPermissionState(
            status.state === "granted"
              ? "granted"
              : status.state === "denied"
                ? "denied"
                : "prompt",
          );
        }

        status.onchange = () => {
          if (isMountedRef.current) {
            setPermissionState(
              status.state === "granted"
                ? "granted"
                : status.state === "denied"
                  ? "denied"
                  : "prompt",
            );
          }
        };
      }
    } catch {
      // Permissions API not available or throws on some browsers; continue
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!isMountedRef.current) return;

        // Discard fixes worse than max usable accuracy
        if (
          pos.coords.accuracy !== undefined &&
          pos.coords.accuracy > MAX_USABLE_ACCURACY_M
        ) {
          console.warn(
            `[Location] GPS accuracy too low (${pos.coords.accuracy}m). Using IP fallback.`,
          );
          fallbackToIp().finally(() => {
            if (isMountedRef.current) setIsLoading(false);
          });
          return;
        }

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
          setLocation({ latitude: lat, longitude: lng });
          setSource("gps");
          setPermissionState("granted");
          setError(null);
        } else {
          fallbackToIp();
        }
        setIsLoading(false);
      },
      async (err: GeolocationPositionError) => {
        if (!isMountedRef.current) return;

        if (err.code === 1 || err.code === err.PERMISSION_DENIED) {
          setPermissionState("denied");
          setError("Location access denied by user or browser policy");
        } else {
          setError(err.message || "Unable to retrieve GPS position");
        }

        await fallbackToIp();
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      },
      {
        enableHighAccuracy,
        timeout,
        maximumAge,
      },
    );
  }, [enableHighAccuracy, timeout, maximumAge, fallbackToIp]);

  // Set manual virtual center by lat/lng
  const setManualLocation = useCallback(
    (lat: number, lng: number, name?: string) => {
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        !(lat === 0 && lng === 0)
      ) {
        setLocation({ latitude: lat, longitude: lng });
        if (name) setLocationName(name);
        setSource("manual");
        setError(null);
      }
    },
    [],
  );

  // Resolve city name or postal code and set as active location
  const resolvePostalOrCity = useCallback(
    async (query: string): Promise<GeocodedLocation | null> => {
      setIsLoading(true);
      const res = await geocodePostalOrCity(query);
      if (!isMountedRef.current) return null;

      if (res) {
        setLocation({ latitude: res.lat, longitude: res.lng });
        setLocationName(res.displayName);
        setSource("manual");
        setError(null);
      }
      setIsLoading(false);
      return res;
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (autoRequest) {
      requestLocation();
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [autoRequest, requestLocation]);

  return {
    location,
    locationName,
    source,
    permissionState,
    isDenied: permissionState === "denied",
    isLoading,
    error,
    requestLocation,
    setLocation: (loc: UserLocation | null) => {
      if (
        loc &&
        Number.isFinite(loc.latitude) &&
        Number.isFinite(loc.longitude) &&
        !(loc.latitude === 0 && loc.longitude === 0)
      ) {
        setLocation(loc);
        setSource("manual");
        setError(null);
      }
    },
    setManualLocation,
    resolvePostalOrCity,
  };
}
