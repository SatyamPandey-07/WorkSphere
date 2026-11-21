import {
  REMINDER_OPTIONS,
  DEFAULT_REMINDER,
  REMINDER_STORAGE_KEY,
  loadReminder,
  saveReminder,
} from "@/lib/calendar/reminders";

describe("reminder persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults when nothing is stored", () => {
    expect(loadReminder()).toBe(DEFAULT_REMINDER);
  });

  it("round-trips every preset", () => {
    for (const m of REMINDER_OPTIONS) {
      saveReminder(m);
      expect(loadReminder()).toBe(m);
    }
  });

  it("falls back on invalid stored values", () => {
    localStorage.setItem(REMINDER_STORAGE_KEY, "7");
    expect(loadReminder()).toBe(DEFAULT_REMINDER);
  });
});
