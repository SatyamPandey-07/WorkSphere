'use client';

import { useCallback, useEffect, useState } from 'react';

export const SEARCH_RADIUS_STORAGE_KEY = 'worksphere_search_radius';

/**
 * Allowed radius options (in kilometers) for venue search filtering.
 */
export const ALLOWED_RADIUS_OPTIONS = [0, 0.5, 1, 2, 3, 5, 10, 25, 50] as const;
export type AllowedRadius = (typeof ALLOWED_RADIUS_OPTIONS)[number];

export const DEFAULT_RADIUS: AllowedRadius = 5;

/**
 * Checks if a given value is a valid allowed radius option.
 */
export function isValidRadius(val: unknown): val is AllowedRadius {
  if (typeof val === 'number') {
    return Number.isFinite(val) && (ALLOWED_RADIUS_OPTIONS as readonly number[]).includes(val);
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    return Number.isFinite(parsed) && (ALLOWED_RADIUS_OPTIONS as readonly number[]).includes(parsed);
  }
  return false;
}

/**
 * Safely parses and validates a radius value, falling back to default (5km).
 */
export function parseRadius(val: unknown, fallback: AllowedRadius = DEFAULT_RADIUS): AllowedRadius {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return (ALLOWED_RADIUS_OPTIONS as readonly number[]).includes(val)
      ? (val as AllowedRadius)
      : fallback;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    return Number.isFinite(parsed) && (ALLOWED_RADIUS_OPTIONS as readonly number[]).includes(parsed)
      ? (parsed as AllowedRadius)
      : fallback;
  }
  return fallback;
}

/**
 * Safely reads the persisted search radius from localStorage with fallback to 5km.
 */
export function getPersistedRadius(): AllowedRadius {
  if (typeof window === 'undefined') {
    return DEFAULT_RADIUS;
  }
  try {
    const stored = window.localStorage.getItem(SEARCH_RADIUS_STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_RADIUS;
    }
    return parseRadius(stored, DEFAULT_RADIUS);
  } catch {
    return DEFAULT_RADIUS;
  }
}

/**
 * Safely writes the search radius to localStorage.
 */
export function setPersistedRadius(radius: AllowedRadius): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SEARCH_RADIUS_STORAGE_KEY, String(radius));
  } catch {
    // Ignore storage quota or access errors gracefully
  }
}

export interface UseSearchPreferencesOptions {
  initialRadius?: number;
  onRadiusChange?: (radius: AllowedRadius) => void;
}

export interface UseSearchPreferencesReturn {
  radius: AllowedRadius;
  setRadius: (radius: number | string) => void;
  allowedRadiusOptions: readonly AllowedRadius[];
  defaultRadius: AllowedRadius;
}

/**
 * Hook to manage and persist search preferences, starting with search radius distance filter (#9890).
 */
export function useSearchPreferences(
  options: UseSearchPreferencesOptions = {}
): UseSearchPreferencesReturn {
  const { initialRadius, onRadiusChange } = options;

  const [radius, setRadiusState] = useState<AllowedRadius>(() => {
    if (initialRadius !== undefined && isValidRadius(initialRadius)) {
      return parseRadius(initialRadius, DEFAULT_RADIUS);
    }
    return getPersistedRadius();
  });

  // Keep state synced with localStorage on mount if no initial radius was explicitly passed
  useEffect(() => {
    if (initialRadius === undefined) {
      const persisted = getPersistedRadius();
      setRadiusState(persisted);
    }
  }, [initialRadius]);

  const setRadius = useCallback(
    (nextRadius: number | string) => {
      const validated = parseRadius(nextRadius, DEFAULT_RADIUS);
      setRadiusState(validated);
      setPersistedRadius(validated);
      onRadiusChange?.(validated);
    },
    [onRadiusChange]
  );

  return {
    radius,
    setRadius,
    allowedRadiusOptions: ALLOWED_RADIUS_OPTIONS,
    defaultRadius: DEFAULT_RADIUS,
  };
}

export default useSearchPreferences;
