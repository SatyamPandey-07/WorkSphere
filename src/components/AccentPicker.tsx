"use client";

import { useCallback, useRef } from "react";
import { Check } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { ACCENT_OPTIONS, type AccentColor } from "@/lib/constants/theme";

const ACCENT_NAVIGATION: AccentColor[] = ["blue", "purple", "emerald", "amber"];

export function AccentPicker() {
  const { accent, setAccent } = useTheme();
  const gridRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex: number | null = null;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          nextIndex = (currentIndex + 1) % ACCENT_NAVIGATION.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          nextIndex =
            (currentIndex - 1 + ACCENT_NAVIGATION.length) %
            ACCENT_NAVIGATION.length;
          break;
        case "Home":
          e.preventDefault();
          nextIndex = 0;
          break;
        case "End":
          e.preventDefault();
          nextIndex = ACCENT_NAVIGATION.length - 1;
          break;
      }

      if (nextIndex !== null) {
        const nextColor = ACCENT_NAVIGATION[nextIndex];
        setAccent(nextColor);
        const buttons = gridRef.current?.querySelectorAll('[role="radio"]');
        (buttons?.[nextIndex] as HTMLButtonElement)?.focus();
      }
    },
    [setAccent],
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Accent Color
      </h3>
      <div
        ref={gridRef}
        className="flex gap-3"
        role="radiogroup"
        aria-label="Select accent color"
      >
        {ACCENT_OPTIONS.map((option, index) => {
          const isSelected = accent === option.name;
          return (
            <button
              key={option.name}
              type="button"
              onClick={() => setAccent(option.name)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`
                relative flex items-center justify-center w-10 h-10 rounded-full
                transition-all duration-200 ease-out cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-offset-2
                dark:focus:ring-offset-zinc-950 focus:ring-offset-zinc-50
                hover:scale-110 active:scale-95
                ${isSelected ? "ring-2 ring-offset-2 ring-zinc-900 dark:ring-zinc-100 dark:ring-offset-zinc-950 ring-offset-zinc-50" : ""}
              `}
              style={{
                backgroundColor: option.value,
                boxShadow: isSelected
                  ? `0 0 0 3px color-mix(in srgb, ${option.value} 40%, transparent)`
                  : "0 1px 3px rgba(0, 0, 0, 0.1)",
              }}
              aria-label={`Select ${option.label} accent color`}
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
            >
              {isSelected && (
                <Check
                  className="w-5 h-5 text-white drop-shadow-md"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Selected: {ACCENT_OPTIONS.find((opt) => opt.name === accent)?.label}
      </p>
    </div>
  );
}
