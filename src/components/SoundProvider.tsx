"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";

export type VolumeCurve = "logarithmic" | "exponential" | "linear";

export type SoundContextType = {
  soundEnabled: boolean;
  toggleSound: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  volume: number;
  setVolume: (volume: number) => void;
  curve: VolumeCurve;
  setCurve: (curve: VolumeCurve) => void;
  effectiveGain: number;
};

export interface SoundProviderProps {
  children: React.ReactNode;
  /** Optional initial sound state before reading storage (default: true) */
  defaultEnabled?: boolean;
  /** Optional localStorage key override (default: "worksphere-sound") */
  storageKey?: string;
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

const DEFAULT_STORAGE_KEY = "worksphere-sound";
const CURVE_STORAGE_KEY = "worksphere_audio_curve";
const VOLUME_STORAGE_KEY = "worksphere_audio_volume";

export function SoundProvider({
  children,
  defaultEnabled = true,
  storageKey = DEFAULT_STORAGE_KEY,
}: SoundProviderProps) {
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(defaultEnabled);
  const [volume, setVolumeState] = useState<number>(0.8);
  const [curve, setCurveState] = useState<VolumeCurve>("logarithmic");

  // Safe localStorage reader
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = window.localStorage.getItem(storageKey);
        if (stored !== null) {
          setSoundEnabledState(stored === "true");
        }
        const storedCurve = window.localStorage.getItem(CURVE_STORAGE_KEY) as VolumeCurve | null;
        if (storedCurve === "logarithmic" || storedCurve === "exponential" || storedCurve === "linear") {
          setCurveState(storedCurve);
        }
        const storedVol = window.localStorage.getItem(VOLUME_STORAGE_KEY);
        if (storedVol !== null) {
          const parsed = parseFloat(storedVol);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            setVolumeState(parsed);
          }
        }
      }
    } catch (err) {
      console.warn("[SoundProvider] Could not access localStorage:", err);
    }
  }, [storageKey]);

  // Listen for storage events across tabs
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue !== null) {
        setSoundEnabledState(e.newValue === "true");
      }
      if (e.key === CURVE_STORAGE_KEY && e.newValue !== null) {
        if (e.newValue === "logarithmic" || e.newValue === "exponential" || e.newValue === "linear") {
          setCurveState(e.newValue);
        }
      }
      if (e.key === VOLUME_STORAGE_KEY && e.newValue !== null) {
        const parsed = parseFloat(e.newValue);
        if (!isNaN(parsed)) setVolumeState(parsed);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [storageKey]);

  const setSoundEnabled = useCallback(
    (enabled: boolean) => {
      setSoundEnabledState(enabled);
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(storageKey, String(enabled));
        }
      } catch (err) {
        console.warn("[SoundProvider] Failed to persist sound state to localStorage:", err);
      }
    },
    [storageKey]
  );

  const toggleSound = useCallback(() => {
    setSoundEnabledState((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(storageKey, String(next));
        }
      } catch (err) {
        console.warn("[SoundProvider] Failed to persist sound state to localStorage:", err);
      }
      return next;
    });
  }, [storageKey]);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
      }
    } catch (err) {
      console.warn("[SoundProvider] Failed to persist volume:", err);
    }
  }, []);

  const setCurve = useCallback((newCurve: VolumeCurve) => {
    setCurveState(newCurve);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(CURVE_STORAGE_KEY, newCurve);
      }
    } catch (err) {
      console.warn("[SoundProvider] Failed to persist volume curve:", err);
    }
  }, []);

  const effectiveGain = useMemo(() => {
    if (!soundEnabled) return 0;
    if (curve === "linear") return volume;
    if (curve === "exponential") return Math.pow(volume, 2);
    // Logarithmic curve: perceived natural attenuation
    return volume <= 0 ? 0 : Math.log10(1 + 9 * volume);
  }, [volume, curve, soundEnabled]);

  const value = useMemo(
    () => ({
      soundEnabled,
      toggleSound,
      setSoundEnabled,
      volume,
      setVolume,
      curve,
      setCurve,
      effectiveGain,
    }),
    [soundEnabled, toggleSound, setSoundEnabled, volume, setVolume, curve, setCurve, effectiveGain]
  );

  return (
    <SoundContext.Provider value={value}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSound(): SoundContextType {
  const context = useContext(SoundContext);

  if (!context) {
    throw new Error("useSound must be used inside SoundProvider");
  }

  return context;
}

export default SoundProvider;
