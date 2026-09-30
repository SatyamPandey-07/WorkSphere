/**
 * Tests for geolocation permission state handling.
 */

type PermissionState = "granted" | "denied" | "prompt";

interface GeolocationPrefs {
  status: PermissionState;
  lastAskedAt: number | null;
  userDeclinedPermanently: boolean;
}

function canUseGeolocation(prefs: GeolocationPrefs): boolean {
  return prefs.status === "granted";
}

function shouldPrompt(
  prefs: GeolocationPrefs,
  nowMs: number,
  cooldownMs = 3 * 86_400_000 // 3 days
): boolean {
  if (prefs.userDeclinedPermanently) return false;
  if (prefs.status === "granted") return false;
  if (prefs.lastAskedAt === null) return true;
  return nowMs - prefs.lastAskedAt >= cooldownMs;
}

function recordPrompt(prefs: GeolocationPrefs, nowMs: number): GeolocationPrefs {
  return { ...prefs, lastAskedAt: nowMs };
}

function grantPermission(prefs: GeolocationPrefs): GeolocationPrefs {
  return { ...prefs, status: "granted" };
}

function denyPermanently(prefs: GeolocationPrefs): GeolocationPrefs {
  return { ...prefs, status: "denied", userDeclinedPermanently: true };
}

const NOW = 1_700_000_000_000;
const FRESH: GeolocationPrefs = { status: "prompt", lastAskedAt: null, userDeclinedPermanently: false };

describe("Geolocation permission state", () => {
  it("canUseGeolocation: granted → true", () => {
    expect(canUseGeolocation({ ...FRESH, status: "granted" })).toBe(true);
  });

  it("canUseGeolocation: prompt → false", () => {
    expect(canUseGeolocation(FRESH)).toBe(false);
  });

  it("shouldPrompt: never asked → true", () => {
    expect(shouldPrompt(FRESH, NOW)).toBe(true);
  });

  it("shouldPrompt: asked recently → false", () => {
    const recent = { ...FRESH, lastAskedAt: NOW - 1000 };
    expect(shouldPrompt(recent, NOW)).toBe(false);
  });

  it("shouldPrompt: asked 4 days ago → true", () => {
    const old = { ...FRESH, lastAskedAt: NOW - 4 * 86_400_000 };
    expect(shouldPrompt(old, NOW)).toBe(true);
  });

  it("shouldPrompt: permanently declined → false", () => {
    const declined = { ...FRESH, userDeclinedPermanently: true };
    expect(shouldPrompt(declined, NOW)).toBe(false);
  });

  it("shouldPrompt: granted → false", () => {
    expect(shouldPrompt({ ...FRESH, status: "granted" }, NOW)).toBe(false);
  });

  it("recordPrompt updates lastAskedAt", () => {
    const updated = recordPrompt(FRESH, NOW);
    expect(updated.lastAskedAt).toBe(NOW);
  });

  it("grantPermission sets status to granted", () => {
    expect(grantPermission(FRESH).status).toBe("granted");
  });

  it("denyPermanently sets declined flag", () => {
    const denied = denyPermanently(FRESH);
    expect(denied.userDeclinedPermanently).toBe(true);
    expect(denied.status).toBe("denied");
  });
});
