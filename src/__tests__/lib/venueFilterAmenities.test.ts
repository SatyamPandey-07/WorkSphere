/**
 * Tests for venue amenity-based filtering.
 */

interface VenueAmenities {
  id: string;
  hasOutlets: boolean;
  hasErgonomic: boolean;
  hasQuietZone: boolean;
  hasPhoneBooths: boolean;
  wifiQuality: number;
}

function filterByAmenities(
  venues: VenueAmenities[],
  required: Partial<Pick<VenueAmenities, "hasOutlets" | "hasErgonomic" | "hasQuietZone" | "hasPhoneBooths">>,
  minWifi?: number,
): VenueAmenities[] {
  return venues.filter((v) => {
    if (required.hasOutlets && !v.hasOutlets) return false;
    if (required.hasErgonomic && !v.hasErgonomic) return false;
    if (required.hasQuietZone && !v.hasQuietZone) return false;
    if (required.hasPhoneBooths && !v.hasPhoneBooths) return false;
    if (minWifi !== undefined && v.wifiQuality < minWifi) return false;
    return true;
  });
}

const VENUES: VenueAmenities[] = [
  { id: "v1", hasOutlets: true,  hasErgonomic: true,  hasQuietZone: true,  hasPhoneBooths: false, wifiQuality: 5 },
  { id: "v2", hasOutlets: true,  hasErgonomic: false, hasQuietZone: false, hasPhoneBooths: true,  wifiQuality: 3 },
  { id: "v3", hasOutlets: false, hasErgonomic: false, hasQuietZone: false, hasPhoneBooths: false, wifiQuality: 2 },
];

describe("Venue amenity filtering", () => {
  it("no filters returns all venues", () => {
    expect(filterByAmenities(VENUES, {})).toHaveLength(3);
  });

  it("requires outlets filters v3", () => {
    const result = filterByAmenities(VENUES, { hasOutlets: true });
    expect(result.some((v) => v.id === "v3")).toBe(false);
    expect(result).toHaveLength(2);
  });

  it("requires ergonomic returns only v1", () => {
    const result = filterByAmenities(VENUES, { hasErgonomic: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v1");
  });

  it("minWifi=4 returns only v1", () => {
    const result = filterByAmenities(VENUES, {}, 4);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v1");
  });

  it("multiple requirements are AND-combined", () => {
    const result = filterByAmenities(VENUES, { hasOutlets: true, hasErgonomic: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v1");
  });

  it("empty venues returns empty", () => {
    expect(filterByAmenities([], { hasOutlets: true })).toHaveLength(0);
  });
});

describe("applyFilters with pet and lighting filters", () => {
  const venues = [
    {
      id: "v1",
      name: "Sunny Canine Cafe",
      dogFriendly: true,
      catsAllowed: false,
      petsAllowedIndoors: true,
      lighting: "natural_daylight",
    },
    {
      id: "v2",
      name: "Cozy Cat Haven",
      dogFriendly: false,
      catsAllowed: true,
      petsAllowedIndoors: true,
      lighting: "warm_ambient",
    },
    {
      id: "v3",
      name: "Bright Focus Studio",
      dogFriendly: false,
      catsAllowed: false,
      petsAllowedIndoors: false,
      lighting: "bright_white",
    },
  ];

  it("filters venues by dog friendliness", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const result = applyFilters(venues, { dogFriendly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v1");
  });

  it("filters venues by lighting enum", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const result = applyFilters(venues, { lighting: "warm_ambient" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v2");
  });

  it("combines pet and lighting filters accurately", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const result = applyFilters(venues, {
      dogFriendly: true,
      lighting: "natural_daylight",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v1");

    const emptyResult = applyFilters(venues, {
      dogFriendly: true,
      lighting: "bright_white",
    });
    expect(emptyResult).toHaveLength(0);
  });
});
