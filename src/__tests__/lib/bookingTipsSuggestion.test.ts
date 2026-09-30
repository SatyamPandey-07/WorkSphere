/**
 * Tests for booking tips and advice suggestion engine.
 */

interface BookingContext {
  durationHours: number;
  groupSize: number;
  purpose: "solo_work" | "team_meeting" | "client_presentation" | "video_call" | "brainstorm";
  hasLaptop: boolean;
}

interface Tip {
  id: string;
  text: string;
  condition: (ctx: BookingContext) => boolean;
}

const TIPS: Tip[] = [
  { id: "outlets",     text: "Bring a power bank or look for outlet-rich seats",          condition: (c) => c.hasLaptop && c.durationHours > 2 },
  { id: "book-early",  text: "Book meeting rooms at least 24h in advance for large groups",condition: (c) => c.groupSize >= 5 },
  { id: "quiet-zone",  text: "Choose a quiet zone for video calls",                        condition: (c) => c.purpose === "video_call" },
  { id: "hdmi",        text: "Bring an HDMI adapter for presentations",                    condition: (c) => c.purpose === "client_presentation" },
  { id: "whiteboard",  text: "Reserve a room with a whiteboard for brainstorming",         condition: (c) => c.purpose === "brainstorm" && c.groupSize > 1 },
];

function getSuggestedTips(ctx: BookingContext): Tip[] {
  return TIPS.filter((t) => t.condition(ctx));
}

function tipIds(ctx: BookingContext): string[] {
  return getSuggestedTips(ctx).map((t) => t.id);
}

describe("Booking tips suggestion", () => {
  it("video call context: quiet-zone tip", () => {
    const ctx: BookingContext = { durationHours: 1, groupSize: 1, purpose: "video_call", hasLaptop: true };
    expect(tipIds(ctx)).toContain("quiet-zone");
  });

  it("long solo session: outlets tip", () => {
    const ctx: BookingContext = { durationHours: 4, groupSize: 1, purpose: "solo_work", hasLaptop: true };
    expect(tipIds(ctx)).toContain("outlets");
  });

  it("large group: book-early tip", () => {
    const ctx: BookingContext = { durationHours: 2, groupSize: 6, purpose: "team_meeting", hasLaptop: false };
    expect(tipIds(ctx)).toContain("book-early");
  });

  it("client presentation: hdmi tip", () => {
    const ctx: BookingContext = { durationHours: 1, groupSize: 3, purpose: "client_presentation", hasLaptop: true };
    expect(tipIds(ctx)).toContain("hdmi");
  });

  it("brainstorm with group: whiteboard tip", () => {
    const ctx: BookingContext = { durationHours: 2, groupSize: 3, purpose: "brainstorm", hasLaptop: false };
    expect(tipIds(ctx)).toContain("whiteboard");
  });

  it("solo brainstorm: no whiteboard tip (group <= 1)", () => {
    const ctx: BookingContext = { durationHours: 2, groupSize: 1, purpose: "brainstorm", hasLaptop: false };
    expect(tipIds(ctx)).not.toContain("whiteboard");
  });

  it("short session without laptop: no outlets tip", () => {
    const ctx: BookingContext = { durationHours: 1, groupSize: 1, purpose: "solo_work", hasLaptop: false };
    expect(tipIds(ctx)).not.toContain("outlets");
  });
});
