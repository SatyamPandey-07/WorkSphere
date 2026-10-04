"use client";

import React from "react";
import { Search } from "lucide-react";
import { openCommandPalette, usePlatformModifier } from "@/hooks/usePlatformModifier";
import { KeyboardShortcutBadge } from "./KeyboardShortcutBadge";
import { ShortcutTooltip } from "./ShortcutTooltip";

export interface QuickSearchTriggerProps {
  className?: string;
  variant?: "navbar" | "compact" | "icon-only";
}

/**
 * Quick search button with visual keyboard shortcut hint (Ctrl+K / ⌘K) and accessible hover tooltip.
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
          className={`p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-white/60 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors ${className}`}
        >
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
        className={`group flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100/80 dark:bg-white/5 hover:bg-zinc-200/80 dark:hover:bg-white/10 border border-zinc-200/80 dark:border-white/10 rounded-xl transition-all shadow-sm hover:shadow ${className}`}
      >
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
