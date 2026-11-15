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

  describe("applyFilters null-safety and minCapacity schema preservation (#6760)", () => {
    it("safely handles nullish venues and filters arrays without throwing", async () => {
      const { applyFilters } = await import("@/lib/filters");
      expect(applyFilters(null as any, {})).toEqual([]);
      expect(applyFilters(undefined as any, {})).toEqual([]);
      expect(applyFilters([{ id: "v1", wifi: true }], null as any)).toEqual([{ id: "v1", wifi: true }]);
      expect(applyFilters([{ id: "v1", wifi: true }], undefined as any)).toEqual([{ id: "v1", wifi: true }]);
    });

    it("filters out nullish venue entries gracefully", async () => {
      const { applyFilters } = await import("@/lib/filters");
      const mixedVenues = [null, undefined, { id: "v1", wifi: true }, { id: "v2", wifi: false }];
      const result = applyFilters(mixedVenues as any, { wifi: true });
      expect(result).toHaveLength(1);
      expect((result[0] as any).id).toBe("v1");
    });

    it("matches minCapacity against numeric string venue capacities", async () => {
      const { applyFilters } = await import("@/lib/filters");
      const venues = [
        { id: "v1", capacity: "25" },
        { id: "v2", capacity: 10 },
        { id: "v3", capacity: null },
      ];
      const result = applyFilters(venues as any, { minCapacity: 20 });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("v1");
    });

    it("preserves undefined for omitted minCapacity in buildVenueSearchSchema", async () => {
      const { buildVenueSearchSchema } = await import("@/lib/filters");
      const schema = buildVenueSearchSchema();
      const parsedOmitted = schema.safeParse({ lat: "40", lng: "-74" });
      expect(parsedOmitted.success).toBe(true);
      if (parsedOmitted.success) {
        expect(parsedOmitted.data.minCapacity).toBeUndefined();
      }

      const parsedExplicit = schema.safeParse({ lat: "40", lng: "-74", minCapacity: "15" });
      expect(parsedExplicit.success).toBe(true);
      if (parsedExplicit.success) {
        expect(parsedExplicit.data.minCapacity).toBe(15);
      }
    });
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

describe("extended filter wildcards and schema preprocessing (#6720)", () => {
  const diverseVenues = [
    {
      id: "v-lofi",
      name: "LoFi Haven",
      musicStyle: "lofi",
      wifiSpeed: null,
      category: "cafe",
    },
    {
      id: "v-jazz",
      name: "Jazz & Code",
      musicStyle: "classical_jazz",
      wifiSpeed: 85,
      categories: [{ name: "Coworking" }],
    },
    {
      id: "v-silent",
      name: "Library Silence",
      hasNoMusic: true,
      wifiSpeed: 120,
      category: "library",
    },
  ];

  it("allows all venues when musicStyle is 'all'", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const result = applyFilters(diverseVenues, { musicStyle: "all" });
    expect(result).toHaveLength(3);
  });

  it("matches no_music via hasNoMusic flag", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const result = applyFilters(diverseVenues, { musicStyle: "no_music" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v-silent");
  });

  it("allows all venues when wifiSpeedBand is 'all', including null/undefined speeds", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const result = applyFilters(diverseVenues, { wifiSpeedBand: "all" });
    expect(result).toHaveLength(3);
  });

  it("filters by wifiSpeedBand thresholds", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const fast = applyFilters(diverseVenues, { wifiSpeedBand: "fast" });
    expect(fast.map((v) => v.id)).toEqual(["v-jazz", "v-silent"]);

    const ultra = applyFilters(diverseVenues, { wifiSpeedBand: "ultra" });
    expect(ultra.map((v) => v.id)).toEqual(["v-silent"]);
  });

  it("filters by category in applyFilters matching string or category array", async () => {
    const { applyFilters } = await import("@/lib/filters");
    const cafes = applyFilters(diverseVenues, { category: "cafe" });
    expect(cafes).toHaveLength(1);
    expect(cafes[0].id).toBe("v-lofi");

    const coworking = applyFilters(diverseVenues, { category: "coworking" });
    expect(coworking).toHaveLength(1);
    expect(coworking[0].id).toBe("v-jazz");

    const allCategories = applyFilters(diverseVenues, { category: "all" });
    expect(allCategories).toHaveLength(3);
  });

  it("handles empty string query parameters in buildVenueSearchSchema without throwing", async () => {
    const { buildVenueSearchSchema } = await import("@/lib/filters");
    const schema = buildVenueSearchSchema();

    const parsed = schema.safeParse({
      lat: "47.6062",
      lng: "-122.3321",
      wifi: "",
      outlets: "true",
      dogFriendly: "1",
      musicStyle: "",
      category: "",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.wifi).toBeUndefined();
      expect(parsed.data.outlets).toBe(true);
      expect(parsed.data.dogFriendly).toBe(true);
      expect(parsed.data.musicStyle).toBeUndefined();
      expect(parsed.data.category).toBeUndefined();
    }
  });
});
