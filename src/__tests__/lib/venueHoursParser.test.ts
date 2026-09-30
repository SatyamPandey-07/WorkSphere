/**
 * Tests for venue hours string parsing (e.g. "Mon-Fri 09:00-18:00").
 */

interface ParsedHours {
  days: string[];
  openTime: string;
  closeTime: string;
}

const DAY_ABBREV: Record<string, string[]> = {
  Mon: ["Mon"], Tue: ["Tue"], Wed: ["Wed"], Thu: ["Thu"], Fri: ["Fri"],
  Sat: ["Sat"], Sun: ["Sun"],
  "Mon-Fri": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "Mon-Sat": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  "Mon-Sun": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

function parseHoursString(raw: string): ParsedHours | null {
  const match = raw.match(/^([A-Za-z-]+)\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!match) return null;
  const [, dayPart, openTime, closeTime] = match;
  const days = DAY_ABBREV[dayPart] ?? [dayPart];
  return { days, openTime, closeTime };
}

function isOpenNow(hours: ParsedHours, dayAbbrev: string, timeStr: string): boolean {
  if (!hours.days.includes(dayAbbrev)) return false;
  return timeStr >= hours.openTime && timeStr < hours.closeTime;
}

describe("Venue hours string parser", () => {
  it("parses Mon-Fri hours", () => {
    const h = parseHoursString("Mon-Fri 09:00-18:00");
    expect(h).not.toBeNull();
    expect(h!.days).toHaveLength(5);
    expect(h!.openTime).toBe("09:00");
    expect(h!.closeTime).toBe("18:00");
  });

  it("parses single day", () => {
    const h = parseHoursString("Sat 10:00-16:00");
    expect(h!.days).toEqual(["Sat"]);
  });

  it("invalid format returns null", () => {
    expect(parseHoursString("open 24 hours")).toBeNull();
  });

  it("empty string returns null", () => {
    expect(parseHoursString("")).toBeNull();
  });

  it("isOpenNow: open during hours", () => {
    const h = parseHoursString("Mon-Fri 09:00-18:00")!;
    expect(isOpenNow(h, "Wed", "13:00")).toBe(true);
  });

  it("isOpenNow: before opening → closed", () => {
    const h = parseHoursString("Mon-Fri 09:00-18:00")!;
    expect(isOpenNow(h, "Mon", "08:59")).toBe(false);
  });

  it("isOpenNow: at close time → closed (exclusive)", () => {
    const h = parseHoursString("Mon-Fri 09:00-18:00")!;
    expect(isOpenNow(h, "Mon", "18:00")).toBe(false);
  });

  it("isOpenNow: wrong day → closed", () => {
    const h = parseHoursString("Mon-Fri 09:00-18:00")!;
    expect(isOpenNow(h, "Sun", "12:00")).toBe(false);
  });
});
