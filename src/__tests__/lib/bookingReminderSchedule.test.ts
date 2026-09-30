/**
 * Tests for booking reminder notification scheduling.
 */

type ReminderType = "24h_before" | "1h_before" | "30min_before" | "post_visit";

interface BookingReminder {
  bookingId: string;
  userId: string;
  type: ReminderType;
  scheduledFor: number;
  sentAt: number | null;
  channel: "push" | "email" | "sms";
}

const REMINDER_OFFSETS: Record<ReminderType, number> = {
  "24h_before":   24 * 3600_000,
  "1h_before":    1 * 3600_000,
  "30min_before": 30 * 60_000,
  "post_visit":   -(2 * 3600_000), // 2h after start
};

function scheduleReminders(
  bookingId: string,
  userId: string,
  bookingStartMs: number,
  channels: Record<ReminderType, "push" | "email" | "sms">
): BookingReminder[] {
  return (Object.entries(REMINDER_OFFSETS) as [ReminderType, number][]).map(
    ([type, offset]) => ({
      bookingId,
      userId,
      type,
      scheduledFor: bookingStartMs - offset,
      sentAt: null,
      channel: channels[type],
    })
  );
}

function dueReminders(reminders: BookingReminder[], nowMs: number): BookingReminder[] {
  return reminders.filter((r) => r.sentAt === null && nowMs >= r.scheduledFor);
}

function markSent(reminder: BookingReminder, nowMs: number): BookingReminder {
  return { ...reminder, sentAt: nowMs };
}

function sentCount(reminders: BookingReminder[], bookingId: string): number {
  return reminders.filter((r) => r.bookingId === bookingId && r.sentAt !== null).length;
}

const NOW = 1_700_000_000_000;
const START_MS = NOW + 2 * 3600_000; // 2h from now

const CHANNELS: Record<ReminderType, "push" | "email" | "sms"> = {
  "24h_before": "email", "1h_before": "push", "30min_before": "push", "post_visit": "email",
};

describe("Booking reminder scheduling", () => {
  const REMINDERS = scheduleReminders("b1", "u1", START_MS, CHANNELS);

  it("scheduleReminders: creates 4 reminders", () => {
    expect(REMINDERS).toHaveLength(4);
  });

  it("scheduleReminders: 1h_before scheduled at start - 1h", () => {
    const r = REMINDERS.find((r) => r.type === "1h_before")!;
    expect(r.scheduledFor).toBe(START_MS - 3600_000);
  });

  it("dueReminders: 1h_before not yet due (1h from now)", () => {
    expect(dueReminders(REMINDERS, NOW)).toHaveLength(0);
  });

  it("dueReminders: 1h_before due when 1h passes", () => {
    const due = dueReminders(REMINDERS, NOW + 1 * 3600_000);
    expect(due.map((r) => r.type)).toContain("1h_before");
  });

  it("markSent: sets sentAt", () => {
    const reminder = REMINDERS[0];
    const sent = markSent(reminder, NOW);
    expect(sent.sentAt).toBe(NOW);
  });

  it("sentCount: 0 before any are sent", () => {
    expect(sentCount(REMINDERS, "b1")).toBe(0);
  });

  it("sentCount: increments after sending", () => {
    const updated = REMINDERS.map((r, i) => i === 0 ? markSent(r, NOW) : r);
    expect(sentCount(updated, "b1")).toBe(1);
  });
});
