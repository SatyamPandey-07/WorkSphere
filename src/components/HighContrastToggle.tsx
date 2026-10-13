"use client";

import React, { useEffect, useState } from "react";
import { Contrast, Check } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export const HIGH_CONTRAST_STORAGE_KEY = "worksphere_high_contrast";

/**
 * Reads stored high contrast preference from localStorage key `worksphere_high_contrast`.
 * Falls back to system `(forced-colors: active)` media query if unset.
 */
export function getStoredHighContrast(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY);
    if (stored !== null) {
      return stored === "true";
    }
    if (window.matchMedia) {
      return window.matchMedia("(forced-colors: active)").matches;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Updates DOM classes and attributes on <html> to reflect high contrast mode.
 */
export function applyHighContrastDOM(enabled: boolean): void {
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

/**
 * Persists high contrast state to localStorage and updates DOM class on <html>.
 */
export function setStoredHighContrast(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, String(enabled));
    applyHighContrastDOM(enabled);
    window.dispatchEvent(
      new CustomEvent("worksphere_high_contrast_change", { detail: enabled }),
    );
  } catch {
    // Ignore storage errors
  }
}

export function HighContrastToggle() {
  const { setHighContrast } = useTheme();
  const setHighContrastRef = React.useRef(setHighContrast);
  setHighContrastRef.current = setHighContrast;

  const [highContrast, setLocalHighContrast] = useState<boolean>(() => {
    return getStoredHighContrast();
  });
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    // Read stored preference from localStorage on component mount
    const initialContrast = getStoredHighContrast();
    setLocalHighContrast(initialContrast);
    applyHighContrastDOM(initialContrast);
    setMounted(true);

    // Sync with system forced-colors: active media query as a default fallback
    let mediaQuery: MediaQueryList | null = null;
    let handleMediaChange: ((e: MediaQueryListEvent) => void) | null = null;

    if (window.matchMedia) {
      mediaQuery = window.matchMedia("(forced-colors: active)");
      handleMediaChange = (e: MediaQueryListEvent) => {
        try {
          const stored = window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY);
          // Only sync if user has not set an explicit override in localStorage
          if (stored === null) {
            setLocalHighContrast(e.matches);
            applyHighContrastDOM(e.matches);
            if (setHighContrastRef.current) {
              setHighContrastRef.current(e.matches);
            }
          }
        } catch {
          // Ignore storage errors
        }
      };

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handleMediaChange);
      } else if (
        "addListener" in mediaQuery &&
        typeof (
          mediaQuery as {
            addListener?: (fn: (e: MediaQueryListEvent) => void) => void;
          }
        ).addListener === "function"
      ) {
        (
          mediaQuery as {
            addListener: (fn: (e: MediaQueryListEvent) => void) => void;
          }
        ).addListener(handleMediaChange);
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === HIGH_CONTRAST_STORAGE_KEY) {
        const next = e.newValue === "true";
        setLocalHighContrast(next);
        applyHighContrastDOM(next);
        if (setHighContrastRef.current) {
          setHighContrastRef.current(next);
        }
      }
    };

    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      if (typeof customEvent.detail === "boolean") {
        setLocalHighContrast(customEvent.detail);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "worksphere_high_contrast_change",
      handleCustomEvent,
    );

    return () => {
      if (mediaQuery && handleMediaChange) {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener("change", handleMediaChange);
        } else if (
          "removeListener" in mediaQuery &&
          typeof (
            mediaQuery as {
              removeListener?: (fn: (e: MediaQueryListEvent) => void) => void;
            }
          ).removeListener === "function"
        ) {
          (
            mediaQuery as {
              removeListener: (fn: (e: MediaQueryListEvent) => void) => void;
            }
          ).removeListener(handleMediaChange);
        }
      }
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "worksphere_high_contrast_change",
        handleCustomEvent,
      );
    };
  }, []);

  const handleToggle = () => {
    const next = !highContrast;
    setLocalHighContrast(next);
    setStoredHighContrast(next);
    if (setHighContrast) {
      setHighContrast(next);
    }
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm transition-colors opacity-80">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            <Contrast className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              High-Contrast Mode
            </span>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Increase visual contrast across borders, text, and interactive
              elements.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
        highContrast
          ? "border-zinc-900 dark:border-white bg-zinc-50 dark:bg-zinc-900/90 shadow-sm"
          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`p-2 rounded-lg transition-colors ${
            highContrast
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
          }`}
        >
          <Contrast className="w-5 h-5" />
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              High-Contrast Mode
            </span>
            {highContrast && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                <Check className="w-3 h-3" />
                Active
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Increase visual contrast across borders, text, and interactive
            elements for improved readability.
          </p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        id="high-contrast-toggle"
        aria-checked={highContrast}
        aria-label="Toggle high-contrast mode"
        aria-keyshortcuts="Control+Shift+H Meta+Shift+H"
        title="Toggle high-contrast mode (Ctrl/Cmd + Shift + H)"
        onClick={handleToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary-accent,#3b82f6)] focus:ring-offset-2 dark:focus:ring-offset-zinc-950 ${
          highContrast
            ? "bg-zinc-900 dark:bg-white"
            : "bg-zinc-200 dark:bg-zinc-700"
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full shadow-lg ring-0 transition duration-200 ease-in-out ${
            highContrast
              ? "translate-x-5 bg-white dark:bg-zinc-900"
              : "translate-x-0 bg-white dark:bg-zinc-300"
          }`}
        />
      </button>
    </div>
  );
}
