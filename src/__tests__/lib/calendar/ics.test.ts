import {
  downloadICS,
  formatDateTimeForCalendar,
  generateICSContent,
  generateICS,
  foldIcsLine,
  escapeIcsText,
  generateBulkICSContent,
  downloadBulkICS,
} from "@/lib/calendar/ics";

describe("ICS Calendar Utility (RFC 5545)", () => {
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

  describe("escapeIcsText", () => {
    it("escapes backslashes, semicolons, commas, and newlines per RFC 5545", () => {
      const raw = "Special; text, with\\backslash and\nnewline";
      const escaped = escapeIcsText(raw);
      expect(escaped).toBe("Special\\; text\\, with\\\\backslash and\\nnewline");
    });
  });

  describe("foldIcsLine", () => {
    it("does not fold lines with 75 or fewer characters", () => {
      const shortLine = "SUMMARY:Short line";
      expect(foldIcsLine(shortLine)).toBe(shortLine);
    });

    it("folds lines longer than 75 characters with CRLF and leading space", () => {
      const longLine = "A".repeat(160);
      const folded = foldIcsLine(longLine);
      const parts = folded.split("\r\n");
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0].length).toBe(75);
      for (let i = 1; i < parts.length; i++) {
        expect(parts[i].startsWith(" ")).toBe(true);
        expect(parts[i].length).toBeLessThanOrEqual(75);
      }
    });
  });

  describe("generateICSContent / generateICS", () => {
    it("generates RFC 5545 compliant iCalendar string with positional parameters", () => {
      const ics = generateICSContent(
        "Indie Desk Hub",
        "42 Market Street, Austin",
        "2026-07-20",
        "14:30",
        90,
        "WS-#482910",
      );

      expect(ics.includes("\r\n")).toBe(true);
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("VERSION:2.0");
      expect(ics).toContain("PRODID:-//WorkSphere//EN");
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("STATUS:CONFIRMED");
      expect(ics).toContain("LOCATION:42 Market Street\\, Austin");
      expect(ics).toContain("END:VEVENT");
      expect(ics).toContain("END:VCALENDAR");

      // Verify unfolded content
      const unfolded = ics.replace(/\r\n /g, "");
      expect(unfolded).toContain("SUMMARY:Booking at Indie Desk Hub (90 min) [WS-#482910] - 42 Market Street\\, Austin");
      expect(unfolded).toContain("DESCRIPTION:Hot desk booking at Indie Desk Hub\\nVenue Address: 42 Market Street\\, Austin\\nBooking ID: WS-#482910\\nDuration: 90 min");
    });

    it("generates RFC 5545 compliant iCalendar string with object options", () => {
      const ics = generateICS({
        venueName: "Creative Loft",
        venueAddress: "742 Evergreen Terrace, Springfield",
        date: "2026-08-15",
        time: "10:00",
        durationMinutes: 120,
        bookingId: "BK-998877",
        confirmationId: "CONF-112233",
        timezone: "America/Chicago",
      });

      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("X-WR-TIMEZONE:America/Chicago");
      expect(ics).toContain("STATUS:CONFIRMED");
      expect(ics).toContain("UID:BK-998877@worksphere.app");

      const unfolded = ics.replace(/\r\n /g, "");
      expect(unfolded).toContain("SUMMARY:Booking at Creative Loft (120 min) [BK-998877] - 742 Evergreen Terrace\\, Springfield");
      expect(unfolded).toContain("LOCATION:742 Evergreen Terrace\\, Springfield");
      expect(unfolded).toContain("Booking ID: BK-998877");
      expect(unfolded).toContain("Venue Address: 742 Evergreen Terrace\\, Springfield");
    });

    it("returns empty string for invalid date/time", () => {
      expect(generateICSContent("Venue", "Address", "", "10:00")).toBe("");
    });
  });

  describe("downloadICS", () => {
    it("triggers browser download with proper Blob and anchor click", () => {
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

      downloadICS({
        venueName: "Desk Co",
        venueAddress: "500 Pine St",
        date: "2026-09-01",
        time: "09:00",
        durationMinutes: 60,
        bookingId: "BID-123",
      });

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

  describe("generateBulkICSContent and downloadBulkICS", () => {
    it("generates multiple VEVENT blocks in a single VCALENDAR", () => {
      const bulkIcs = generateBulkICSContent([
        {
          venueName: "Venue One",
          venueAddress: "Address One",
          date: "2026-07-20",
          time: "10:00",
          duration: 60,
          bookingId: "B1",
        },
        {
          venueName: "Venue Two",
          venueAddress: "Address Two",
          date: "2026-07-21",
          time: "14:00",
          duration: 120,
          bookingId: "B2",
        },
      ]);

      expect(bulkIcs).not.toBeNull();
      expect(bulkIcs).toContain("BEGIN:VCALENDAR");
      expect(bulkIcs?.match(/BEGIN:VEVENT/g)?.length).toBe(2);
      expect(bulkIcs?.match(/END:VEVENT/g)?.length).toBe(2);
      expect(bulkIcs).toContain("SUMMARY:Booking at Venue One (60 min) [B1]");
      expect(bulkIcs).toContain("SUMMARY:Booking at Venue Two (120 min) [B2]");
      expect(bulkIcs).toContain("END:VCALENDAR");
    });

    it("returns null if no bookings have valid date/time", () => {
      expect(generateBulkICSContent([])).toBeNull();
      expect(
        generateBulkICSContent([
          {
            venueName: "Bad",
            venueAddress: "Bad",
            date: "",
            time: "",
          },
        ]),
      ).toBeNull();
    });

    it("triggers bulk download properly", () => {
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;

      URL.createObjectURL = jest.fn(() => "blob:http://localhost/bulk-ics");
      URL.revokeObjectURL = jest.fn();

      const mockClick = jest.fn();
      const originalCreateElement = document.createElement.bind(document);
      jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName === "a") {
          el.click = mockClick;
        }
        return el;
      });

      downloadBulkICS([
        {
          venueName: "Venue",
          venueAddress: "Address",
          date: "2026-07-20",
          time: "10:00",
        },
      ]);

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(mockClick).toHaveBeenCalledTimes(1);

      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      jest.restoreAllMocks();
    });
  });
});
