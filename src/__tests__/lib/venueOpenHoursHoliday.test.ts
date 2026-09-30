/**
 * Tests for venue holiday hours override management.
 */

interface HolidayHours {
  date: string;        // YYYY-MM-DD
  isClosed: boolean;
  openTime?: string;   // "HH:MM" if open with special hours
  closeTime?: string;
  note?: string;
}

interface RegularHours {
  dayOfWeek: number;   // 0-6
  openTime: string;
  closeTime: string;
}

function getHoursForDate(
  regular: RegularHours[],
  holidays: HolidayHours[],
  date: string,
  dayOfWeek: number
): { isClosed: boolean; openTime?: string; closeTime?: string } {
  const holiday = holidays.find((h) => h.date === date);
  if (holiday) {
    if (holiday.isClosed) return { isClosed: true };
    return { isClosed: false, openTime: holiday.openTime, closeTime: holiday.closeTime };
  }
  const regular_day = regular.find((r) => r.dayOfWeek === dayOfWeek);
  if (!regular_day) return { isClosed: true };
  return { isClosed: false, openTime: regular_day.openTime, closeTime: regular_day.closeTime };
}

function isHoliday(holidays: HolidayHours[], date: string): boolean {
  return holidays.some((h) => h.date === date);
}

function upcomingClosures(
  holidays: HolidayHours[],
  fromDate: string,
  limit: number
): HolidayHours[] {
  return holidays
    .filter((h) => h.isClosed && h.date >= fromDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

const REGULAR: RegularHours[] = [
  { dayOfWeek: 1, openTime: "08:00", closeTime: "20:00" },
  { dayOfWeek: 2, openTime: "08:00", closeTime: "20:00" },
];

const HOLIDAYS: HolidayHours[] = [
  { date: "2026-12-25", isClosed: true, note: "Christmas"                                      },
  { date: "2026-12-31", isClosed: false, openTime: "10:00", closeTime: "16:00", note: "NYE"    },
];

describe("Venue holiday hours", () => {
  it("getHoursForDate: regular Monday", () => {
    const hours = getHoursForDate(REGULAR, HOLIDAYS, "2026-10-05", 1);
    expect(hours.isClosed).toBe(false);
    expect(hours.openTime).toBe("08:00");
  });

  it("getHoursForDate: holiday closed", () => {
    const hours = getHoursForDate(REGULAR, HOLIDAYS, "2026-12-25", 5);
    expect(hours.isClosed).toBe(true);
  });

  it("getHoursForDate: holiday with special hours", () => {
    const hours = getHoursForDate(REGULAR, HOLIDAYS, "2026-12-31", 4);
    expect(hours.isClosed).toBe(false);
    expect(hours.openTime).toBe("10:00");
  });

  it("getHoursForDate: day not in regular schedule → closed", () => {
    const hours = getHoursForDate(REGULAR, HOLIDAYS, "2026-10-10", 6); // Saturday
    expect(hours.isClosed).toBe(true);
  });

  it("isHoliday: Christmas is a holiday", () => {
    expect(isHoliday(HOLIDAYS, "2026-12-25")).toBe(true);
  });

  it("isHoliday: regular date is not holiday", () => {
    expect(isHoliday(HOLIDAYS, "2026-10-05")).toBe(false);
  });

  it("upcomingClosures: finds Christmas", () => {
    const closures = upcomingClosures(HOLIDAYS, "2026-12-01", 5);
    expect(closures.map((h) => h.date)).toContain("2026-12-25");
  });

  it("upcomingClosures: NYE excluded (not isClosed)", () => {
    const closures = upcomingClosures(HOLIDAYS, "2026-12-01", 5);
    expect(closures.map((h) => h.date)).not.toContain("2026-12-31");
  });
});
