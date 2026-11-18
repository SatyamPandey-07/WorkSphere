"use client";

import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { openCommandPalette, usePlatformModifier } from "@/hooks/usePlatformModifier";
import { KeyboardShortcutBadge } from "./KeyboardShortcutBadge";
import { ShortcutTooltip } from "./ShortcutTooltip";

export interface CockpitTargetingReticlesProps {
  className?: string;
  reducedMotion?: boolean;
}

/**
 * Hook to detect prefers-reduced-motion media query.
 */
export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    } else if ("addListener" in mediaQuery) {
      (mediaQuery as any).addListener(listener);
      return () => (mediaQuery as any).removeListener(listener);
    }
  }, []);

  return reducedMotion;
}

/**
 * Cockpit targeting reticles that frame modal dialogs with glowing emerald corner brackets
 * and lock-on crosshair pips, animating inward with spring timing on modal mount.
 * Automatically disables transform animations when prefers-reduced-motion is active.
 */
export function CockpitTargetingReticles({
  className = "",
  reducedMotion: propReducedMotion,
}: CockpitTargetingReticlesProps) {
  const systemReducedMotion = usePrefersReducedMotion();
  const reducedMotion = propReducedMotion ?? systemReducedMotion;

  return (
    <div
      data-testid="cockpit-targeting-reticles"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      className={`pointer-events-none absolute inset-0 z-20 ${className}`}
      aria-hidden="true"
    >
      {/* Top Left Bracket */}
      <svg
        data-testid="corner-reticle-tl"
        className={`absolute -top-2.5 -left-2.5 w-5 h-5 text-emerald-400 pointer-events-none filter drop-shadow-[0_0_8px_rgba(52,211,153,0.75)] ${
          reducedMotion ? "transform-none" : "animate-reticle-snap-tl"
        }`}
        style={reducedMotion ? { transform: "none", animation: "none" } : undefined}
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 18 V 2 H 18"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="2" cy="2" r="1.5" fill="currentColor" />
        <line x1="2" y1="2" x2="6" y2="6" stroke="currentColor" strokeWidth="1.5" />
      </svg>

      {/* Top Right Bracket */}
      <svg
        data-testid="corner-reticle-tr"
        className={`absolute -top-2.5 -right-2.5 w-5 h-5 text-emerald-400 pointer-events-none filter drop-shadow-[0_0_8px_rgba(52,211,153,0.75)] ${
          reducedMotion ? "transform-none" : "animate-reticle-snap-tr"
        }`}
        style={reducedMotion ? { transform: "none", animation: "none" } : undefined}
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 2 H 18 V 18"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="18" cy="2" r="1.5" fill="currentColor" />
        <line x1="18" y1="2" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" />
      </svg>

      {/* Bottom Left Bracket */}
      <svg
        data-testid="corner-reticle-bl"
        className={`absolute -bottom-2.5 -left-2.5 w-5 h-5 text-emerald-400 pointer-events-none filter drop-shadow-[0_0_8px_rgba(52,211,153,0.75)] ${
          reducedMotion ? "transform-none" : "animate-reticle-snap-bl"
        }`}
        style={reducedMotion ? { transform: "none", animation: "none" } : undefined}
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 2 V 18 H 18"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="2" cy="18" r="1.5" fill="currentColor" />
        <line x1="2" y1="18" x2="6" y2="14" stroke="currentColor" strokeWidth="1.5" />
      </svg>

      {/* Bottom Right Bracket */}
      <svg
        data-testid="corner-reticle-br"
        className={`absolute -bottom-2.5 -right-2.5 w-5 h-5 text-emerald-400 pointer-events-none filter drop-shadow-[0_0_8px_rgba(52,211,153,0.75)] ${
          reducedMotion ? "transform-none" : "animate-reticle-snap-br"
        }`}
        style={reducedMotion ? { transform: "none", animation: "none" } : undefined}
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M18 2 V 18 H 2"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="18" cy="18" r="1.5" fill="currentColor" />
        <line x1="18" y1="18" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export interface QuickSearchTriggerProps {
  className?: string;
  variant?: "navbar" | "compact" | "icon-only";
}

/**
 * Quick search button with visual keyboard shortcut hint (Ctrl+K / ⌘K),
 * subtle cockpit targeting corner reticles, and accessible hover tooltip.
 */
export function QuickSearchTrigger({
  className = "",
  variant = "navbar",
}: QuickSearchTriggerProps) {
  const { formatShortcut, getAriaKeyshortcuts } = usePlatformModifier();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    openCommandPalette();
  };

  const fullLabel = `Quick search (${formatShortcut("K")})`;

  if (variant === "icon-only") {
    return (
      <ShortcutTooltip content="Quick search" shortcut="K" position="bottom">
        <button
          type="button"
          onClick={handleClick}
          aria-label={fullLabel}
          aria-keyshortcuts={getAriaKeyshortcuts("K")}
          data-testid="quick-search-trigger-icon"
          className={`group relative p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-white/60 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors ${className}`}
        >
          {/* Subtle cockpit targeting reticles in trigger corners */}
          <span
            data-testid="quick-search-reticles-icon"
            className="pointer-events-none absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            aria-hidden="true"
          >
            <span className="absolute top-1 left-1 w-1.5 h-1.5 border-t border-l border-emerald-400/80" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 border-t border-r border-emerald-400/80" />
            <span className="absolute bottom-1 left-1 w-1.5 h-1.5 border-b border-l border-emerald-400/80" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 border-b border-r border-emerald-400/80" />
          </span>
          <Search className="w-5 h-5" />
        </button>
      </ShortcutTooltip>
    );
  }

  return (
    <ShortcutTooltip content="Search venues, bookings, settings" shortcut="K" position="bottom">
      <button
        type="button"
        onClick={handleClick}
        aria-label={fullLabel}
        aria-keyshortcuts={getAriaKeyshortcuts("K")}
        data-testid="quick-search-trigger"
        className={`group relative flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100/80 dark:bg-white/5 hover:bg-zinc-200/80 dark:hover:bg-white/10 border border-zinc-200/80 dark:border-white/10 rounded-xl transition-all shadow-sm hover:shadow ${className}`}
      >
        {/* Subtle cockpit targeting reticles in trigger corners */}
        <span
          data-testid="quick-search-reticles"
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          aria-hidden="true"
        >
          <span className="absolute top-1 left-1 w-1.5 h-1.5 border-t border-l border-emerald-400/80" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 border-t border-r border-emerald-400/80" />
          <span className="absolute bottom-1 left-1 w-1.5 h-1.5 border-b border-l border-emerald-400/80" />
          <span className="absolute bottom-1 right-1 w-1.5 h-1.5 border-b border-r border-emerald-400/80" />
        </span>
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
          <span className="hidden sm:inline font-medium">Quick search...</span>
          <span className="sm:hidden font-medium">Search...</span>
        </div>
        <KeyboardShortcutBadge
          shortcut="K"
          size="xs"
          variant="subtle"
          className="group-hover:border-zinc-300 dark:group-hover:border-zinc-600 transition-colors"
        />
      </button>
    </ShortcutTooltip>
  );
}

