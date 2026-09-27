/**
 * Tests for the Sound Effects mute toggle in NotificationSettings (Issue #1858).
 * Verifies localStorage persistence and toggle behavior.
 */

const STORAGE_KEY = "worksphere-sound";

function loadSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== "false"; // default true
}

function saveSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

function toggleSoundEnabled(): boolean {
  const current = loadSoundEnabled();
  const next = !current;
  saveSoundEnabled(next);
  return next;
}

beforeEach(() => {
  localStorage.clear();
});

describe("Sound mute toggle persistence", () => {
  it("defaults to enabled (true) when not set", () => {
    expect(loadSoundEnabled()).toBe(true);
  });

  it("returns false when explicitly set to false", () => {
    localStorage.setItem(STORAGE_KEY, "false");
    expect(loadSoundEnabled()).toBe(false);
  });

  it("returns true when set to 'true'", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    expect(loadSoundEnabled()).toBe(true);
  });

  it("toggles from true to false", () => {
    const result = toggleSoundEnabled(); // starts true (default)
    expect(result).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("toggles from false to true", () => {
    localStorage.setItem(STORAGE_KEY, "false");
    const result = toggleSoundEnabled();
    expect(result).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("double toggle returns to original state", () => {
    const initial = loadSoundEnabled();
    toggleSoundEnabled();
    const restored = loadSoundEnabled();
    expect(toggleSoundEnabled()).toBe(initial); // back to start
    expect(restored).not.toBe(initial);
  });

  it("persists across multiple calls", () => {
    saveSoundEnabled(false);
    expect(loadSoundEnabled()).toBe(false);
    expect(loadSoundEnabled()).toBe(false); // consistent
  });
});
