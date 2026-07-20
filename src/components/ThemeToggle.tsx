"use client";

import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  // ThemeProvider already reads the correct value synchronously from the
  // <html> class on mount, but we still gate the icon on mount to be safe
  // against any future SSR/CSR mismatch - renders an inert placeholder
  // (not the wrong icon) for a single frame instead.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className="p-2 w-8 h-8 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl"
        aria-hidden="true"
      />
    );
  }


  return (
    <button
      onClick={toggleTheme}

      className="p-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-blue-600 hover:text-white transition-all active:scale-95"
      title={`Current theme: ${theme}. Click to change theme.`}
      aria-label={`Current theme: ${theme}. Click to change theme.`}
    >
      {theme === "light" ? (
        <Sun className="w-4 h-4" />
      ) : theme === "dark" ? (
        <Moon className="w-4 h-4" />
      ) : (
        <span className="text-sm">⚡</span>
      )}

      className="p-2 cursor-pointer bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-[var(--primary-accent)] hover:text-white transition-all active:scale-95"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
    >
      {/* Icons follow html.dark (set before paint by the theme script / cookie),
          not useState — avoids the sun→moon flash on hydration in dark mode. */}
      <Sun className="w-4 h-4 dark:hidden" />
      <Moon className="w-4 h-4 hidden dark:block" />

    </button>
  );
}
