/**
 * Tests for group booking capacity filtering (Issue #2083).
 * meetingRoomCapacity field enables filtering venues by headcount.
 */

import type { MapMarker } from "@/types/map";

function filterVenuesByGroupSize(
  venues: (Partial<MapMarker> & { meetingRoomCapacity?: number })[],
  headcount: number,
): (Partial<MapMarker> & { meetingRoomCapacity?: number })[] {
  return venues.filter(
    (v) =>
      v.meetingRoomCapacity !== undefined &&
      v.meetingRoomCapacity !== null &&
      v.meetingRoomCapacity >= headcount,
  );
}

const VENUES = [
  { id: "v1", name: "Small Room",    meetingRoomCapacity: 4 },
  { id: "v2", name: "Medium Room",   meetingRoomCapacity: 12 },
  { id: "v3", name: "Large Room",    meetingRoomCapacity: 25 },
  { id: "v4", name: "Solo Desk",     meetingRoomCapacity: 1 },
  { id: "v5", name: "No capacity",   meetingRoomCapacity: undefined },
];

describe("Group booking capacity filtering", () => {
  it("returns venues that can fit the requested headcount", () => {
    const result = filterVenuesByGroupSize(VENUES, 10);
    expect(result.every((v) => v.meetingRoomCapacity! >= 10)).toBe(true);
  });

  it("includes venues with exactly the requested capacity", () => {
    const result = filterVenuesByGroupSize(VENUES, 12);
    expect(result.some((v) => v.id === "v2")).toBe(true);
  });

  it("excludes venues smaller than requested headcount", () => {
    const result = filterVenuesByGroupSize(VENUES, 15);
    expect(result.some((v) => v.id === "v1")).toBe(false); // 4 < 15
    expect(result.some((v) => v.id === "v2")).toBe(false); // 12 < 15
  });

  it("excludes venues without capacity data", () => {
    const result = filterVenuesByGroupSize(VENUES, 1);
    expect(result.some((v) => v.id === "v5")).toBe(false);
  });

  it("headcount=1 includes all venues with any capacity", () => {
    const result = filterVenuesByGroupSize(VENUES, 1);
    expect(result).toHaveLength(4); // v1, v2, v3, v4
  });

  it("headcount=25 returns only the largest room", () => {
    const result = filterVenuesByGroupSize(VENUES, 25);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v3");
  });

  it("headcount=26 returns empty (nothing fits)", () => {
    const result = filterVenuesByGroupSize(VENUES, 26);
    expect(result).toHaveLength(0);
  });
});
