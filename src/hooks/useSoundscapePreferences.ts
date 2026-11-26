import { useCallback, useEffect, useRef, useState } from 'react';

export type SoundLayer = 'brown' | 'cafe' | 'rain';

export interface SoundscapePreferences {
  brown: number;
  cafe: number;
  rain: number;
  // Aliases for compatibility
  brownNoise?: number;
  cafeChatter?: number;
  rainfall?: number;
}

export const SOUNDSCAPE_PREFERENCES_STORAGE_KEY = 'worksphere:soundscape_preferences:v1';

export const DEFAULT_SOUNDSCAPE_PREFERENCES: Readonly<SoundscapePreferences> = Object.freeze({
  brown: 50,
  cafe: 50,
  rain: 50,
  brownNoise: 50,
  cafeChatter: 50,
  rainfall: 50,
});

/**
 * Validates and clamps a single volume value into the range [0, 100].
 * If invalid or not finite, returns the fallback value.
 */
export function clampSoundLayerVolume(value: unknown, fallback: number = 50): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Validates preference object and fills missing/invalid layer volumes from fallback defaults.
 */
export function validateSoundscapePreferences(
  data: unknown,
  fallback = DEFAULT_SOUNDSCAPE_PREFERENCES
): SoundscapePreferences {
  if (!data || typeof data !== 'object') {
    return { ...fallback };
  }

  const raw = data as Record<string, unknown>;

  // Brown noise volume
  const brownVal = raw.brown !== undefined ? raw.brown : raw.brownNoise;
  const brown = clampSoundLayerVolume(brownVal, fallback.brown);

  // Cafe chatter volume
  const cafeVal = raw.cafe !== undefined ? raw.cafe : raw.cafeChatter;
  const cafe = clampSoundLayerVolume(cafeVal, fallback.cafe);

  // Rainfall volume
  const rainVal = raw.rain !== undefined ? raw.rain : raw.rainfall;
  const rain = clampSoundLayerVolume(rainVal, fallback.rain);

  return {
    brown,
    cafe,
    rain,
    brownNoise: brown,
    cafeChatter: cafe,
    rainfall: rain,
  };
}

/**
 * Safely loads preferences from localStorage, defensively handling JSON parsing and access errors.
 */
export function loadSoundscapePreferences(
  storageKey = SOUNDSCAPE_PREFERENCES_STORAGE_KEY,
  storage?: Storage | null
): SoundscapePreferences {
  const store = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) {
    return { ...DEFAULT_SOUNDSCAPE_PREFERENCES };
  }

  try {
    const raw = store.getItem(storageKey);
    if (!raw) {
      return { ...DEFAULT_SOUNDSCAPE_PREFERENCES };
    }
    const parsed = JSON.parse(raw);
    return validateSoundscapePreferences(parsed, DEFAULT_SOUNDSCAPE_PREFERENCES);
  } catch {
    // Return defaults on parse error, access denied, or corrupted storage
    return { ...DEFAULT_SOUNDSCAPE_PREFERENCES };
  }
}

/**
 * Safely writes preferences to localStorage, defensively catching errors (e.g. QuotaExceededError).
 */
export function saveSoundscapePreferences(
  prefs: SoundscapePreferences,
  storageKey = SOUNDSCAPE_PREFERENCES_STORAGE_KEY,
  storage?: Storage | null
): boolean {
  const store = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) {
    return false;
  }

  try {
    const payload = JSON.stringify({
      brown: prefs.brown,
      cafe: prefs.cafe,
      rain: prefs.rain,
      brownNoise: prefs.brown,
      cafeChatter: prefs.cafe,
      rainfall: prefs.rain,
    });
    store.setItem(storageKey, payload);
    return true;
  } catch {
    // QuotaExceededError or private mode restrictions
    return false;
  }
}

export interface UseSoundscapePreferencesOptions {
  storageKey?: string;
  storage?: Storage | null;
  debounceMs?: number;
}

