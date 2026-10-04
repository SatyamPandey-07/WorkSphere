"use client";

import React from "react";
import { usePlatformModifier } from "@/hooks/usePlatformModifier";

export interface KeyboardShortcutBadgeProps {
  shortcut: string;
  useSymbol?: boolean;
  className?: string;
  size?: "xs" | "sm" | "md";
  variant?: "default" | "subtle" | "dark";
}

/**
 * Accessible keyboard shortcut badge that automatically adapts to the user's platform (Cmd on Mac, Ctrl on Win/Linux).
 */
export function KeyboardShortcutBadge({
  shortcut,
  useSymbol = true,
  className = "",
  size = "xs",
  variant = "default",
}: KeyboardShortcutBadgeProps) {
  const { isMac, modifierSymbol, modifierLabel } = usePlatformModifier();

  const modifier = isMac && useSymbol ? modifierSymbol : isMac ? modifierLabel : "Ctrl";

  const sizeClasses = {
    xs: "text-[10px] px-1.5 py-0.5 min-w-[18px]",
    sm: "text-xs px-2 py-0.5 min-w-[22px]",
    md: "text-xs px-2.5 py-1 min-w-[26px]",
  }[size];

  const variantClasses = {
    default:
      "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 shadow-sm",
    subtle:
      "bg-black/5 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 border-black/10 dark:border-white/10",
    dark: "bg-zinc-900 text-zinc-300 border-zinc-700 shadow-sm",
  }[variant];

  return (
    <kbd
      data-testid="keyboard-shortcut-badge"
      className={`inline-flex items-center justify-center gap-1 font-mono font-semibold rounded border select-none transition-colors ${sizeClasses} ${variantClasses} ${className}`}
      aria-label={`Shortcut: ${isMac ? "Command" : "Control"} plus ${shortcut}`}
    >
      <span>{modifier}</span>
      {(!isMac || !useSymbol) && <span className="opacity-60">+</span>}
      <span className="uppercase">{shortcut}</span>
    </kbd>
  );
}
