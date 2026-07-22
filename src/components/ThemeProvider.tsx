"use client";

import {
  createContext,
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

export type Theme = "light" | "dark" | "cyberpunk";

export interface ThemeContextValue {
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
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  root.classList.remove("dark", "cyberpunk");

  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "cyberpunk") {
    root.classList.add("cyberpunk");
  }

  root.style.colorScheme = theme === "light" ? "light" : "dark";
}

function applyAccent(accent: AccentColor) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const hex = ACCENT_HEX_MAP[accent] || ACCENT_HEX_MAP[DEFAULT_ACCENT];
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
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return initialTheme;
    const root = document.documentElement;
    if (root.classList.contains("cyberpunk")) return "cyberpunk";
    if (root.classList.contains("dark")) return "dark";
    const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === "dark" || saved === "cyberpunk" || saved === "light")
      return saved;
    return initialTheme;
  });

  const [accent, setAccentState] = useState<AccentColor>(() => {
    if (typeof window === "undefined") return initialAccent;
    const saved = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    return parseAccentColor(saved);
  });

  const accentHex = useMemo(
    () => ACCENT_HEX_MAP[accent] || ACCENT_HEX_MAP[DEFAULT_ACCENT],
    [accent],
  );

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
      let next: Theme = "dark";
      if (prev === "light") next = "dark";
      else if (prev === "dark") next = "cyberpunk";
      else next = "light";

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
        e.key === STORAGE_KEY &&
        (e.newValue === "light" ||
          e.newValue === "dark" ||
          e.newValue === "cyberpunk")
      ) {
        setThemeState(e.newValue as Theme);
        applyTheme(e.newValue as Theme);
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
    return {
      theme: "light" as Theme,
      setTheme: () => {},
      toggleTheme: () => {},
      accent: DEFAULT_ACCENT,
      accentHex: ACCENT_HEX_MAP[DEFAULT_ACCENT],
      setAccent: () => {},
    };
  }
  return ctx;
}
