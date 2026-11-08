/**
 * Theme constants for WorkSphere
 */

export type AccentColor =
  | "blue"
  | "purple"
  | "emerald"
  | "amber"
  | "lantern-emerald";

export interface AccentColorModes {
  light: string;
  dark: string;
}

export interface AccentColorConfig {
  name: AccentColor;
  label: string;
  value: string;
  hex: string;
  lightHex?: string;
  darkHex?: string;
  modes?: AccentColorModes;
  cssVar?: string;
}

export const ACCENT_COLORS: Record<AccentColor, AccentColorConfig> = {
  blue: {
    name: "blue",
    label: "Blue",
    value: "#3b82f6",
    hex: "#3b82f6",
    lightHex: "#2563eb",
    darkHex: "#3b82f6",
    modes: {
      light: "#2563eb",
      dark: "#3b82f6",
    },
  },
  purple: {
    name: "purple",
    label: "Purple",
    value: "#a855f7",
    hex: "#a855f7",
    lightHex: "#9333ea",
    darkHex: "#a855f7",
    modes: {
      light: "#9333ea",
      dark: "#a855f7",
    },
  },
  emerald: {
    name: "emerald",
    label: "Emerald",
    value: "#10b981",
    hex: "#10b981",
    lightHex: "#059669",
    darkHex: "#10b981",
    modes: {
      light: "#059669",
      dark: "#10b981",
    },
  },
  amber: {
    name: "amber",
    label: "Amber",
    value: "#f59e0b",
    hex: "#f59e0b",
    lightHex: "#d97706",
    darkHex: "#f59e0b",
    modes: {
      light: "#d97706",
      dark: "#f59e0b",
    },
  },
  "lantern-emerald": {
    name: "lantern-emerald",
    label: "Lantern Emerald",
    value: "#00ff88",
    hex: "#00ff88",
    lightHex: "#10b981",
    darkHex: "#00ff88",
    modes: {
      light: "#10b981",
      dark: "#00ff88",
    },
    cssVar: "--accent-lantern",
  },
};

export const DEFAULT_ACCENT: AccentColor = "blue";

export const ACCENT_STORAGE_KEY = "worksphere-accent";
export const HIGH_CONTRAST_STORAGE_KEY = "worksphere_high_contrast";

export const ACCENT_OPTIONS: AccentColorConfig[] = Object.values(ACCENT_COLORS);

export const ACCENT_HEX_MAP: Record<AccentColor, string> = {
  blue: ACCENT_COLORS.blue.hex,
  purple: ACCENT_COLORS.purple.hex,
  emerald: ACCENT_COLORS.emerald.hex,
  amber: ACCENT_COLORS.amber.hex,
  "lantern-emerald": ACCENT_COLORS["lantern-emerald"].hex,
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
