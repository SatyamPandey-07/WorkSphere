import { downloadICS, formatDateTimeForCalendar, generateICSContent } from "@/lib/calendar";

describe("formatDateTimeForCalendar", () => {
  it("returns empty strings when date or time is missing", () => {
    expect(formatDateTimeForCalendar("", "10:00")).toEqual({
      start: "",
      end: "",
    });
    expect(formatDateTimeForCalendar("2026-07-20", "")).toEqual({
      start: "",
      end: "",
    });
  });

  it("uses the given duration in minutes for DTEND", () => {
    const oneHour = formatDateTimeForCalendar("2026-07-20", "09:00", 60);
    const twoHours = formatDateTimeForCalendar("2026-07-20", "09:00", 120);

    expect(oneHour.start).toBeTruthy();
    expect(oneHour.end).toBeTruthy();
    expect(twoHours.start).toBe(oneHour.start);
    expect(twoHours.end).not.toBe(oneHour.end);
  });
});

describe("generateICSContent", () => {
  const ics = generateICSContent(
    "Indie Desk Hub",
    "42 Market Street, Austin",
    "2026-07-20",
    "14:30",
    90,
    "WS-#482910",
  );

  it("uses CRLF line endings", () => {
    expect(ics.includes("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("includes required VCALENDAR / VEVENT markers", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("puts venue address, duration, and confirmation id in SUMMARY", () => {
    expect(ics).toContain("SUMMARY:");
    expect(ics).toContain("Indie Desk Hub");
    expect(ics).toContain("90 min");
    expect(ics).toContain("WS-#482910");
    expect(ics).toContain("42 Market Street");
  });

  it("sets LOCATION to the venue address", () => {
    expect(ics).toContain("LOCATION:42 Market Street\\, Austin");
  });

  it("includes STATUS:CONFIRMED for confirmed workspace bookings", () => {
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("includes X-WR-TIMEZONE and timezone in description when provided", () => {
    const icsWithTz = generateICSContent(
      "Focus Space",
      "100 Tech Blvd",
      "2026-08-10",
      "10:00",
      {
        durationMinutes: 60,
        confirmationId: "WS-CONF-999",
        timezone: "America/New_York",
      },
    );
    expect(icsWithTz).toContain("X-WR-TIMEZONE:America/New_York");
    expect(icsWithTz).toContain("Timezone: America/New_York");
    expect(icsWithTz).toContain("STATUS:CONFIRMED");
  });

  it("properly folds lines exceeding 75 characters per RFC 5545", () => {
    const longAddress = "123 Very Long Street Name With Many Descriptors, Suite 900, Building B, Austin, TX 78701";
    const icsLong = generateICSContent(
      "Super Long Venue Name For Workspace Testing That Will Exceed Maximum Single Line Length Limits",
      longAddress,
      "2026-07-20",
      "14:30",
      {
        durationMinutes: 120,
        confirmationId: "WS-#999888777666",
      },
    );
    const lines = icsLong.split("\r\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });

  it("returns empty string for invalid date/time", () => {
    expect(generateICSContent("X", "Y", "", "10:00")).toBe("");
  });
});

describe("downloadICS", () => {
  it("triggers browser download with blob and anchor element", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = jest.fn(() => "blob:http://localhost/test-ics");
    URL.revokeObjectURL = jest.fn();

    const appendChildSpy = jest.spyOn(document.body, "appendChild");
    const removeChildSpy = jest.spyOn(document.body, "removeChild");

    const mockClick = jest.fn();
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        el.click = mockClick;
      }
      return el;
    });

    downloadICS(
      "Indie Desk Hub",
      "42 Market Street",
      "2026-07-20",
      "14:30",
      60,
      "WS-#12345",
    );

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendChildSpy).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalledTimes(1);
    expect(removeChildSpy).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test-ics");

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });
});

describe("getCalendarUrls (#4595)", () => {
  it("generates correct query parameters for Google Calendar and Outlook quick add URLs", () => {
    const { getCalendarUrls } = require("@/lib/calendar");
    const { googleUrl, outlookUrl, start, end } = getCalendarUrls(
      "Indie Desk Hub",
      "42 Market Street, Austin",
      "2026-07-20",
      "14:30",
      60,
    );

    // Verify Google Calendar link structure and query params
    const google = new URL(googleUrl);
    expect(google.origin).toBe("https://calendar.google.com");
    expect(google.pathname).toBe("/calendar/render");
    expect(google.searchParams.get("action")).toBe("TEMPLATE");
    expect(google.searchParams.get("text")).toBe("Booking at Indie Desk Hub");
    expect(google.searchParams.get("dates")).toBe(`${start}/${end}`);
    expect(google.searchParams.get("details")).toBe("Hot desk booking at Indie Desk Hub");
    expect(google.searchParams.get("location")).toBe("42 Market Street, Austin");

    // Verify Outlook Web link structure and query params
    const outlook = new URL(outlookUrl);
    expect(outlook.origin).toBe("https://outlook.live.com");
    expect(outlook.pathname).toBe("/calendar/0/deeplink/compose");
    expect(outlook.searchParams.get("path")).toBe("/calendar/action/compose");
    expect(outlook.searchParams.get("rru")).toBe("addevent");
    expect(outlook.searchParams.get("subject")).toBe("Booking at Indie Desk Hub");
    expect(outlook.searchParams.get("startdt")).toBe(start);
    expect(outlook.searchParams.get("enddt")).toBe(end);
    expect(outlook.searchParams.get("body")).toBe("Hot desk booking at Indie Desk Hub");
    expect(outlook.searchParams.get("location")).toBe("42 Market Street, Austin");
  });
});

