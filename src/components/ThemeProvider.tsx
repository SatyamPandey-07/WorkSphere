"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "cyberpunk";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "worksphere-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  root.classList.remove("dark", "cyberpunk");

  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "cyberpunk") {
    root.classList.add("cyberpunk");
  }

  root.style.colorScheme = theme === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The blocking script in <head> has already set the class on <html>
  // before this component ever mounts, so we just read it back here
  // instead of guessing/defaulting - that's what prevents the flash.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return "light";

    const root = document.documentElement;

    if (root.classList.contains("cyberpunk")) return "cyberpunk";
    if (root.classList.contains("dark")) return "dark";

    return "light";
  });

  const setTheme = (next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  const toggleTheme = () => {
    if (theme === "light") {
      setTheme("dark");
    } else if (theme === "dark") {
      setTheme("cyberpunk");
    } else {
      setTheme("light");
    }
  };

  // Keep in sync if the theme is changed in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === STORAGE_KEY &&
        (e.newValue === "light" ||
          e.newValue === "dark" ||
          e.newValue === "cyberpunk")
      ) {
        setThemeState(e.newValue as Theme);
        applyTheme(e.newValue as Theme);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
