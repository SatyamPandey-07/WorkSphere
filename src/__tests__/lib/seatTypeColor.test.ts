/**
 * Tests for seat type color coding in floor plan renderer.
 */

type SeatType = "hot_desk" | "fixed_desk" | "meeting_room" | "phone_booth";

const SEAT_COLORS: Record<SeatType, string> = {
  hot_desk:     "#3b82f6", // blue
  fixed_desk:   "#22c55e", // green
  meeting_room: "#f59e0b", // amber
  phone_booth:  "#a855f7", // purple
};

function getSeatColor(type: SeatType): string {
  return SEAT_COLORS[type];
}

function isValidHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

describe("Seat type color coding", () => {
  it("hot_desk is blue", () => {
    expect(getSeatColor("hot_desk")).toBe("#3b82f6");
  });

  it("fixed_desk is green", () => {
    expect(getSeatColor("fixed_desk")).toBe("#22c55e");
  });

  it("meeting_room is amber", () => {
    expect(getSeatColor("meeting_room")).toBe("#f59e0b");
  });

  it("phone_booth is purple", () => {
    expect(getSeatColor("phone_booth")).toBe("#a855f7");
  });

  it("all colors are valid hex format", () => {
    (Object.keys(SEAT_COLORS) as SeatType[]).forEach((type) => {
      expect(isValidHexColor(getSeatColor(type))).toBe(true);
    });
  });

  it("all 4 seat types have colors", () => {
    expect(Object.keys(SEAT_COLORS)).toHaveLength(4);
  });

  it("seat colors are all distinct", () => {
    const colors = Object.values(SEAT_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
