"use client";

import React, { useEffect, useState } from "react";
import { Contrast, Check } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function HighContrastToggle() {
  const { highContrast, toggleHighContrast } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
              Increase visual contrast across borders, text, and interactive elements.
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
            Increase visual contrast across borders, text, and interactive elements for improved readability.
          </p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        id="high-contrast-toggle"
        aria-checked={highContrast}
        aria-label="Toggle high-contrast mode"
        onClick={toggleHighContrast}
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
