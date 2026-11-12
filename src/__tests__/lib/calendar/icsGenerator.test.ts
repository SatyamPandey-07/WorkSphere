import {
  buildBookingCalendarEvent,
  buildGoogleCalendarLink,
  buildOutlookWebLink,
  formatIcsUtc,
  generateBookingIcs,
  type BookingCalendarInput,
} from "@/lib/calendar/icsGenerator";

const base: BookingCalendarInput = {
  id: "ckbooking123",
  confirmationId: "WS-ABC123",
  date: "2026-07-20",
  time: "09:00",
  timeZone: "Asia/Karachi",
  duration: 90,
  status: "CONFIRMED",
  seatNumber: "A4",
  venue: {
    name: "Cafe, Central; Hub",
    address: "12 Main St, Hyderabad",
    latitude: 25.396,
    longitude: 68.3578,
  },
};

const NOW = new Date("2026-07-01T10:00:00.000Z");

describe("generateBookingIcs", () => {
  it("emits a CRLF terminated RFC 5545 calendar with required VEVENT properties", () => {
    const ics = generateBookingIcs(base, { now: NOW })!;
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    for (const prop of [
      "VERSION:2.0",
      "PRODID:",
      "UID:ckbooking123@worksphere.app",
      "DTSTAMP:20260701T100000Z",
      "SUMMARY:",
      "DESCRIPTION:",
      "LOCATION:",
      "GEO:",
    ]) {
      expect(ics).toContain(prop);
    }
  });

  it("converts local venue time to UTC (Karachi is UTC+5)", () => {
    const ics = generateBookingIcs(base, { now: NOW })!;
    expect(ics).toContain("DTSTART:20260720T040000Z");
    expect(ics).toContain("DTEND:20260720T053000Z");
  });

  it("handles daylight saving offsets (New York summer vs winter)", () => {
    const summer = generateBookingIcs(
      {
        ...base,
        timeZone: "America/New_York",
        date: "2026-07-20",
        time: "09:00",
      },
      { now: NOW },
    )!;
    const winter = generateBookingIcs(
      {
        ...base,
        timeZone: "America/New_York",
        date: "2026-12-21",
        time: "09:00",
      },
      { now: NOW },
    )!;
    expect(summer).toContain("DTSTART:20260720T130000Z");
    expect(winter).toContain("DTSTART:20261221T140000Z");
  });

  it("defaults to UTC when the booking has no timezone and accepts 12 hour times", () => {
    const ics = generateBookingIcs(
      { ...base, timeZone: null, time: "2:30 PM" },
      { now: NOW },
    )!;
    expect(ics).toContain("DTSTART:20260720T143000Z");
  });

  it("defaults duration to 60 minutes", () => {
    const ics = generateBookingIcs({ ...base, duration: null }, { now: NOW })!;
    expect(ics).toContain("DTEND:20260720T050000Z");
  });

  it("escapes commas, semicolons and newlines in text values", () => {
    const ics = generateBookingIcs(base, { now: NOW })!.replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:Booking at Cafe\\, Central\\; Hub");
    expect(ics).toContain("\\nBooking ID: WS-ABC123");
  });

  it("writes GEO as lat;lng and omits it when coordinates are missing", () => {
    expect(generateBookingIcs(base, { now: NOW })).toContain(
      "GEO:25.396;68.3578",
    );
    const noGeo = generateBookingIcs(
      { ...base, venue: { name: "X", latitude: null, longitude: null } },
      { now: NOW },
    )!;
    expect(noGeo).not.toContain("GEO:");
  });

  it("adds one VALARM by default and honours custom offsets", () => {
    const def = generateBookingIcs(base, { now: NOW })!;
    expect(def).toContain("BEGIN:VALARM");
    expect(def).toContain("TRIGGER:-PT30M");
    expect(def).toContain("ACTION:DISPLAY");

    const custom = generateBookingIcs(base, {
      now: NOW,
      alarmMinutes: [15, 60],
    })!;
    expect(custom.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(custom).toContain("TRIGGER:-PT15M");
    expect(custom).toContain("TRIGGER:-PT60M");

    const none = generateBookingIcs(base, { now: NOW, alarmMinutes: [] })!;
    expect(none).not.toContain("VALARM");
  });

  it("folds long lines to at most 75 octets", () => {
    const long = generateBookingIcs(
      {
        ...base,
        venue: {
          ...base.venue,
          address: "A very long street name ".repeat(12),
        },
      },
      { now: NOW },
    )!;
    for (const line of long.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("maps booking status to iCalendar STATUS", () => {
    expect(
      generateBookingIcs({ ...base, status: "PENDING" }, { now: NOW }),
    ).toContain("STATUS:TENTATIVE");
    expect(
      generateBookingIcs({ ...base, status: "CANCELLED" }, { now: NOW }),
    ).toContain("STATUS:CANCELLED");
    expect(
      generateBookingIcs({ ...base, status: "CHECKED_IN" }, { now: NOW }),
    ).toContain("STATUS:CONFIRMED");
  });

  it("returns null for an invalid date or time", () => {
    expect(generateBookingIcs({ ...base, date: "2026-02-31" })).toBeNull();
    expect(generateBookingIcs({ ...base, time: "25:99" })).toBeNull();
  });
});

describe("calendar web links", () => {
  const event = buildBookingCalendarEvent(base)!;

  it("builds a Google Calendar render link with UTC dates and timezone", () => {
    const url = new URL(buildGoogleCalendarLink(event));
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe(
      "20260720T040000Z/20260720T053000Z",
    );
    expect(url.searchParams.get("text")).toBe("Booking at Cafe, Central; Hub");
    expect(url.searchParams.get("ctz")).toBe("Asia/Karachi");
  });

  it("builds Outlook web links for personal and work accounts", () => {
    const personal = new URL(buildOutlookWebLink(event));
    expect(personal.host).toBe("outlook.live.com");
    expect(personal.searchParams.get("rru")).toBe("addevent");
    expect(personal.searchParams.get("startdt")).toBe("2026-07-20T04:00:00Z");
    expect(personal.searchParams.get("enddt")).toBe("2026-07-20T05:30:00Z");

    expect(new URL(buildOutlookWebLink(event, "work")).host).toBe(
      "outlook.office.com",
    );
  });

  it("formats UTC stamps without separators or milliseconds", () => {
    expect(formatIcsUtc(new Date("2026-07-20T04:00:00.123Z"))).toBe(
      "20260720T040000Z",
    );
  });
});
