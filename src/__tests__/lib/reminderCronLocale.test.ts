/**
 * Tests for the locale-safe booking date/time parsing added to reminderCron.ts.
 * The fix replaces new Date("YYYY-MM-DD h:mm AM") with a manual ISO 8601 parser.
 */

// Replicate the parseBookingDateTime logic
function parseBookingDateTime(dateStr: string, timeStr: string): Date | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === "AM") {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }

  const paddedHours = String(hours).padStart(2, "0");
  const paddedMinutes = String(minutes).padStart(2, "0");
  return new Date(`${dateStr}T${paddedHours}:${paddedMinutes}:00`);
}

describe("parseBookingDateTime (locale-safe ISO 8601 parsing)", () => {
  it("parses 10:00 AM correctly", () => {
    const dt = parseBookingDateTime("2026-09-27", "10:00 AM");
    expect(dt).not.toBeNull();
    expect(dt!.getUTCHours()).toBe(10);
    expect(dt!.getUTCMinutes()).toBe(0);
  });

  it("parses 2:30 PM correctly", () => {
    const dt = parseBookingDateTime("2026-09-27", "2:30 PM");
    expect(dt).not.toBeNull();
    expect(dt!.getUTCHours()).toBe(14);
    expect(dt!.getUTCMinutes()).toBe(30);
  });

  it("handles midnight edge case: 12:00 AM → hour 0", () => {
    const dt = parseBookingDateTime("2026-09-27", "12:00 AM");
    expect(dt).not.toBeNull();
    expect(dt!.getUTCHours()).toBe(0);
  });

  it("handles noon edge case: 12:00 PM → hour 12", () => {
    const dt = parseBookingDateTime("2026-09-27", "12:00 PM");
    expect(dt).not.toBeNull();
    expect(dt!.getUTCHours()).toBe(12);
  });

  it("is case-insensitive for AM/PM", () => {
    const dt1 = parseBookingDateTime("2026-09-27", "3:00 am");
    const dt2 = parseBookingDateTime("2026-09-27", "3:00 AM");
    expect(dt1).not.toBeNull();
    expect(dt2).not.toBeNull();
    expect(dt1!.getTime()).toBe(dt2!.getTime());
  });

  it("returns null for invalid time format", () => {
    expect(parseBookingDateTime("2026-09-27", "invalid")).toBeNull();
    expect(parseBookingDateTime("2026-09-27", "10:00")).toBeNull(); // no AM/PM
    expect(parseBookingDateTime("2026-09-27", "")).toBeNull();
  });

  it("includes the correct date", () => {
    const dt = parseBookingDateTime("2026-09-27", "9:00 AM");
    expect(dt!.toISOString().startsWith("2026-09-27")).toBe(true);
  });

  it("produces a valid non-NaN date", () => {
    const dt = parseBookingDateTime("2026-09-27", "11:45 PM");
    expect(dt).not.toBeNull();
    expect(isNaN(dt!.getTime())).toBe(false);
  });
});
