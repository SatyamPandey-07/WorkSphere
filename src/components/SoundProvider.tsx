"use client";

import { createContext, useContext, useEffect, useState } from "react";

type SoundContextType = {
  soundEnabled: boolean;
  toggleSound: () => void;
};

const SoundContext = createContext<SoundContextType | undefined>(undefined);

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("worksphere-sound");
    if (stored !== null) {
      setSoundEnabled(stored === "true");
    }
  }, []);

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("worksphere-sound", String(next));
      return next;
    });
  };

  return (
    <SoundContext.Provider value={{ soundEnabled, toggleSound }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSound() {
  const context = useContext(SoundContext);

  if (!context) {
    throw new Error("useSound must be used inside SoundProvider");
  }

  return context;
}
