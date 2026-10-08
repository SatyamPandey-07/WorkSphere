import {
  generateSessionIcs,
  formatIcsUtcDate,
  escapeIcsText,
  SessionIcsOptions,
} from "@/lib/social/sessionIcs";

describe("RFC 5545 Session Calendar (.ics) Generator (#4953)", () => {
  const sampleOptions: SessionIcsOptions = {
    title: "Deep Work & Focus Sprint",
    description: "Join us for a focused 2-hour coworking session with sprints.",
    startsAt: "2026-11-15T14:00:00.000Z",
    endsAt: "2026-11-15T16:00:00.000Z",
    venueName: "Silicon Hub Coworking",
    venueAddress: "123 Tech Lane, San Francisco, CA",
    slug: "deep-work-focus-sprint",
    organizerName: "Alex Rivera",
    organizerEmail: "alex@worksphere.app",
    url: "https://worksphere.app/sessions/deep-work-focus-sprint",
  };

  it("formats dates in UTC per RFC 5545 specifications (YYYYMMDDTHHmmssZ)", () => {
    const formatted = formatIcsUtcDate("2026-11-15T14:30:00.000Z");
    expect(formatted).toBe("20261115T143000Z");
  });

  it("escapes special characters (commas, semicolons, newlines, backslashes)", () => {
    const unescaped = "Notes: Meeting 1, 2; check \\ info\nNext line";
    const escaped = escapeIcsText(unescaped);
    expect(escaped).toBe("Notes: Meeting 1\\, 2\\; check \\\\ info\\nNext line");
  });

  it("generates a valid RFC 5545 VCALENDAR event structure", () => {
    const ics = generateSessionIcs(sampleOptions);

    // Verify envelope headers
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//WorkSphere//SocialCoworkingSession//EN\r\n");
    expect(ics).toContain("CALSCALE:GREGORIAN\r\n");
    expect(ics).toContain("METHOD:PUBLISH\r\n");
    expect(ics).toContain("BEGIN:VEVENT\r\n");

    // Verify event details
    expect(ics).toContain("UID:session-deep-work-focus-sprint@worksphere.app\r\n");
    expect(ics).toContain("DTSTART:20261115T140000Z\r\n");
    expect(ics).toContain("DTEND:20261115T160000Z\r\n");
    expect(ics).toContain("SUMMARY:Deep Work & Focus Sprint\r\n");
    expect(ics).toContain("LOCATION:Silicon Hub Coworking\\, 123 Tech Lane\\, San Francisco\\, CA\r\n");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    expect(ics).toContain("ORGANIZER;CN=Alex Rivera:mailto:alex@worksphere.app\r\n");
    expect(ics).toContain("URL:https://worksphere.app/sessions/deep-work-focus-sprint\r\n");

    // Verify closing tags
    expect(ics).toContain("END:VEVENT\r\n");
    expect(ics).toContain("END:VCALENDAR");

    // Must use CRLF line endings per RFC 5545
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
  });

  it("handles fallback defaults when optional fields are omitted", () => {
    const minimalOptions: SessionIcsOptions = {
      title: "Quick Standup",
      startsAt: new Date("2026-12-01T10:00:00.000Z"),
      endsAt: new Date("2026-12-01T10:30:00.000Z"),
      slug: "quick-standup",
    };

    const ics = generateSessionIcs(minimalOptions);

    expect(ics).toContain("SUMMARY:Quick Standup\r\n");
    expect(ics).toContain("DTSTART:20261201T100000Z\r\n");
    expect(ics).toContain("DTEND:20261201T103000Z\r\n");
    expect(ics).toContain("LOCATION:WorkSphere Coworking Space\r\n");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    expect(ics).not.toContain("ORGANIZER");
    expect(ics).not.toContain("URL");
  });
});
