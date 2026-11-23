import {
  VENUE_SEARCH_HISTORY_KEY,
  clearVenueSearchHistory,
  loadVenueSearchHistory,
  removeVenueSearchQuery,
  saveVenueSearchQuery,
  trimVenueSearchHistory,
} from "@/lib/venueSearchHistory";

describe("venue search history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps up to five unique queries in LRU order", () => {
    saveVenueSearchQuery("cafe");
    saveVenueSearchQuery("library");
    saveVenueSearchQuery("coworking");
    saveVenueSearchQuery("Cafe ");
    saveVenueSearchQuery("quiet");
    saveVenueSearchQuery("wifi");

    expect(loadVenueSearchHistory()).toEqual([
      "wifi",
      "quiet",
      "Cafe",
      "coworking",
      "library",
    ]);
  });

  it("trims, deduplicates, and ignores invalid stored values", () => {
    expect(
      trimVenueSearchHistory([
        " library ",
        "LIBRARY",
        null,
        "wifi",
        "",
        "cafe",
        "coworking",
        "quiet",
        "outlets",
      ]),
    ).toEqual(["library", "wifi", "cafe", "coworking", "quiet"]);
  });

  it("removes one query and clears the complete history", () => {
    saveVenueSearchQuery("cafe");
    saveVenueSearchQuery("library");

    expect(removeVenueSearchQuery("Cafe")).toEqual(["library"]);
    expect(loadVenueSearchHistory()).toEqual(["library"]);

    clearVenueSearchHistory();
    expect(localStorage.getItem(VENUE_SEARCH_HISTORY_KEY)).toBeNull();
  });

  it("handles localStorage read and write failures safely", () => {
    const getSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    expect(loadVenueSearchHistory()).toEqual([]);

    getSpy.mockRestore();
    const setSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    expect(saveVenueSearchQuery("library")).toEqual(["library"]);
    setSpy.mockRestore();
  });

  it("loads malformed JSON as an empty history", () => {
    localStorage.setItem(VENUE_SEARCH_HISTORY_KEY, "{not-json");
    expect(loadVenueSearchHistory()).toEqual([]);
  });
});
