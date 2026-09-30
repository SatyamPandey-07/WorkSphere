/**
 * Tests for smart booking reminder scheduling with AI personalization.
 */

interface UserBehaviorProfile {
  userId: string;
  avgResponseTimeHours: number;
  hasCalendarIntegration: boolean;
  preferredReminderHours: number[];  // hours before event to send reminder
  missedRemindersCount: number;
  responsiveHours: number[];         // hours of day user is most responsive
}

function shouldSendPreBookingReminder(
  profile: UserBehaviorProfile,
  hoursBeforeBooking: number
): boolean {
  return profile.preferredReminderHours.includes(hoursBeforeBooking) ||
         (hoursBeforeBooking === 24 && profile.missedRemindersCount > 2);
}

function optimalReminderTime(
  profile: UserBehaviorProfile,
  bookingStartMs: number
): number {
  // Pick reminder time based on user's responsive hours + lead time
  const remindersAtHours = profile.preferredReminderHours.length > 0
    ? profile.preferredReminderHours
    : [24]; // default 24h before

  const earliestReminder = Math.min(...remindersAtHours);
  const reminderMs = bookingStartMs - earliestReminder * 3_600_000;

  // Adjust to closest responsive hour
  const reminderHour = new Date(reminderMs).getUTCHours();
  const closestResponsiveHour = profile.responsiveHours.reduce((closest, h) =>
    Math.abs(h - reminderHour) < Math.abs(closest - reminderHour) ? h : closest,
    profile.responsiveHours[0] ?? reminderHour
  );

  const adj = (closestResponsiveHour - reminderHour) * 3_600_000;
  return reminderMs + adj;
}

function reminderEscalation(
  profile: UserBehaviorProfile,
  missedCount: number
): "none" | "gentle" | "persistent" | "call" {
  if (missedCount === 0) return "none";
  if (profile.avgResponseTimeHours < 2 && missedCount === 1) return "gentle";
  if (missedCount >= 3) return "call";
  return "persistent";
}

const NOW = 1_700_000_000_000;
const PROFILE: UserBehaviorProfile = {
  userId: "u1", avgResponseTimeHours: 1.5,
  hasCalendarIntegration: true,
  preferredReminderHours: [24, 2],
  missedRemindersCount: 1,
  responsiveHours: [9, 12, 18],
};

describe("Smart booking reminder scheduling", () => {
  it("shouldSendPreBookingReminder: 24h = in preferred → true", () => {
    expect(shouldSendPreBookingReminder(PROFILE, 24)).toBe(true);
  });

  it("shouldSendPreBookingReminder: 2h = in preferred → true", () => {
    expect(shouldSendPreBookingReminder(PROFILE, 2)).toBe(true);
  });

  it("shouldSendPreBookingReminder: 6h not in preferred → false", () => {
    expect(shouldSendPreBookingReminder(PROFILE, 6)).toBe(false);
  });

  it("shouldSendPreBookingReminder: 24h with many misses → true (override)", () => {
    const highMiss = { ...PROFILE, missedRemindersCount: 3, preferredReminderHours: [2] };
    expect(shouldSendPreBookingReminder(highMiss, 24)).toBe(true);
  });

  it("optimalReminderTime: before booking start", () => {
    const bookingStart = NOW + 25 * 3600_000;
    const reminder = optimalReminderTime(PROFILE, bookingStart);
    expect(reminder).toBeLessThan(bookingStart);
  });

  it("reminderEscalation: no misses → none", () => {
    expect(reminderEscalation(PROFILE, 0)).toBe("none");
  });

  it("reminderEscalation: 3+ misses → call", () => {
    expect(reminderEscalation(PROFILE, 3)).toBe("call");
  });

  it("reminderEscalation: fast responder + 1 miss → gentle", () => {
    expect(reminderEscalation(PROFILE, 1)).toBe("gentle");
  });
});
