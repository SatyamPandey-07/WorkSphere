"use client";
import { Sun, Moon, Zap } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  const labelFor = (t: string) =>
    t === "light"
      ? "Switch to dark mode"
      : t === "dark"
        ? "Switch to cyberpunk mode"
        : "Switch to light mode";

  return (
    <button
      role="switch"
      aria-checked={theme !== "light"}
      onClick={toggleTheme}
      data-active-theme={theme}
      className="p-2 cursor-pointer bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-[var(--primary-accent,#2563eb)] hover:text-white transition-all active:scale-95"
      title={labelFor(theme)}
      aria-label={labelFor(theme)}
    >
      {theme === "light" && <Sun className="w-4 h-4" />}
      {theme === "dark" && <Moon className="w-4 h-4" />}
      {theme === "cyberpunk" && <Zap className="w-4 h-4 text-purple-400" />}
    </button>
  );
}
