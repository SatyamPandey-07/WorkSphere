"use client";
import React, { useEffect } from "react";
import { Sun, Moon, Zap } from "lucide-react";
import { useTheme } from "./ThemeProvider";

function startThemeTransition(
  toggleFn: () => void,
  x: number,
  y: number,
): void {
  const xPct = ((x / window.innerWidth) * 100).toFixed(2) + "%";
  const yPct = ((y / window.innerHeight) * 100).toFixed(2) + "%";
  document.documentElement.style.setProperty("--theme-reveal-x", xPct);
  document.documentElement.style.setProperty("--theme-reveal-y", yPct);

  if (!document.startViewTransition) {
    toggleFn();
    return;
  }

  document.startViewTransition(toggleFn);
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isShortcut =
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "L" || e.key === "l");

      if (isShortcut) {
        e.preventDefault();
        // Keyboard toggle: reveal from screen center
        startThemeTransition(
          toggleTheme,
          window.innerWidth / 2,
          window.innerHeight / 2,
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTheme]);

  const labelFor = (t: string) =>
    t === "light"
      ? "Switch to dark mode"
      : t === "dark"
        ? "Switch to cyberpunk mode"
        : "Switch to light mode";

  const tooltipTitle = `${labelFor(theme)} (Cmd/Ctrl + Shift + L)`;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    startThemeTransition(toggleTheme, e.clientX, e.clientY);
  };

  return (
    <button
      role="switch"
      aria-checked={theme !== "light"}
      onClick={handleClick}
      data-active-theme={theme}
      className="p-2 cursor-pointer bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-[var(--primary-accent,#2563eb)] hover:text-white transition-all active:scale-95"
      title={tooltipTitle}
      aria-label={tooltipTitle}
    >
      {theme === "light" && <Sun className="w-4 h-4" />}
      {theme === "dark" && <Moon className="w-4 h-4" />}
      {theme === "cyberpunk" && <Zap className="w-4 h-4 text-purple-400" />}
    </button>
  );
}
