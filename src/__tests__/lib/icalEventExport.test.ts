/**
 * Tests for iCal/ICS calendar event export formatting.
 */

interface CalendarEvent {
  uid: string;
  summary: string;
  location?: string;
  startMs: number;
  endMs: number;
  description?: string;
}

function toIcsDatetime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(".000Z", "Z");
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\/g, "\\\\")
    .replace(/;/g,  "\;")
    .replace(/,/g,  "\,")
    .replace(/\n/g, "\n");
}

function buildIcsEvent(event: CalendarEvent): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `DTSTART:${toIcsDatetime(event.startMs)}`,
    `DTEND:${toIcsDatetime(event.endMs)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

const EVENT: CalendarEvent = {
  uid:         "booking-123@worksphere",
  summary:     "Workspace at Café Hub",
  location:    "123 Main St, NYC",
  startMs:     1_700_000_000_000,
  endMs:       1_700_003_600_000,
  description: "Booked via WorkSphere",
};

describe("iCal event export", () => {
  it("output starts with BEGIN:VEVENT", () => {
    expect(buildIcsEvent(EVENT)).toMatch(/^BEGIN:VEVENT/);
  });

  it("output ends with END:VEVENT", () => {
    expect(buildIcsEvent(EVENT)).toMatch(/END:VEVENT$/);
  });

  it("UID field present", () => {
    expect(buildIcsEvent(EVENT)).toContain("UID:booking-123@worksphere");
  });

  it("SUMMARY field present", () => {
    expect(buildIcsEvent(EVENT)).toContain("SUMMARY:Workspace at Café Hub");
  });

  it("LOCATION field present when provided", () => {
    expect(buildIcsEvent(EVENT)).toContain("LOCATION:");
  });

  it("no LOCATION line when not provided", () => {
    const noLoc: CalendarEvent = { ...EVENT, location: undefined };
    expect(buildIcsEvent(noLoc)).not.toContain("LOCATION:");
  });

  it("toIcsDatetime: no dashes or colons", () => {
    const dt = toIcsDatetime(1_700_000_000_000);
    expect(dt).not.toMatch(/[-:]/);
    expect(dt).toMatch(/Z$/);
  });

  it("escapeIcsText: semicolons escaped", () => {
    expect(escapeIcsText("a;b")).toBe("a\;b");
  });

  it("escapeIcsText: commas escaped", () => {
    expect(escapeIcsText("a,b")).toBe("a\,b");
  });

  it("escapeIcsText: newlines escaped", () => {
    expect(escapeIcsText("a\nb")).toBe("a\nb");
  });
});
