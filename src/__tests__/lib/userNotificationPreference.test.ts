/**
 * Tests for user notification channel preference management.
 */

type NotificationChannel = "email" | "push" | "sms" | "in_app";
type NotificationEvent =
  | "booking_confirmed"
  | "booking_reminder"
  | "booking_cancelled"
  | "promo_offer"
  | "system_alert";

interface NotificationPreference {
  event: NotificationEvent;
  channels: NotificationChannel[];
  enabled: boolean;
}

function isChannelEnabled(
  prefs: NotificationPreference[],
  event: NotificationEvent,
  channel: NotificationChannel
): boolean {
  const pref = prefs.find((p) => p.event === event);
  if (!pref || !pref.enabled) return false;
  return pref.channels.includes(channel);
}

function enabledChannels(
  prefs: NotificationPreference[],
  event: NotificationEvent
): NotificationChannel[] {
  const pref = prefs.find((p) => p.event === event);
  if (!pref || !pref.enabled) return [];
  return pref.channels;
}

function disableEvent(
  prefs: NotificationPreference[],
  event: NotificationEvent
): NotificationPreference[] {
  return prefs.map((p) => (p.event === event ? { ...p, enabled: false } : p));
}

const PREFS: NotificationPreference[] = [
  { event: "booking_confirmed", channels: ["email", "push"], enabled: true   },
  { event: "booking_reminder",  channels: ["push"],           enabled: true   },
  { event: "promo_offer",       channels: ["email"],           enabled: false  },
];

describe("User notification preferences", () => {
  it("isChannelEnabled: email for booking_confirmed → true", () => {
    expect(isChannelEnabled(PREFS, "booking_confirmed", "email")).toBe(true);
  });

  it("isChannelEnabled: sms for booking_confirmed → false (not in channels)", () => {
    expect(isChannelEnabled(PREFS, "booking_confirmed", "sms")).toBe(false);
  });

  it("isChannelEnabled: disabled event → false", () => {
    expect(isChannelEnabled(PREFS, "promo_offer", "email")).toBe(false);
  });

  it("isChannelEnabled: unknown event → false", () => {
    expect(isChannelEnabled(PREFS, "system_alert", "email")).toBe(false);
  });

  it("enabledChannels: booking_confirmed returns 2 channels", () => {
    expect(enabledChannels(PREFS, "booking_confirmed")).toHaveLength(2);
  });

  it("enabledChannels: disabled event → empty", () => {
    expect(enabledChannels(PREFS, "promo_offer")).toHaveLength(0);
  });

  it("disableEvent: booking_reminder disabled", () => {
    const updated = disableEvent(PREFS, "booking_reminder");
    expect(enabledChannels(updated, "booking_reminder")).toHaveLength(0);
  });

  it("disableEvent: other events unchanged", () => {
    const updated = disableEvent(PREFS, "booking_reminder");
    expect(isChannelEnabled(updated, "booking_confirmed", "email")).toBe(true);
  });

  it("disableEvent is immutable", () => {
    disableEvent(PREFS, "booking_confirmed");
    expect(PREFS[0].enabled).toBe(true);
  });
});
