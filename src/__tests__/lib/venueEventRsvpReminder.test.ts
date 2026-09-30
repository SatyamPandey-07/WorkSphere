/**
 * Tests for RSVP reminder notification scheduling.
 */

interface EventReminder {
  eventId: string;
  userId: string;
  eventStartMs: number;
  reminderSentAt: number | null;
  reminderWindowMs: number; // send reminder this many ms before event
}

function shouldSendReminder(
  reminder: EventReminder,
  nowMs: number
): boolean {
  if (reminder.reminderSentAt !== null) return false; // already sent
  const sendWindowStart = reminder.eventStartMs - reminder.reminderWindowMs;
  return nowMs >= sendWindowStart && nowMs < reminder.eventStartMs;
}

function markReminderSent(
  reminder: EventReminder,
  nowMs: number
): EventReminder {
  return { ...reminder, reminderSentAt: nowMs };
}

function reminderLeadTimeMinutes(reminder: EventReminder): number {
  return Math.round(reminder.reminderWindowMs / 60_000);
}

function overdueReminders(
  reminders: EventReminder[],
  nowMs: number
): EventReminder[] {
  return reminders.filter(
    (r) => r.reminderSentAt === null && nowMs >= r.eventStartMs
  );
}

const NOW = 1_700_000_000_000;
const REMINDER: EventReminder = {
  eventId: "e1", userId: "u1",
  eventStartMs: NOW + 3_600_000,   // 1 hour from now
  reminderSentAt: null,
  reminderWindowMs: 7_200_000,      // 2-hour window
};

describe("Event RSVP reminders", () => {
  it("shouldSendReminder: within window and not sent → true", () => {
    expect(shouldSendReminder(REMINDER, NOW)).toBe(true);
  });

  it("shouldSendReminder: already sent → false", () => {
    const sent = { ...REMINDER, reminderSentAt: NOW - 1000 };
    expect(shouldSendReminder(sent, NOW)).toBe(false);
  });

  it("shouldSendReminder: before window → false", () => {
    const early = { ...REMINDER, reminderWindowMs: 1_800_000 }; // 30min window only
    expect(shouldSendReminder(early, NOW)).toBe(false);
  });

  it("shouldSendReminder: after event start → false", () => {
    expect(shouldSendReminder(REMINDER, NOW + 5_000_000)).toBe(false);
  });

  it("markReminderSent sets reminderSentAt", () => {
    const marked = markReminderSent(REMINDER, NOW);
    expect(marked.reminderSentAt).toBe(NOW);
  });

  it("markReminderSent is immutable", () => {
    markReminderSent(REMINDER, NOW);
    expect(REMINDER.reminderSentAt).toBeNull();
  });

  it("reminderLeadTimeMinutes: 2h window = 120 min", () => {
    expect(reminderLeadTimeMinutes(REMINDER)).toBe(120);
  });

  it("overdueReminders: past event with no reminder", () => {
    const overdue: EventReminder = { ...REMINDER, eventStartMs: NOW - 1000 };
    expect(overdueReminders([overdue], NOW)).toHaveLength(1);
  });

  it("overdueReminders: reminder already sent → not overdue", () => {
    const sent: EventReminder = { ...REMINDER, eventStartMs: NOW - 1000, reminderSentAt: NOW - 2000 };
    expect(overdueReminders([sent], NOW)).toHaveLength(0);
  });
});
