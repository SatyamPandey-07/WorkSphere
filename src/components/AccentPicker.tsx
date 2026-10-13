"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { ACCENT_OPTIONS, type AccentColor } from "@/lib/constants/theme";

const ACCENT_NAVIGATION: AccentColor[] = ACCENT_OPTIONS.map((opt) => opt.name);

export function AccentPicker() {
  const { accent, setAccent } = useTheme();
  const gridRef = useRef<HTMLDivElement>(null);
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [focusedColor, setFocusedColor] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (event: MediaQueryListEvent) => {
        setPrefersReducedMotion(event.matches);
      };
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", listener);
        return () => mediaQuery.removeEventListener("change", listener);
      } else if ("addListener" in mediaQuery) {
        (mediaQuery as any).addListener(listener);
        return () => (mediaQuery as any).removeListener(listener);
      }
    }
  }, []);

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
          const isEmerald =
            option.name === "emerald" || option.name === "lantern-emerald";
          const isHoveredOrFocused =
            isEmerald &&
            (hoveredColor === option.name || focusedColor === option.name);

          return (
            <button
              key={option.name}
              type="button"
              onClick={() => setAccent(option.name)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onMouseEnter={() => setHoveredColor(option.name)}
              onMouseLeave={() => setHoveredColor(null)}
              onFocus={() => setFocusedColor(option.name)}
              onBlur={() => setFocusedColor(null)}
              data-emerald-swatch={isEmerald ? "true" : undefined}
              data-testid={isEmerald ? `accent-swatch-${option.name}` : undefined}
              className={`
                group relative flex items-center justify-center w-10 h-10 rounded-full
                cursor-pointer focus:outline-none focus:ring-offset-2
                dark:focus:ring-offset-zinc-950 focus:ring-offset-zinc-50
                ${
                  prefersReducedMotion
                    ? "transition-none transform-none motion-reduce:transform-none motion-reduce:transition-none"
                    : "transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-110 active:scale-95"
                }
                ${
                  isEmerald
                    ? `hover:ring-4 hover:ring-emerald-400/50 focus-visible:ring-4 focus-visible:ring-emerald-400/50 ${
                        isHoveredOrFocused && !isSelected
                          ? `ring-4 ring-emerald-400/50 ${prefersReducedMotion ? "" : "scale-110"}`
                          : ""
                      }`
                    : "focus:ring-2"
                }
                ${
                  isSelected
                    ? "ring-2 ring-offset-2 ring-zinc-900 dark:ring-zinc-100 dark:ring-offset-zinc-950 ring-offset-zinc-50"
                    : ""
                }
              `}
              style={{
                backgroundColor: option.value,
                boxShadow: isSelected
                  ? `0 0 0 3px color-mix(in srgb, ${option.value} 40%, transparent)`
                  : isEmerald && isHoveredOrFocused
                  ? "0 0 14px 2px rgba(52, 211, 153, 0.45)"
                  : "0 1px 3px rgba(0, 0, 0, 0.1)",
              }}
              aria-label={`Select ${option.label} accent color`}
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
            >
              {/* Dual radiant glowing power ring pulse effect on emerald swatches */}
              {isEmerald && (
                <span
                  data-testid="emerald-pulse-ring"
                  className={`
                    pointer-events-none absolute -inset-1 rounded-full
                    border border-emerald-400/60
                    transition-opacity duration-300
                    ${
                      isSelected
                        ? "opacity-0"
                        : isHoveredOrFocused
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                    }
                    ${prefersReducedMotion ? "" : "animate-pulse"}
                  `}
                  style={{
                    boxShadow:
                      "0 0 12px 2px rgba(52, 211, 153, 0.5), inset 0 0 6px rgba(16, 185, 129, 0.35)",
                  }}
                  aria-hidden="true"
                />
              )}
              {isSelected && (
                <Check
                  className="w-5 h-5 text-white drop-shadow-md z-10"
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
