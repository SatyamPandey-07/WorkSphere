// Self-contained tests for venue opening hours parsing logic

interface OpeningHoursRange {
  open: number; // hour in 24h format (0-23)
  close: number; // hour in 24h format (0-23)
  allDay: boolean;
}

function parseOpeningHours(raw: string): OpeningHoursRange | null {
  if (raw === "24/7" || raw === "00:00-24:00") {
    return { open: 0, close: 24, allDay: true };
  }
  const match = raw.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) return null;
  const openHour = parseInt(match[1], 10);
  const closeHour = parseInt(match[3], 10);
  return { open: openHour, close: closeHour, allDay: false };
}

function isOpen(hours: OpeningHoursRange, currentHour: number): boolean {
  if (hours.allDay) return true;
  return currentHour >= hours.open && currentHour < hours.close;
}

describe("venueOpeningHours - parseOpeningHours", () => {
  it("parses standard '08:00-22:00' format correctly", () => {
    const result = parseOpeningHours("08:00-22:00");
    expect(result).not.toBeNull();
    expect(result!.open).toBe(8);
    expect(result!.close).toBe(22);
    expect(result!.allDay).toBe(false);
  });

  it("parses '09:30-17:00' format correctly", () => {
    const result = parseOpeningHours("09:30-17:00");
    expect(result).not.toBeNull();
    expect(result!.open).toBe(9);
    expect(result!.close).toBe(17);
  });

  it("returns null for invalid format", () => {
    expect(parseOpeningHours("8am-10pm")).toBeNull();
    expect(parseOpeningHours("")).toBeNull();
    expect(parseOpeningHours("open all day")).toBeNull();
  });

  it("parses 24-hour venue marker '24/7'", () => {
    const result = parseOpeningHours("24/7");
    expect(result).not.toBeNull();
    expect(result!.allDay).toBe(true);
  });

  it("parses '00:00-24:00' as all-day", () => {
    const result = parseOpeningHours("00:00-24:00");
    expect(result).not.toBeNull();
    expect(result!.allDay).toBe(true);
  });
});

describe("venueOpeningHours - isOpen", () => {
  const standardHours: OpeningHoursRange = { open: 8, close: 22, allDay: false };

  it("returns true when current hour is within range", () => {
    expect(isOpen(standardHours, 10)).toBe(true);
    expect(isOpen(standardHours, 8)).toBe(true);
    expect(isOpen(standardHours, 21)).toBe(true);
  });

  it("returns false when current hour is before open hour", () => {
    expect(isOpen(standardHours, 7)).toBe(false);
    expect(isOpen(standardHours, 0)).toBe(false);
  });

  it("returns false when current hour is at or after close hour", () => {
    expect(isOpen(standardHours, 22)).toBe(false);
    expect(isOpen(standardHours, 23)).toBe(false);
  });

  it("returns true for 24-hour venues at any hour", () => {
    const allDayHours: OpeningHoursRange = { open: 0, close: 24, allDay: true };
    for (let h = 0; h < 24; h++) {
      expect(isOpen(allDayHours, h)).toBe(true);
    }
  });

  it("is closed exactly at the closing hour boundary", () => {
    expect(isOpen(standardHours, 22)).toBe(false);
  });

  it("is open exactly at the opening hour boundary", () => {
    expect(isOpen(standardHours, 8)).toBe(true);
  });
});
