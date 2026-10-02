"use client";

import { useCallback, useEffect, useState } from "react";

export interface UserPreferences {
  /** Minimum WiFi quality tier (1-5) */
  minWifiQuality?: number;
  /** Preferred noise level */
  noiseLevel?: "quiet" | "moderate" | "any";
  /** Requires power outlets */
  requiresOutlets?: boolean;
  /** Requires wheelchair accessibility */
  requiresAccessibility?: boolean;
  /** Price sensitivity */
  maxPriceTier?: number; // 1-4
  /** Preferred venue categories */
  preferredCategories?: string[];
  /** Requires quiet zone */
  requiresQuietZone?: boolean;
  /** Last updated timestamp */
  lastUpdated?: number;
}

const PREFERENCES_KEY = "worksphere-ai-preferences";

function loadPreferences(): UserPreferences {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    return raw ? (JSON.parse(raw) as UserPreferences) : {};
  } catch {
    return {};
  }
}

function savePreferences(prefs: UserPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...prefs, lastUpdated: Date.now() }),
    );
  } catch {
    // quota exceeded — skip
  }
}

/**
 * Persists learned user preferences across sessions.
 * The AI can read these preferences to bias search results toward
 * venues that match the user's history (e.g., "always prefers fast WiFi").
 *
 * Call `updatePreferences()` after a successful booking or 5-star review
 * to incrementally refine the user's preference profile.
 */
export function useAIUserPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    loadPreferences(),
  );

  const updatePreferences = useCallback(
    (update: Partial<UserPreferences>) => {
      setPreferences((prev) => {
        const next = { ...prev, ...update };
        savePreferences(next);
        return next;
      });
    },
    [],
  );

  const clearPreferences = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(PREFERENCES_KEY);
    }
    setPreferences({});
  }, []);

  /**
   * Converts preferences to an AI context string for injection into prompts.
   * Example: "User prefers: quiet venues, WiFi ≥ 4/5, outlets required."
   */
  const toContextString = useCallback((): string => {
    const parts: string[] = [];

    if (preferences.noiseLevel && preferences.noiseLevel !== "any") {
      parts.push(`${preferences.noiseLevel} venues`);
    }
    if (preferences.minWifiQuality) {
      parts.push(`WiFi ≥ ${preferences.minWifiQuality}/5`);
    }
    if (preferences.requiresOutlets) {
      parts.push("power outlets required");
    }
    if (preferences.requiresAccessibility) {
      parts.push("wheelchair accessible");
    }
    if (preferences.maxPriceTier) {
      parts.push(`price tier ≤ ${"$".repeat(preferences.maxPriceTier)}`);
    }
    if (preferences.requiresQuietZone) {
      parts.push("quiet zone required");
    }
    if (preferences.preferredCategories?.length) {
      parts.push(`prefers ${preferences.preferredCategories.join("/")} venues`);
    }

    return parts.length > 0
      ? `User preferences: ${parts.join(", ")}.`
      : "";
  }, [preferences]);

  return { preferences, updatePreferences, clearPreferences, toContextString };
}
