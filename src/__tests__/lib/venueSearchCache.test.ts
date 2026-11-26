import {
  clearVenueSearchCache,
  getVenueSearchCache,
  setVenueSearchCache,
  VENUE_SEARCH_CACHE_TTL,
  MAX_VENUE_SEARCH_CACHE_ENTRIES,
} from "@/lib/search/venueSearchCache";

describe("venueSearchCache", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    clearVenueSearchCache();
  });

  it("stores and retrieves search results", () => {
    const venues = [{ id: "v1", name: "Library" }];

    setVenueSearchCache("library", venues);

    expect(getVenueSearchCache("library")).toEqual(venues);
  });

  it("returns an empty array as a valid cached result", () => {
    setVenueSearchCache("empty", []);

    expect(getVenueSearchCache("empty")).toEqual([]);
  });

  it("expires entries after the configured TTL", () => {
    const now = Date.now();

    jest.spyOn(Date, "now").mockReturnValue(now);
    setVenueSearchCache("library", [{ id: "v1" }]);

    jest.spyOn(Date, "now").mockReturnValue(now + VENUE_SEARCH_CACHE_TTL + 1);

    expect(getVenueSearchCache("library")).toBeNull();
  });

  it("purges expired entries from sessionStorage", () => {
    const now = Date.now();

    jest.spyOn(Date, "now").mockReturnValue(now);
    setVenueSearchCache("expired", [{ id: "v1" }]);

    jest.spyOn(Date, "now").mockReturnValue(now + VENUE_SEARCH_CACHE_TTL + 1);

    expect(getVenueSearchCache("expired")).toBeNull();

    const stored = JSON.parse(
      sessionStorage.getItem("worksphere:venue-search-cache:v1") || "{}",
    );

    expect(stored.expired).toBeUndefined();
  });

  it("evicts the least recently used query when capacity is exceeded", () => {
    for (let i = 0; i < MAX_VENUE_SEARCH_CACHE_ENTRIES; i++) {
      setVenueSearchCache(`query-${i}`, [{ id: `v${i}` }]);
    }

    // Make query-0 the most recently used.
    expect(getVenueSearchCache("query-0")).toEqual([{ id: "v0" }]);

    setVenueSearchCache("new-query", [{ id: "new" }]);

    expect(getVenueSearchCache("query-0")).toEqual([{ id: "v0" }]);
    expect(getVenueSearchCache("query-1")).toBeNull();
    expect(getVenueSearchCache("new-query")).toEqual([{ id: "new" }]);
  });

  it("clears the cache", () => {
    setVenueSearchCache("library", [{ id: "v1" }]);

    clearVenueSearchCache();

    expect(getVenueSearchCache("library")).toBeNull();
  });
});
