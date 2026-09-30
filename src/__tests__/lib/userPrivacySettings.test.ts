/**
 * Tests for user privacy settings management.
 */

interface PrivacySettings {
  profileVisible: boolean;
  activityVisible: boolean;
  locationVisible: boolean;
  reviewsVisible: boolean;
  bookingsVisible: boolean;
}

function defaultPrivacySettings(): PrivacySettings {
  return {
    profileVisible:   true,
    activityVisible:  true,
    locationVisible:  false,
    reviewsVisible:   true,
    bookingsVisible:  false,
  };
}

function updateSetting(
  settings: PrivacySettings,
  key: keyof PrivacySettings,
  value: boolean
): PrivacySettings {
  return { ...settings, [key]: value };
}

function restrictAll(settings: PrivacySettings): PrivacySettings {
  return Object.fromEntries(
    Object.keys(settings).map((k) => [k, false])
  ) as PrivacySettings;
}

function enableAll(settings: PrivacySettings): PrivacySettings {
  return Object.fromEntries(
    Object.keys(settings).map((k) => [k, true])
  ) as PrivacySettings;
}

function visibleFieldCount(settings: PrivacySettings): number {
  return Object.values(settings).filter(Boolean).length;
}

describe("User privacy settings", () => {
  const DEFAULT = defaultPrivacySettings();

  it("default: profileVisible = true", () => {
    expect(DEFAULT.profileVisible).toBe(true);
  });

  it("default: locationVisible = false", () => {
    expect(DEFAULT.locationVisible).toBe(false);
  });

  it("updateSetting: toggle locationVisible", () => {
    const updated = updateSetting(DEFAULT, "locationVisible", true);
    expect(updated.locationVisible).toBe(true);
  });

  it("updateSetting is immutable", () => {
    updateSetting(DEFAULT, "profileVisible", false);
    expect(DEFAULT.profileVisible).toBe(true);
  });

  it("restrictAll: all fields false", () => {
    const restricted = restrictAll(DEFAULT);
    expect(Object.values(restricted).every((v) => !v)).toBe(true);
  });

  it("enableAll: all fields true", () => {
    const enabled = enableAll(DEFAULT);
    expect(Object.values(enabled).every((v) => v)).toBe(true);
  });

  it("visibleFieldCount: default has 3 visible", () => {
    expect(visibleFieldCount(DEFAULT)).toBe(3);
  });

  it("visibleFieldCount: restrictAll → 0", () => {
    expect(visibleFieldCount(restrictAll(DEFAULT))).toBe(0);
  });

  it("visibleFieldCount: enableAll → 5", () => {
    expect(visibleFieldCount(enableAll(DEFAULT))).toBe(5);
  });
});
