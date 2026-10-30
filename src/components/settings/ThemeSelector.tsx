"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Monitor, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";

export const CRT_PHOSPHOR_STORAGE_KEY = "worksphere_crt_phosphor_overlay";
export const HUD_CURSOR_STORAGE_KEY = "worksphere_hud_cursor";

/**
 * Reads stored CRT phosphor scanline preference from localStorage.
 */
export function getStoredCrtPhosphor(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(CRT_PHOSPHOR_STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

/**
 * Updates DOM class and attributes on document.documentElement for CRT scanline effect.
 */
export function applyCrtPhosphorDOM(enabled: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (enabled) {
    root.classList.add("crt-phosphor-overlay");
    root.setAttribute("data-crt-phosphor", "true");
  } else {
    root.classList.remove("crt-phosphor-overlay");
    root.removeAttribute("data-crt-phosphor");
  }
}

/**
 * Persists CRT phosphor scanline preference to localStorage and updates DOM.
 */
export function setStoredCrtPhosphor(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CRT_PHOSPHOR_STORAGE_KEY, String(enabled));
    applyCrtPhosphorDOM(enabled);
    window.dispatchEvent(
      new CustomEvent("worksphere_crt_phosphor_change", { detail: enabled }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Reads stored Tactical HUD Boresight Cursor preference from localStorage.
 */
export function getStoredHudCursor(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(HUD_CURSOR_STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

/**
 * Updates data-hud-cursor on document.documentElement for tactical boresight crosshair cursor.
 */
export function applyHudCursorDOM(enabled: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (enabled) {
    root.classList.add("hud-boresight-cursor");
    root.setAttribute("data-hud-cursor", "true");
  } else {
    root.classList.remove("hud-boresight-cursor");
    root.removeAttribute("data-hud-cursor");
  }
}

/**
 * Persists Tactical HUD Boresight Cursor preference to localStorage and updates DOM.
 */
export function setStoredHudCursor(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HUD_CURSOR_STORAGE_KEY, String(enabled));
    applyHudCursorDOM(enabled);
    window.dispatchEvent(
      new CustomEvent("worksphere_hud_cursor_change", { detail: enabled }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export interface ThemeSelectorProps {
  className?: string;
  onCrtChange?: (enabled: boolean) => void;
  onCursorChange?: (enabled: boolean) => void;
}

export function ThemeSelector({
  className,
  onCrtChange,
  onCursorChange,
}: ThemeSelectorProps = {}) {
  const [crtEnabled, setCrtEnabled] = useState(false);
  const [hudCursorEnabled, setHudCursorEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const initialCrt = getStoredCrtPhosphor();
    setCrtEnabled(initialCrt);
    applyCrtPhosphorDOM(initialCrt);

    const initialCursor = getStoredHudCursor();
    setHudCursorEnabled(initialCursor);
    applyHudCursorDOM(initialCursor);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === CRT_PHOSPHOR_STORAGE_KEY) {
        const val = e.newValue === "true";
        setCrtEnabled(val);
        applyCrtPhosphorDOM(val);
        onCrtChange?.(val);
      } else if (e.key === HUD_CURSOR_STORAGE_KEY) {
        const val = e.newValue === "true";
        setHudCursorEnabled(val);
        applyHudCursorDOM(val);
        onCursorChange?.(val);
      }
    };

    const handleCrtChange = (e: Event) => {
      const detail = Boolean((e as CustomEvent<boolean>).detail);
      setCrtEnabled(detail);
      onCrtChange?.(detail);
    };

    const handleCursorChange = (e: Event) => {
      const detail = Boolean((e as CustomEvent<boolean>).detail);
      setHudCursorEnabled(detail);
      onCursorChange?.(detail);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "worksphere_crt_phosphor_change",
      handleCrtChange,
    );
    window.addEventListener(
      "worksphere_hud_cursor_change",
      handleCursorChange,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "worksphere_crt_phosphor_change",
        handleCrtChange,
      );
      window.removeEventListener(
        "worksphere_hud_cursor_change",
        handleCursorChange,
      );
    };
  }, [onCrtChange, onCursorChange]);

  const handleCrtToggle = useCallback(() => {
    const nextVal = !crtEnabled;
    setCrtEnabled(nextVal);
    setStoredCrtPhosphor(nextVal);
    onCrtChange?.(nextVal);
  }, [crtEnabled, onCrtChange]);

  const handleCursorToggle = useCallback(() => {
    const nextVal = !hudCursorEnabled;
    setHudCursorEnabled(nextVal);
    setStoredHudCursor(nextVal);
    onCursorChange?.(nextVal);
  }, [hudCursorEnabled, onCursorChange]);

  if (!mounted) {
    return (
      <div
        data-testid="theme-selector-container"
        className={cn("space-y-4", className)}
      >
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Cockpit CRT Phosphor Overlay
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Subtle retro avionics scanline texture (4% opacity)
                </p>
              </div>
            </div>
            <div className="w-11 h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crosshair className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Tactical HUD Boresight Cursor
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Fighter jet optical boresight targeting reticle cursor
                </p>
              </div>
            </div>
            <div className="w-11 h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="theme-selector-container"
      className={cn("space-y-4", className)}
    >
      {/* Cockpit CRT Phosphor Overlay Toggle */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Monitor className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <label
                htmlFor="cockpit-crt-toggle"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer"
              >
                Cockpit CRT Phosphor Overlay
              </label>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                Subtle retro military avionics scanlines (4% opacity) maintaining WCAG AAA contrast ratio (&gt; 7:1).
              </p>
            </div>
          </div>

          <button
            id="cockpit-crt-toggle"
            data-testid="cockpit-crt-toggle"
            type="button"
            role="switch"
            aria-checked={crtEnabled}
            aria-label="Toggle Cockpit CRT Phosphor Overlay"
            onClick={handleCrtToggle}
            className={cn(
              "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
              crtEnabled ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                crtEnabled ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </div>

      {/* Tactical HUD Boresight Cursor Toggle (#6289) */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Crosshair className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <label
                htmlFor="tactical-hud-cursor-toggle"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer"
              >
                Tactical HUD Boresight Cursor
              </label>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                Optical boresight targeting reticle with central dot and segmented crosshair brackets.
              </p>
            </div>
          </div>

          <button
            id="tactical-hud-cursor-toggle"
            data-testid="tactical-hud-cursor-toggle"
            type="button"
            role="switch"
            aria-checked={hudCursorEnabled}
            aria-label="Toggle Tactical HUD Boresight Cursor"
            onClick={handleCursorToggle}
            className={cn(
              "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
              hudCursorEnabled ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                hudCursorEnabled ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ThemeSelector;
