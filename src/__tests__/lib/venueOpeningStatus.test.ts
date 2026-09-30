/**
 * Tests for "open now" status badge with timezone awareness.
 */

interface VenueHours {
  openTime: string;   // "HH:MM"
  closeTime: string;  // "HH:MM"
  timezone: string;
}

function parseHHMM(str: string): number {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

function getCurrentMinutesInTimezone(timezone: string, nowMs: number): number {
  const s = new Date(nowMs).toLocaleString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function isOpenNow(hours: VenueHours, nowMs: number): boolean {
  const current = getCurrentMinutesInTimezone(hours.timezone, nowMs);
  const open = parseHHMM(hours.openTime);
  const close = parseHHMM(hours.closeTime);
  return current >= open && current < close;
}

function openStatusLabel(hours: VenueHours, nowMs: number): "Open" | "Closed" | "Closing soon" {
  const current = getCurrentMinutesInTimezone(hours.timezone, nowMs);
  const open = parseHHMM(hours.openTime);
  const close = parseHHMM(hours.closeTime);
  if (current < open || current >= close) return "Closed";
  if (close - current <= 30) return "Closing soon";
  return "Open";
}

describe("Venue opening status", () => {
  it("parseHHMM: '09:30' → 570", () => {
    expect(parseHHMM("09:30")).toBe(570);
  });

  it("parseHHMM: '00:00' → 0", () => {
    expect(parseHHMM("00:00")).toBe(0);
  });

  it("parseHHMM: '23:59' → 1439", () => {
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("isOpenNow: 12:00 UTC for UTC venue open 09–18 → open", () => {
    const hours: VenueHours = { openTime: "09:00", closeTime: "18:00", timezone: "UTC" };
    // Create a timestamp at noon UTC
    const noonUtc = new Date("2026-10-01T12:00:00Z").getTime();
    expect(isOpenNow(hours, noonUtc)).toBe(true);
  });

  it("isOpenNow: 20:00 UTC for UTC venue open 09–18 → closed", () => {
    const hours: VenueHours = { openTime: "09:00", closeTime: "18:00", timezone: "UTC" };
    const eveningUtc = new Date("2026-10-01T20:00:00Z").getTime();
    expect(isOpenNow(hours, eveningUtc)).toBe(false);
  });

  it("openStatusLabel: well before close → 'Open'", () => {
    const hours: VenueHours = { openTime: "09:00", closeTime: "18:00", timezone: "UTC" };
    const midday = new Date("2026-10-01T12:00:00Z").getTime();
    expect(openStatusLabel(hours, midday)).toBe("Open");
  });

  it("openStatusLabel: closed → 'Closed'", () => {
    const hours: VenueHours = { openTime: "09:00", closeTime: "18:00", timezone: "UTC" };
    const evening = new Date("2026-10-01T21:00:00Z").getTime();
    expect(openStatusLabel(hours, evening)).toBe("Closed");
  });

  it("openStatusLabel: 15 min before close → 'Closing soon'", () => {
    const hours: VenueHours = { openTime: "09:00", closeTime: "18:00", timezone: "UTC" };
    const closing = new Date("2026-10-01T17:50:00Z").getTime();
    expect(openStatusLabel(hours, closing)).toBe("Closing soon");
  });
});
