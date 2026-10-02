/**
 * Tests for venue search result sorting by distance.
 */

interface VenueResult {
  id: string;
  distanceKm: number;
  wifiQuality?: number;
}

function sortByDistance(venues: VenueResult[]): VenueResult[] {
  return [...venues].sort((a, b) => a.distanceKm - b.distanceKm);
}

function sortByWifi(venues: VenueResult[]): VenueResult[] {
  return [...venues].sort((a, b) => (b.wifiQuality ?? 0) - (a.wifiQuality ?? 0));
}

describe("Venue search result sorting", () => {
  const venues: VenueResult[] = [
    { id: "v3", distanceKm: 3, wifiQuality: 5 },
    { id: "v1", distanceKm: 1, wifiQuality: 3 },
    { id: "v2", distanceKm: 2, wifiQuality: 4 },
  ];

  it("sortByDistance returns nearest first", () => {
    const sorted = sortByDistance(venues);
    expect(sorted[0].id).toBe("v1");
    expect(sorted[2].id).toBe("v3");
  });

  it("sortByDistance does not mutate original array", () => {
    const original = [...venues];
    sortByDistance(venues);
    expect(venues).toEqual(original);
  });

  it("sortByWifi returns best WiFi first", () => {
    const sorted = sortByWifi(venues);
    expect(sorted[0].id).toBe("v3"); // wifiQuality=5
    expect(sorted[2].id).toBe("v1"); // wifiQuality=3
  });

  it("sortByDistance handles ties (same distance)", () => {
    const tieVenues = [
      { id: "a", distanceKm: 1 },
      { id: "b", distanceKm: 1 },
    ];
    const sorted = sortByDistance(tieVenues);
    expect(sorted).toHaveLength(2);
  });

  it("empty array sorts to empty array", () => {
    expect(sortByDistance([])).toEqual([]);
    expect(sortByWifi([])).toEqual([]);
  });

  it("single venue sorts to itself", () => {
    const single = [{ id: "only", distanceKm: 5, wifiQuality: 3 }];
    expect(sortByDistance(single)).toEqual(single);
  });
});
