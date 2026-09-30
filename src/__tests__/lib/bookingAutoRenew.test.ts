/**
 * Tests for booking auto-renewal for recurring workspace memberships.
 */

interface AutoRenewSettings {
  userId: string;
  venueId: string;
  enabled: boolean;
  renewalDayOfMonth: number; // 1-28
  renewalNoticeMs: number;    // notify user before renewal
  pausedUntil: number | null;
}

function isAutoRenewActive(settings: AutoRenewSettings, nowMs: number): boolean {
  if (!settings.enabled) return false;
  if (settings.pausedUntil !== null && nowMs < settings.pausedUntil) return false;
  return true;
}

function pauseAutoRenew(
  settings: AutoRenewSettings,
  pauseUntilMs: number
): AutoRenewSettings {
  return { ...settings, pausedUntil: pauseUntilMs };
}

function resumeAutoRenew(settings: AutoRenewSettings): AutoRenewSettings {
  return { ...settings, pausedUntil: null };
}

function nextRenewalDate(settings: AutoRenewSettings, nowMs: number): string {
  const now = new Date(nowMs);
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (now.getDate() >= settings.renewalDayOfMonth) {
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(settings.renewalDayOfMonth).padStart(2, "0")}`;
}

function shouldSendRenewalNotice(
  settings: AutoRenewSettings,
  nowMs: number
): boolean {
  if (!isAutoRenewActive(settings, nowMs)) return false;
  const nextRenewal = new Date(nextRenewalDate(settings, nowMs)).getTime();
  return nextRenewal - nowMs <= settings.renewalNoticeMs;
}

const NOW = 1_700_000_000_000;
const SETTINGS: AutoRenewSettings = {
  userId: "u1", venueId: "v1", enabled: true,
  renewalDayOfMonth: 15, renewalNoticeMs: 3 * 86400_000, pausedUntil: null,
};

describe("Booking auto-renew settings", () => {
  it("isAutoRenewActive: enabled, not paused → true", () => {
    expect(isAutoRenewActive(SETTINGS, NOW)).toBe(true);
  });

  it("isAutoRenewActive: disabled → false", () => {
    expect(isAutoRenewActive({ ...SETTINGS, enabled: false }, NOW)).toBe(false);
  });

  it("isAutoRenewActive: paused (in future) → false", () => {
    const paused = pauseAutoRenew(SETTINGS, NOW + 86400_000);
    expect(isAutoRenewActive(paused, NOW)).toBe(false);
  });

  it("isAutoRenewActive: paused in past → true", () => {
    expect(isAutoRenewActive({ ...SETTINGS, pausedUntil: NOW - 1 }, NOW)).toBe(true);
  });

  it("pauseAutoRenew: sets pausedUntil", () => {
    const paused = pauseAutoRenew(SETTINGS, NOW + 1000);
    expect(paused.pausedUntil).toBe(NOW + 1000);
  });

  it("resumeAutoRenew: clears pausedUntil", () => {
    const paused = pauseAutoRenew(SETTINGS, NOW + 1000);
    expect(resumeAutoRenew(paused).pausedUntil).toBeNull();
  });

  it("resumeAutoRenew is immutable on original", () => {
    pauseAutoRenew(SETTINGS, NOW);
    expect(SETTINGS.pausedUntil).toBeNull();
  });
});
