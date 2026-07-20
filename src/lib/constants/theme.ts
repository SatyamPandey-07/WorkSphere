/**
 * Theme constants for WorkSphere
 */

export type AccentColor = "blue" | "purple" | "emerald" | "amber";

export interface AccentColorConfig {
  name: AccentColor;
  label: string;
  value: string;
  hex: string;
}

export const ACCENT_COLORS: Record<AccentColor, AccentColorConfig> = {
  blue: {
    name: "blue",
    label: "Blue",
    value: "#3b82f6",
    hex: "#3b82f6",
  },
  purple: {
    name: "purple",
    label: "Purple",
    value: "#a855f7",
    hex: "#a855f7",
  },
  emerald: {
    name: "emerald",
    label: "Emerald",
    value: "#10b981",
    hex: "#10b981",
  },
  amber: {
    name: "amber",
    label: "Amber",
    value: "#f59e0b",
    hex: "#f59e0b",
  },
};

export const DEFAULT_ACCENT: AccentColor = "blue";

export const ACCENT_STORAGE_KEY = "worksphere-accent";

export const ACCENT_OPTIONS: AccentColorConfig[] = Object.values(ACCENT_COLORS);

export const ACCENT_HEX_MAP: Record<AccentColor, string> = {
  blue: ACCENT_COLORS.blue.hex,
  purple: ACCENT_COLORS.purple.hex,
  emerald: ACCENT_COLORS.emerald.hex,
  amber: ACCENT_COLORS.amber.hex,
};

/**
 * Safely parse accent color from localStorage/cookie value.
 * Falls back to DEFAULT_ACCENT for any invalid input.
 */
export function parseAccentColor(value: string | null): AccentColor {
  if (!value) return DEFAULT_ACCENT;
  if (value in ACCENT_COLORS) return value as AccentColor;
  return DEFAULT_ACCENT;
}
