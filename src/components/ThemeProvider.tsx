"use client";

import {
  createContext,

  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "cyberpunk";

  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AccentColor } from "@/lib/constants/theme";
import {
  ACCENT_HEX_MAP,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  parseAccentColor,
} from "@/lib/constants/theme";

type Theme = "light" | "dark";


interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
 accent: AccentColor;
  accentHex: string;
  setAccent: (accent: AccentColor) => void;

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

  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function applyAccent(accent: AccentColor) {
  const root = document.documentElement;
  const hex = ACCENT_HEX_MAP[accent];
  root.style.setProperty("--primary-accent", hex);
  root.style.setProperty("--primary-accent-rgb", hexToRgb(hex));
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "59, 130, 246";
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: Theme;
  initialAccent?: AccentColor;
}

export function ThemeProvider({
  children,
  initialTheme = "light",
  initialAccent = DEFAULT_ACCENT,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [accent, setAccentState] = useState<AccentColor>(initialAccent);

  const accentHex = useMemo(() => ACCENT_HEX_MAP[accent], [accent]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.cookie = `${STORAGE_KEY}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      document.cookie = `${STORAGE_KEY}=${next}; path=/; max-age=31536000; SameSite=Lax`;
      applyTheme(next);
      return next;
    });
  }, []);

  const setAccent = useCallback((next: AccentColor) => {
    setAccentState(next);
    window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    applyAccent(next);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === STORAGE_KEY &
        (e.newValue === "light" ||
          e.newValue === "dark" ||
          e.newValue === "cyberpunk")
      ) {
        setThemeState(e.newValue as Theme);
        applyTheme(e.newValue as Theme);

        (e.newValue === "light" || e.newValue === "dark")
      ) {
        setThemeState(e.newValue);
        document.cookie = `${STORAGE_KEY}=${e.newValue}; path=/; max-age=31536000; SameSite=Lax`;
        applyTheme(e.newValue);
      }
      if (e.key === ACCENT_STORAGE_KEY) {
        const parsedAccent = parseAccentColor(e.newValue);
        setAccentState(parsedAccent);
        applyAccent(parsedAccent);

      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);


  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme, accent, accentHex, setAccent }),
    [theme, setTheme, toggleTheme, accent, accentHex, setAccent],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>

  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
