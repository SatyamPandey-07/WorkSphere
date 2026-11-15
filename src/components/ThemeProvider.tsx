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
  HIGH_CONTRAST_STORAGE_KEY,
  parseAccentColor,
} from "@/lib/constants/theme";

export type Theme = "light" | "dark" | "cyberpunk" | "system";
export type ResolvedTheme = "light" | "dark" | "cyberpunk";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  accent: AccentColor;
  accentHex: string;
  setAccent: (accent: AccentColor) => void;
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
  toggleHighContrast: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "worksphere-theme";
const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

/**
 * Runs a DOM change with CSS transitions disabled via a temporary
 * `preload` class on <html>, so theme variables swap instantly instead
 * of animating through intermediate (white or half styled) frames.
 */
function withoutTransitions(change: () => void) {
  const root = document.documentElement;
  root.classList.add("preload");
  change();
  // Force a reflow so the new styles apply while transitions are off.
  void window.getComputedStyle(root).opacity;
  const release = () => root.classList.remove("preload");
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.requestAnimationFrame(release));
  } else {
    window.setTimeout(release, 50);
  }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(theme);

  withoutTransitions(() => {
    root.setAttribute("data-theme", resolved);
    root.classList.remove("dark", "cyberpunk");

    if (resolved === "dark") {
      root.classList.add("dark");
    } else if (resolved === "cyberpunk") {
      root.classList.add("cyberpunk");
    }

    const bg =
      resolved === "dark"
        ? "#0a0a0a"
        : resolved === "cyberpunk"
          ? "#090014"
          : "#ffffff";
    const fg =
      resolved === "dark"
        ? "#ededed"
        : resolved === "cyberpunk"
          ? "#f4f4ff"
          : "#171717";

    root.style.colorScheme = resolved === "light" ? "light" : "dark";
    root.style.backgroundColor = bg;
    root.style.color = fg;
    root.style.setProperty("--background", bg);
    root.style.setProperty("--foreground", fg);
  });
}

function applyHighContrast(enabled: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (enabled) {
    root.classList.add("high-contrast");
    root.setAttribute("data-high-contrast", "true");
  } else {
    root.classList.remove("high-contrast");
    root.removeAttribute("data-high-contrast");
  }
}

function applyAccent(accent: AccentColor) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const hex = ACCENT_HEX_MAP[accent] || ACCENT_HEX_MAP[DEFAULT_ACCENT];
  root.style.setProperty("--primary-accent", hex);
  root.style.setProperty("--primary-accent-rgb", hexToRgb(hex));
  if (accent === "lantern-emerald") {
    root.style.setProperty("--accent-lantern", hex);
  } else {
    root.style.removeProperty("--accent-lantern");
  }
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
  initialHighContrast?: boolean;
}

export function ThemeProvider({
  children,
  initialTheme = "light",
  initialAccent = DEFAULT_ACCENT,
  initialHighContrast = false,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return initialTheme;
    const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (
      saved === "dark" ||
      saved === "cyberpunk" ||
      saved === "light" ||
      saved === "system"
    ) {
      return saved;
    }
    const root = document.documentElement;
    // Keep hydration aligned with the theme already applied before first paint.
    const rootTheme = root.getAttribute("data-theme");
    if (
      rootTheme === "dark" ||
      rootTheme === "cyberpunk" ||
      rootTheme === "light"
    ) {
      return rootTheme;
    }
    if (root.classList.contains("cyberpunk")) return "cyberpunk";
    if (root.classList.contains("dark")) return "dark";
    return initialTheme;
  });

  const [accent, setAccentState] = useState<AccentColor>(() => {
    if (typeof window === "undefined") return initialAccent;
    const saved = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if (saved !== null) return parseAccentColor(saved);
    return initialAccent;
  });

  const [highContrast, setHighContrastState] = useState<boolean>(() => {
    if (typeof document === "undefined") return initialHighContrast;
    const root = document.documentElement;
    if (
      root.classList.contains("high-contrast") ||
      root.getAttribute("data-high-contrast") === "true"
    )
      return true;
    const saved =
      window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) ??
      window.localStorage.getItem("worksphere-high-contrast");
    if (saved !== null) return saved === "true";
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(forced-colors: active)").matches;
    }
    return initialHighContrast;
  });

  const accentHex = useMemo(
    () => ACCENT_HEX_MAP[accent] || ACCENT_HEX_MAP[DEFAULT_ACCENT],
    [accent],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (
      theme !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const handleChange = () => {
      applyTheme("system");
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }

    if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      return () => {
        mediaQuery.removeListener(handleChange);
      };
    }
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    applyHighContrast(highContrast);
  }, [highContrast]);

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
    document.cookie = `${ACCENT_STORAGE_KEY}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    applyAccent(next);
  }, []);

  const setHighContrast = useCallback((next: boolean) => {
    setHighContrastState(next);
    window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, String(next));
    document.cookie = `${HIGH_CONTRAST_STORAGE_KEY}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    applyHighContrast(next);
    window.dispatchEvent(
      new CustomEvent("worksphere_high_contrast_change", { detail: next }),
    );
  }, []);

  const toggleHighContrast = useCallback(() => {
    setHighContrastState((prev) => {
      const next = !prev;
      window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, String(next));
      document.cookie = `${HIGH_CONTRAST_STORAGE_KEY}=${next}; path=/; max-age=31536000; SameSite=Lax`;
      applyHighContrast(next);
      window.dispatchEvent(
        new CustomEvent("worksphere_high_contrast_change", { detail: next }),
      );
      return next;
    });
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === STORAGE_KEY &&
        (e.newValue === "light" ||
          e.newValue === "dark" ||
          e.newValue === "cyberpunk" ||
          e.newValue === "system")
      ) {
        setThemeState(e.newValue as Theme);
        applyTheme(e.newValue as Theme);
      }
      if (e.key === ACCENT_STORAGE_KEY) {
        const parsedAccent = parseAccentColor(e.newValue);
        setAccentState(parsedAccent);
        applyAccent(parsedAccent);
      }
      if (e.key === HIGH_CONTRAST_STORAGE_KEY && e.newValue !== null) {
        const enabled = e.newValue === "true";
        setHighContrastState(enabled);
        applyHighContrast(enabled);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(
