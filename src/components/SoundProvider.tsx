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
  playBookmarkSound: (isFavorited: boolean) => void;
  playBookmarkChime: () => void;
  playUnbookmarkTone: () => void;
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
  const [soundEnabled, setSoundEnabledState] =
    useState<boolean>(defaultEnabled);
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
        const storedCurve = window.localStorage.getItem(
          CURVE_STORAGE_KEY,
        ) as VolumeCurve | null;
        if (
          storedCurve === "logarithmic" ||
          storedCurve === "exponential" ||
          storedCurve === "linear"
        ) {
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
        if (
          e.newValue === "logarithmic" ||
          e.newValue === "exponential" ||
          e.newValue === "linear"
        ) {
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
        console.warn(
          "[SoundProvider] Failed to persist sound state to localStorage:",
          err,
        );
      }
    },
    [storageKey],
  );

  const toggleSound = useCallback(() => {
    setSoundEnabledState((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(storageKey, String(next));
        }
      } catch (err) {
        console.warn(
          "[SoundProvider] Failed to persist sound state to localStorage:",
          err,
        );
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

  const playBookmarkSound = useCallback(
    (isFavorited: boolean) => {
      if (!soundEnabled || effectiveGain <= 0) return;
      if (isFavorited) {
        playBookmarkChime(effectiveGain);
      } else {
        playUnbookmarkTone(effectiveGain);
      }
    },
    [soundEnabled, effectiveGain],
  );

  const playBookmarkChimeCallback = useCallback(() => {
    if (!soundEnabled || effectiveGain <= 0) return;
    playBookmarkChime(effectiveGain);
  }, [soundEnabled, effectiveGain]);

  const playUnbookmarkToneCallback = useCallback(() => {
    if (!soundEnabled || effectiveGain <= 0) return;
    playUnbookmarkTone(effectiveGain);
  }, [soundEnabled, effectiveGain]);

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
      playBookmarkSound,
      playBookmarkChime: playBookmarkChimeCallback,
      playUnbookmarkTone: playUnbookmarkToneCallback,
    }),
    [
      soundEnabled,
      toggleSound,
      setSoundEnabled,
      volume,
      setVolume,
      curve,
      setCurve,
      effectiveGain,
      playBookmarkSound,
      playBookmarkChimeCallback,
      playUnbookmarkToneCallback,
    ],
  );

  return (
    <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
  );
}

/**
 * Synthesizes a pleasant micro-acoustic chime via Web Audio API
 * when a user bookmarks a venue.
 */
export function playBookmarkChime(volume: number = 0.2): boolean {
  if (typeof window === "undefined") return false;
  if (typeof volume === "number" && Number.isFinite(volume) && volume <= 0) {
    return false;
  }
  const safeVolume =
    typeof volume === "number" && Number.isFinite(volume)
      ? Math.min(1, Math.max(0.001, volume))
      : 0.2;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(830.6, now); // G#5
    osc1.frequency.exponentialRampToValueAtTime(1244.5, now + 0.12); // D#6

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1661.2, now); // overtone shimmer
    osc2.frequency.exponentialRampToValueAtTime(2489.0, now + 0.08);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(safeVolume * 0.15, now + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.32);
    osc2.stop(now + 0.32);

    const timer = setTimeout(() => {
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
    }, 450);
    if (
      typeof timer === "object" &&
      typeof (timer as any).unref === "function"
    ) {
      (timer as any).unref();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Synthesizes a softer low-frequency tone via Web Audio API
 * when a user unbookmarks / removes a venue from saved.
 */
export function playUnbookmarkTone(volume: number = 0.15): boolean {
  if (typeof window === "undefined") return false;
  if (typeof volume === "number" && Number.isFinite(volume) && volume <= 0) {
    return false;
  }
  const safeVolume =
    typeof volume === "number" && Number.isFinite(volume)
      ? Math.min(1, Math.max(0.001, volume))
      : 0.15;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(329.63, now); // E4
    osc.frequency.exponentialRampToValueAtTime(220.0, now + 0.15); // A3

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(safeVolume * 0.1, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.28);

    const timer = setTimeout(() => {
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
    }, 400);
    if (
      typeof timer === "object" &&
      typeof (timer as any).unref === "function"
    ) {
      (timer as any).unref();
    }
    return true;
  } catch {
    return false;
  }
}

export function useSound(options?: {
  suppressError?: boolean;
}): SoundContextType {
  const context = useContext(SoundContext);

  if (!context) {
    if (options?.suppressError) {
      return {
        soundEnabled: false,
        toggleSound: () => {},
        setSoundEnabled: () => {},
        volume: 0,
        setVolume: () => {},
        curve: "logarithmic",
        setCurve: () => {},
        effectiveGain: 0,
        playBookmarkSound: () => {},
        playBookmarkChime: () => {},
        playUnbookmarkTone: () => {},
      };
    }
    throw new Error("useSound must be used inside SoundProvider");
  }

  return context;
}

export default SoundProvider;
