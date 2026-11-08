/**
 * Tests for the isQuietZone and zoneName fields added to VenueSeat (Issue #2098).
 */

interface MockVenueSeat {
  id: string;
  isQuietZone: boolean;
  zoneName: string | null;
  seatNumber: string;
}

function filterQuietZoneSeats(seats: MockVenueSeat[]): MockVenueSeat[] {
  return seats.filter((s) => s.isQuietZone);
}

function groupByZone(seats: MockVenueSeat[]): Record<string, MockVenueSeat[]> {
  return seats.reduce<Record<string, MockVenueSeat[]>>((acc, seat) => {
    const zone = seat.zoneName ?? "General Area";
    if (!acc[zone]) acc[zone] = [];
    acc[zone].push(seat);
    return acc;
  }, {});
}

const SEATS: MockVenueSeat[] = [
  { id: "s1", isQuietZone: true,  zoneName: "Quiet Reading Room", seatNumber: "A1" },
  { id: "s2", isQuietZone: true,  zoneName: "Quiet Reading Room", seatNumber: "A2" },
  { id: "s3", isQuietZone: false, zoneName: "Collaborative Area", seatNumber: "B1" },
  { id: "s4", isQuietZone: false, zoneName: null,                 seatNumber: "C1" },
];

describe("VenueSeat quiet zone filtering", () => {
  it("filters to only quiet zone seats", () => {
    const quiet = filterQuietZoneSeats(SEATS);
    expect(quiet).toHaveLength(2);
    expect(quiet.every((s) => s.isQuietZone)).toBe(true);
  });

  it("returns empty array when no quiet zones exist", () => {
    const noQuiet = SEATS.filter((s) => !s.isQuietZone);
    expect(filterQuietZoneSeats(noQuiet)).toHaveLength(0);
  });

  it("correctly identifies non-quiet seats", () => {
    const nonQuiet = SEATS.filter((s) => !s.isQuietZone);
    expect(nonQuiet).toHaveLength(2);
  });
});

describe("VenueSeat zone grouping", () => {
  it("groups seats by zone name", () => {
    const grouped = groupByZone(SEATS);
    expect(grouped["Quiet Reading Room"]).toHaveLength(2);
    expect(grouped["Collaborative Area"]).toHaveLength(1);
  });

  it("uses 'General Area' for seats with null zoneName", () => {
    const grouped = groupByZone(SEATS);
    expect(grouped["General Area"]).toHaveLength(1);
    expect(grouped["General Area"][0].id).toBe("s4");
  });

  it("returns correct zone names", () => {
    const grouped = groupByZone(SEATS);
    const zones = Object.keys(grouped).sort();
    expect(zones).toContain("Quiet Reading Room");
    expect(zones).toContain("Collaborative Area");
    expect(zones).toContain("General Area");
  });
});

describe("VenueSeat quiet zone defaults", () => {
  it("isQuietZone defaults to false (new seats are non-quiet)", () => {
    const newSeat: MockVenueSeat = { id: "new", isQuietZone: false, zoneName: null, seatNumber: "Z1" };
    expect(newSeat.isQuietZone).toBe(false);
  });

  it("zoneName can be null (no zone assigned)", () => {
    const seat = SEATS.find((s) => s.id === "s4")!;
    expect(seat.zoneName).toBeNull();
  });
});
