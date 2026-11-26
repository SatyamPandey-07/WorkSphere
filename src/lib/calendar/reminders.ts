export const REMINDER_OPTIONS = [10, 15, 30, 60, 1440] as const;
export type ReminderMinutes = (typeof REMINDER_OPTIONS)[number];
export const DEFAULT_REMINDER: ReminderMinutes = 30;
export const REMINDER_STORAGE_KEY = "worksphere:calendar-reminder-minutes";

export function formatReminderLabel(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} day before`;
  if (m % 60 === 0) return `${m / 60} hour before`;
  return `${m} minutes before`;
}

export function loadReminder(): ReminderMinutes {
  try {
    const raw = Number(localStorage.getItem(REMINDER_STORAGE_KEY));
    return (REMINDER_OPTIONS as readonly number[]).includes(raw)
      ? (raw as ReminderMinutes)
      : DEFAULT_REMINDER;
  } catch {
    return DEFAULT_REMINDER;
  }
}

export function saveReminder(m: ReminderMinutes) {
  try { localStorage.setItem(REMINDER_STORAGE_KEY, String(m)); } catch {}
}
