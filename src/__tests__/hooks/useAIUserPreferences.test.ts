import { renderHook, act } from "@testing-library/react";
import { useAIUserPreferences } from "@/hooks/useAIUserPreferences";

const STORAGE_KEY = "worksphere-ai-preferences";

beforeEach(() => {
  localStorage.clear();
});

describe("useAIUserPreferences", () => {
  it("starts with empty preferences", () => {
    const { result } = renderHook(() => useAIUserPreferences());
    expect(result.current.preferences).toEqual({});
  });

  it("updates preferences and persists to localStorage", () => {
    const { result } = renderHook(() => useAIUserPreferences());

    act(() => {
      result.current.updatePreferences({ noiseLevel: "quiet", minWifiQuality: 4 });
    });

    expect(result.current.preferences.noiseLevel).toBe("quiet");
    expect(result.current.preferences.minWifiQuality).toBe(4);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(stored.noiseLevel).toBe("quiet");
  });

  it("merges partial updates without overwriting existing preferences", () => {
    const { result } = renderHook(() => useAIUserPreferences());

    act(() => {
      result.current.updatePreferences({ noiseLevel: "quiet" });
      result.current.updatePreferences({ requiresOutlets: true });
    });

    expect(result.current.preferences.noiseLevel).toBe("quiet");
    expect(result.current.preferences.requiresOutlets).toBe(true);
  });

  it("clearPreferences resets to empty object", () => {
    const { result } = renderHook(() => useAIUserPreferences());

    act(() => {
      result.current.updatePreferences({ noiseLevel: "moderate" });
      result.current.clearPreferences();
    });

    expect(result.current.preferences).toEqual({});
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("toContextString returns empty string when no preferences set", () => {
    const { result } = renderHook(() => useAIUserPreferences());
    expect(result.current.toContextString()).toBe("");
  });

  it("toContextString formats preferences correctly", () => {
    const { result } = renderHook(() => useAIUserPreferences());

    act(() => {
      result.current.updatePreferences({
        noiseLevel: "quiet",
        minWifiQuality: 4,
        requiresOutlets: true,
      });
    });

    const ctx = result.current.toContextString();
    expect(ctx).toContain("quiet venues");
    expect(ctx).toContain("WiFi ≥ 4/5");
    expect(ctx).toContain("power outlets required");
    expect(ctx).toMatch(/^User preferences:/);
  });

  it("loads existing preferences from localStorage on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ noiseLevel: "quiet", minWifiQuality: 3 }),
    );

    const { result } = renderHook(() => useAIUserPreferences());
    expect(result.current.preferences.noiseLevel).toBe("quiet");
    expect(result.current.preferences.minWifiQuality).toBe(3);
  });

  it("includes lastUpdated timestamp on update", () => {
    const { result } = renderHook(() => useAIUserPreferences());

    act(() => {
      result.current.updatePreferences({ requiresAccessibility: true });
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(typeof stored.lastUpdated).toBe("number");
    expect(stored.lastUpdated).toBeGreaterThan(0);
  });
});
