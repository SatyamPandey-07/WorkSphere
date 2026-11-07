"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";

export type SoundContextType = {
  soundEnabled: boolean;
  toggleSound: () => void;
  setSoundEnabled: (enabled: boolean) => void;
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

export function SoundProvider({
  children,
  defaultEnabled = true,
  storageKey = DEFAULT_STORAGE_KEY,
}: SoundProviderProps) {
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(defaultEnabled);

  // Safe localStorage reader
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = window.localStorage.getItem(storageKey);
        if (stored !== null) {
          setSoundEnabledState(stored === "true");
        }
      }
    } catch (err) {
      // In private browsing or sandboxed iframes, localStorage may be inaccessible
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

  const value = useMemo(
    () => ({
      soundEnabled,
      toggleSound,
      setSoundEnabled,
    }),
    [soundEnabled, toggleSound, setSoundEnabled]
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
