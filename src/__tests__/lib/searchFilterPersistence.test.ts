/**
 * Tests for search filter persistence across navigation.
 */

interface SearchFilters {
  query: string;
  category?: string;
  maxDistanceKm?: number;
  minRating?: number;
  amenities: string[];
  priceRange?: [number, number]; // [min, max] cents
  sortBy: "distance" | "rating" | "price" | "newest";
}

function defaultFilters(): SearchFilters {
  return { query: "", amenities: [], sortBy: "distance" };
}

function isDefaultFilters(filters: SearchFilters): boolean {
  const def = defaultFilters();
  return (
    filters.query === def.query &&
    filters.sortBy === def.sortBy &&
    filters.amenities.length === 0 &&
    !filters.category &&
    !filters.maxDistanceKm &&
    !filters.minRating &&
    !filters.priceRange
  );
}

function serializeFilters(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.query)          params.set("q",     filters.query);
  if (filters.category)       params.set("cat",   filters.category);
  if (filters.maxDistanceKm)  params.set("dist",  String(filters.maxDistanceKm));
  if (filters.minRating)      params.set("rating",String(filters.minRating));
  if (filters.amenities.length) params.set("amenities", filters.amenities.join(","));
  if (filters.priceRange)     params.set("price", filters.priceRange.join("-"));
  if (filters.sortBy !== "distance") params.set("sort", filters.sortBy);
  return params.toString();
}

function activeFilterCount(filters: SearchFilters): number {
  let count = 0;
  if (filters.query)           count++;
  if (filters.category)        count++;
  if (filters.maxDistanceKm)   count++;
  if (filters.minRating)       count++;
  if (filters.amenities.length) count++;
  if (filters.priceRange)      count++;
  if (filters.sortBy !== "distance") count++;
  return count;
}

describe("Search filter persistence", () => {
  const FILTERS: SearchFilters = {
    query: "café", category: "cafe", maxDistanceKm: 5, minRating: 4,
    amenities: ["wifi"], priceRange: [0, 5000], sortBy: "rating",
  };

  it("defaultFilters: empty query and amenities", () => {
    const d = defaultFilters();
    expect(d.query).toBe("");
    expect(d.amenities).toHaveLength(0);
    expect(d.sortBy).toBe("distance");
  });

  it("isDefaultFilters: true for defaults", () => {
    expect(isDefaultFilters(defaultFilters())).toBe(true);
  });

  it("isDefaultFilters: false when query set", () => {
    expect(isDefaultFilters({ ...defaultFilters(), query: "café" })).toBe(false);
  });

  it("serializeFilters: includes query", () => {
    expect(serializeFilters(FILTERS)).toContain("q=caf");
  });

  it("serializeFilters: omits default sort", () => {
    expect(serializeFilters(defaultFilters())).not.toContain("sort=");
  });

  it("activeFilterCount: all set = 7", () => {
    expect(activeFilterCount(FILTERS)).toBe(7);
  });

  it("activeFilterCount: defaults = 0", () => {
    expect(activeFilterCount(defaultFilters())).toBe(0);
  });

  it("activeFilterCount: only query = 1", () => {
    expect(activeFilterCount({ ...defaultFilters(), query: "hub" })).toBe(1);
  });
});
