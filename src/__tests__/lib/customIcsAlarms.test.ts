import { generateBookingIcs, type BookingCalendarInput } from "@/lib/calendar/icsGenerator";
import { isValidIcsAlarmTrigger } from "@/lib/calendar/ics";

const booking: BookingCalendarInput = {
  id: "booking-123",
  date: "2026-11-15",
  time: "10:00",
  timeZone: "UTC",
  duration: 60,
  venue: { name: "WorkSphere Central", address: "Pune" },
};

describe("custom booking calendar alarms", () => {
  it("renders multiple custom RFC 5545 display alarms", () => {
    const content = generateBookingIcs(booking, {
      alarms: [
        { trigger: "-PT15M", description: "Check-in begins soon" },
        { trigger: "-PT1H" },
        { trigger: "-P1D", description: "Plan tomorrow's commute" },
      ],
      now: new Date("2026-11-12T00:00:00.000Z"),
    });

    expect(content).toContain("BEGIN:VALARM");
    expect(content).toContain("ACTION:DISPLAY");
    expect(content).toContain("TRIGGER:-PT15M");
    expect(content).toContain("TRIGGER:-PT1H");
    expect(content).toContain("TRIGGER:-P1D");
    expect(content).toContain("DESCRIPTION:Check-in begins soon");
    expect(content?.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(content?.match(/END:VALARM/g)).toHaveLength(3);
  });

  it("preserves the default 30-minute reminder when no options are supplied", () => {
    const content = generateBookingIcs(booking, {
      now: new Date("2026-11-12T00:00:00.000Z"),
    });
    expect(content).toContain("TRIGGER:-PT30M");
  });

  it("rejects malformed or non-positive trigger durations", () => {
    expect(isValidIcsAlarmTrigger("-PT15M")).toBe(true);
    expect(isValidIcsAlarmTrigger("-P1D")).toBe(true);
    expect(isValidIcsAlarmTrigger("-PT0M")).toBe(false);
    expect(isValidIcsAlarmTrigger("-PT")).toBe(false);
    expect(isValidIcsAlarmTrigger("PT15M")).toBe(false);
    expect(isValidIcsAlarmTrigger("-P1W2D")).toBe(false);
  });

  it("ignores invalid custom alarms without dropping valid ones", () => {
    const content = generateBookingIcs(booking, {
      alarms: [
        { trigger: "PT15M" },
        { trigger: "-PT15M", description: "Valid reminder" },
      ],
      now: new Date("2026-11-12T00:00:00.000Z"),
    });

    expect(content?.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(content).toContain("DESCRIPTION:Valid reminder");
  });
});
