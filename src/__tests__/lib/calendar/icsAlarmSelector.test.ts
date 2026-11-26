import {
  generateBookingIcs,
  type BookingCalendarEvent,
} from "@/lib/calendar/icsGenerator";
import { REMINDER_OPTIONS } from "@/lib/calendar/reminders";

const event: BookingCalendarEvent = {
  uid: "test-1@worksphere.app",
  start: new Date("2026-07-20T04:30:00Z"),
  end: new Date("2026-07-20T05:30:00Z"),
  title: "Booking at Test Venue",
  description: "Booking ID: test-1",
  location: "Test Venue",
  timeZone: "UTC",
  status: "CONFIRMED",
  geo: null,
};

describe("generateBookingIcs alarm offsets", () => {
  it.each(REMINDER_OPTIONS)("injects VALARM with %i minute trigger", (m) => {
    const ics = generateBookingIcs(event, { alarmMinutes: [m] })!;
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain(`-PT${m}M`);
    expect(ics.indexOf("END:VALARM")).toBeLessThan(ics.indexOf("END:VEVENT"));
  });
});
