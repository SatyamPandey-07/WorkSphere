/**
 * Tests for user theme (dark/light/system) config persistence.
 */

type Theme = "light" | "dark" | "system";

const THEME_KEY = "worksphere-theme";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const t = localStorage.getItem(THEME_KEY);
  if (t === "light" || t === "dark" || t === "system") return t;
  return "system"; // default
}

function setStoredTheme(theme: Theme): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(THEME_KEY, theme);
  }
}

function resolveTheme(theme: Theme, systemPrefersDark: boolean): "light" | "dark" {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

beforeEach(() => {
  localStorage.clear();
});

describe("Theme config persistence", () => {
  it("default when no setting stored → system", () => {
    expect(getStoredTheme()).toBe("system");
  });

  it("stored dark returns dark", () => {
    localStorage.setItem(THEME_KEY, "dark");
    expect(getStoredTheme()).toBe("dark");
  });

  it("stored light returns light", () => {
    localStorage.setItem(THEME_KEY, "light");
    expect(getStoredTheme()).toBe("light");
  });

  it("invalid value falls back to system", () => {
    localStorage.setItem(THEME_KEY, "blue");
    expect(getStoredTheme()).toBe("system");
  });

  it("setStoredTheme persists dark", () => {
    setStoredTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("resolveTheme: system + dark OS → dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("resolveTheme: system + light OS → light", () => {
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("resolveTheme: explicit dark ignores OS", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("resolveTheme: explicit light ignores OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });
});