export interface UseSoundscapePreferencesResult {
  preferences: SoundscapePreferences;
  setLayerVolume: (layer: SoundLayer | 'brownNoise' | 'cafeChatter' | 'rainfall', volume: number) => void;
  updatePreferences: (partial: Partial<SoundscapePreferences>) => void;
  resetPreferences: () => void;
}

/**
 * Hook to manage independent sound layer volume preferences with debounced localStorage persistence.
 */
export function useSoundscapePreferences(
  options?: UseSoundscapePreferencesOptions | string
): UseSoundscapePreferencesResult {
  const resolvedOptions: UseSoundscapePreferencesOptions =
    typeof options === 'string' ? { storageKey: options } : options || {};

  const storageKey = resolvedOptions.storageKey ?? SOUNDSCAPE_PREFERENCES_STORAGE_KEY;
  const storage = resolvedOptions.storage;
  const debounceMs = resolvedOptions.debounceMs ?? 300;

  // Initialize state once from storage or defaults (does not auto-trigger audio playback)
  const [preferences, setPreferences] = useState<SoundscapePreferences>(() =>
    loadSoundscapePreferences(storageKey, storage)
  );

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPrefsRef = useRef<SoundscapePreferences>(preferences);
  const lastPersistedJsonRef = useRef<string>('');

  // Keep pendingPrefsRef up-to-date with current state
  useEffect(() => {
    pendingPrefsRef.current = preferences;
  }, [preferences]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  // Schedule debounced storage write
  const schedulePersistence = useCallback(
    (nextPrefs: SoundscapePreferences) => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const json = JSON.stringify({
          brown: nextPrefs.brown,
          cafe: nextPrefs.cafe,
          rain: nextPrefs.rain,
        });

        // Avoid unnecessary storage writes when values have not changed
        if (json !== lastPersistedJsonRef.current) {
          const success = saveSoundscapePreferences(nextPrefs, storageKey, storage);
          if (success) {
            lastPersistedJsonRef.current = json;
          }
        }
        debounceTimerRef.current = null;
      }, debounceMs);
    },
    [storageKey, storage, debounceMs]
  );

  const setLayerVolume = useCallback(
    (layer: SoundLayer | 'brownNoise' | 'cafeChatter' | 'rainfall', volume: number) => {
      const canonicalLayer: SoundLayer =
        layer === 'brownNoise' ? 'brown' : layer === 'cafeChatter' ? 'cafe' : layer === 'rainfall' ? 'rain' : layer;

      const clamped = clampSoundLayerVolume(volume, DEFAULT_SOUNDSCAPE_PREFERENCES[canonicalLayer]);

      setPreferences((prev) => {
        // Immediate in-memory update
        const next: SoundscapePreferences = {
          ...prev,
          [canonicalLayer]: clamped,
          brownNoise: canonicalLayer === 'brown' ? clamped : prev.brown,
          cafeChatter: canonicalLayer === 'cafe' ? clamped : prev.cafe,
          rainfall: canonicalLayer === 'rain' ? clamped : prev.rain,
        };
        pendingPrefsRef.current = next;
        schedulePersistence(next);
        return next;
      });
    },
    [schedulePersistence]
  );

  const updatePreferences = useCallback(
    (partial: Partial<SoundscapePreferences>) => {
      setPreferences((prev) => {
        const next = validateSoundscapePreferences({ ...prev, ...partial }, prev);
        pendingPrefsRef.current = next;
        schedulePersistence(next);
        return next;
      });
    },
    [schedulePersistence]
  );

  const resetPreferences = useCallback(() => {
    const defaults = { ...DEFAULT_SOUNDSCAPE_PREFERENCES };
    setPreferences(defaults);
    pendingPrefsRef.current = defaults;
    schedulePersistence(defaults);
  }, [schedulePersistence]);

  return {
    preferences,
    setLayerVolume,
    updatePreferences,
    resetPreferences,
  };
}
